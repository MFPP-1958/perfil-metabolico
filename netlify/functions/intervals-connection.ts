import { authenticateRequest } from './lib/authorization.js';
import { jsonResponse } from './lib/http.js';

type Event = { httpMethod: string; headers?: Record<string, string>; body?: string };
type SafeAthlete = { id: string; name: string };
type ImportSummary = {
  added: number;
  existing: number;
  failed: Array<{ id: string; reason: 'ownership_conflict' | 'persistence_error' }>;
};

type Dependencies = {
  authenticate(event: Event): Promise<{ id: string } | null>;
  ownerId(): string;
  loadRoster(): Promise<unknown[]>;
  persist(coachId: string, roster: SafeAthlete[], athleteIds: string[]): Promise<ImportSummary>;
};

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('Missing server configuration');
  return value;
}

function safeRoster(rows: unknown[]): SafeAthlete[] {
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const value = row as Record<string, unknown>;
    const name = typeof value.name === 'string' ? value.name.trim().slice(0, 120) : '';
    return typeof value.id === 'string' && /^i\d+$/.test(value.id) && name
      ? [{ id: value.id, name }]
      : [];
  });
}

async function loadRosterDefault(): Promise<unknown[]> {
  const apiKey = requiredEnvironment('INTERVALS_API_KEY');
  const response = await fetch('https://intervals.icu/api/v1/athletes', {
    headers: {
      Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(12_000),
  });
  const length = Number(response.headers.get('content-length') ?? '0');
  if (!response.ok || (Number.isFinite(length) && length > 5_000_000)) {
    throw new Error('Intervals roster unavailable');
  }
  const body = await response.arrayBuffer();
  if (body.byteLength > 5_000_000) throw new Error('Intervals roster unavailable');
  const parsed = JSON.parse(new TextDecoder().decode(body)) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Intervals roster unavailable');
  return parsed;
}

function supabaseConfiguration() {
  const url = requiredEnvironment('SUPABASE_URL').replace(/\/$/, '');
  const key = requiredEnvironment('SUPABASE_SECRET_KEY');
  return {
    url,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  };
}

async function persistDefault(coachId: string, roster: SafeAthlete[], athleteIds: string[]): Promise<ImportSummary> {
  const { url, headers } = supabaseConfiguration();
  const failed: ImportSummary['failed'] = [];
  let added = 0;
  let existingCount = 0;

  const profile = await fetch(`${url}/rest/v1/coach_profiles?on_conflict=id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ id: coachId, display_name: 'Entrenador propietario' }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!profile.ok) throw new Error('Unable to prepare owner profile');

  for (const selected of roster.filter((athlete) => athleteIds.includes(athlete.id))) {
    let createdThisAttempt = false;
    let athlete: { id: string; created_by: string } | undefined;
    try {
      const lookupQuery = new URLSearchParams({
        select: 'id,created_by',
        intervals_athlete_id: `eq.${selected.id}`,
        limit: '1',
      });
      const lookup = await fetch(`${url}/rest/v1/athletes?${lookupQuery}`, {
        headers,
        signal: AbortSignal.timeout(8_000),
      });
      if (!lookup.ok) throw new Error('Unable to resolve athlete');
      const rows = await lookup.json() as Array<{ id?: unknown; created_by?: unknown }>;
      const row = rows[0];
      if (typeof row?.id === 'string' && typeof row.created_by === 'string') {
        athlete = { id: row.id, created_by: row.created_by };
      }
      if (athlete && athlete.created_by !== coachId) {
        failed.push({ id: selected.id, reason: 'ownership_conflict' });
        continue;
      }
      if (!athlete) {
        const create = await fetch(`${url}/rest/v1/athletes?select=id,created_by`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify({
            created_by: coachId,
            intervals_athlete_id: selected.id,
            display_name: selected.name,
          }),
          signal: AbortSignal.timeout(8_000),
        });
        if (!create.ok) throw new Error('Unable to create athlete');
        const created = await create.json() as Array<{ id?: unknown; created_by?: unknown }>;
        if (typeof created[0]?.id !== 'string' || created[0].created_by !== coachId) throw new Error('Invalid created athlete');
        athlete = { id: created[0].id, created_by: coachId };
        createdThisAttempt = true;
      }

      const link = await fetch(`${url}/rest/v1/coach_athletes?on_conflict=coach_id,athlete_id`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({ coach_id: coachId, athlete_id: athlete.id, role: 'coach' }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!link.ok) throw new Error('Unable to create athlete link');
      if (createdThisAttempt) added += 1;
      else existingCount += 1;
    } catch {
      if (createdThisAttempt && athlete) {
        const cleanup = new URLSearchParams({ id: `eq.${athlete.id}`, created_by: `eq.${coachId}` });
        await fetch(`${url}/rest/v1/athletes?${cleanup}`, {
          method: 'DELETE', headers, signal: AbortSignal.timeout(8_000),
        }).catch(() => undefined);
      }
      failed.push({ id: selected.id, reason: 'persistence_error' });
    }
  }
  return { added, existing: existingCount, failed };
}

const defaults: Dependencies = {
  authenticate: authenticateRequest,
  ownerId: () => requiredEnvironment('INTERVALS_OWNER_USER_ID'),
  loadRoster: loadRosterDefault,
  persist: persistDefault,
};

export function createIntervalsConnectionHandler(overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = { ...defaults, ...overrides };
  return async (event: Event) => {
    if (!['GET', 'POST'].includes(event.httpMethod)) return jsonResponse(405, { error: 'Método no permitido.' });
    let user: { id: string } | null;
    try { user = await deps.authenticate(event); } catch { return jsonResponse(503, { error: 'La conexión no está preparada.' }); }
    if (!user) return jsonResponse(401, { error: 'Sesión necesaria o caducada.' });
    let owner: string;
    try { owner = deps.ownerId(); } catch { return jsonResponse(503, { error: 'La conexión no está preparada.' }); }
    if (user.id !== owner) return jsonResponse(403, { error: 'Cuenta no autorizada.' });
    try {
      const roster = safeRoster(await deps.loadRoster());
      if (event.httpMethod === 'GET') return jsonResponse(200, { athletes: roster });
      let parsed: unknown;
      try { parsed = JSON.parse(event.body ?? ''); } catch { return jsonResponse(400, { error: 'Selección no válida.' }); }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { athleteIds?: unknown }).athleteIds)) {
        return jsonResponse(400, { error: 'Selección no válida.' });
      }
      const athleteIds = (parsed as { athleteIds: unknown[] }).athleteIds;
      if (
        athleteIds.length < 1 || athleteIds.length > 100
        || athleteIds.some((id) => typeof id !== 'string' || !/^i\d+$/.test(id))
        || new Set(athleteIds).size !== athleteIds.length
        || athleteIds.some((id) => !roster.some((athlete) => athlete.id === id))
      ) return jsonResponse(400, { error: 'Selección no válida.' });
      const summary = await deps.persist(user.id, roster, athleteIds as string[]);
      return jsonResponse(summary.failed.length ? 207 : 200, summary);
    } catch {
      return jsonResponse(502, { error: 'No se pudo conectar con Intervals.icu.' });
    }
  };
}

export const handler = createIntervalsConnectionHandler();
