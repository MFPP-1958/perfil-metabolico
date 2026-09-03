import { bearerToken } from './http.js';

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value.replace(/\/$/, '');
}

export async function authenticateRequest(event, fetchImpl = fetch) {
  const token = bearerToken(event.headers);
  if (!token) return null;

  const url = requiredEnvironment('SUPABASE_URL');
  const secretKey = requiredEnvironment('SUPABASE_SECRET_KEY');
  const response = await fetchImpl(`${url}/auth/v1/user`, {
    headers: { apikey: secretKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;
  const user = await response.json();
  return typeof user?.id === 'string' ? { id: user.id } : null;
}

export async function listAuthorizedAthleteIds(userId, fetchImpl = fetch) {
  const url = requiredEnvironment('SUPABASE_URL');
  const secretKey = requiredEnvironment('SUPABASE_SECRET_KEY');
  const query = new URLSearchParams({
    select: 'athletes!inner(intervals_athlete_id)',
    coach_id: `eq.${userId}`,
  });
  const response = await fetchImpl(`${url}/rest/v1/coach_athletes?${query}`, {
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Unable to resolve athlete authorization');
  const rows = await response.json();
  return new Set(rows.map((row) => row?.athletes?.intervals_athlete_id).filter((id) => typeof id === 'string'));
}
