# Single-Coach Intervals.icu Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the single authorized coach to Intervals.icu, import an explicitly selected roster, and synchronize one real cyclist without exposing credentials.

**Architecture:** A new authenticated Netlify Function performs owner-only roster discovery and idempotent persistence with server credentials. A focused React panel handles explicit discovery and selection, while the existing synchronization function remains responsible for normalized athlete data. Local scripts keep the Intervals API key and owner UUID in macOS Keychain and inject them into Netlify Dev without writing secret files.

**Tech Stack:** React 19, TypeScript 5.9, Netlify Functions, Netlify CLI 27.4.3, Supabase local/Postgres 17, Vitest, Playwright, macOS Keychain.

**Spec:** `docs/superpowers/specs/2026-09-04-intervals-single-coach-connection-design.md`

## Global Constraints

- Work only inside `/Users/manuelfrancisperezperez/Desktop/MFPP Metabolic Lab`.
- Do not modify `/Users/manuelfrancisperezperez/Desktop/Perfil metabolico`.
- Keep `INTERVALS_API_KEY`, `INTERVALS_OWNER_USER_ID`, and `SUPABASE_SECRET_KEY` out of browser code, Git, HTTP responses, and logs.
- Use one owner UUID from Supabase; multi-coach OAuth is outside this plan.
- Require explicit athlete selection; never import the full roster automatically.
- Preserve `created_by` ownership and never reassign an existing athlete.
- Keep the synthetic demonstration separate from real cyclists.
- Write each behavior test first and observe the expected failure before production code.
- Keep the repository on local branch `main` with no remote until a dedicated repository is created.

---

### Task 1: Owner-only roster discovery and import function

**Files:**
- Create: `netlify/functions/intervals-connection.ts`
- Create: `tests/functions/intervals-connection.test.ts`
- Modify: `netlify/functions/lib/authorization.d.ts`
- Modify: `tests/security/netlify-config.test.ts`

**Interfaces:**
- Consumes: `authenticateRequest(event): Promise<{ id: string } | null>` and `jsonResponse(statusCode, body)`.
- Produces: `createIntervalsConnectionHandler(dependencies?)` and Netlify `handler`.
- GET response: `{ athletes: Array<{ id: string; name: string }> }`.
- POST body: `{ athleteIds: string[] }`.
- POST response: `{ added: number; existing: number; failed: Array<{ id: string; reason: "ownership_conflict" | "persistence_error" }> }`.

- [ ] **Step 1: Write failing authorization and discovery tests**

Create `tests/functions/intervals-connection.test.ts` with dependency injection so tests never contact Intervals.icu or Supabase:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createIntervalsConnectionHandler } from '../../netlify/functions/intervals-connection';

const roster = [
  { id: 'i123', name: 'Ana Ciclista', email: 'private@example.com' },
  { id: 'i456', name: 'Luis Ciclista', icu_api_key: 'never-return' },
];

function request(method = 'GET', body?: unknown) {
  return {
    httpMethod: method,
    headers: { authorization: 'Bearer valid-token' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function dependencies(overrides = {}) {
  return {
    authenticate: vi.fn().mockResolvedValue({ id: 'coach-owner' }),
    ownerId: vi.fn().mockReturnValue('coach-owner'),
    loadRoster: vi.fn().mockResolvedValue(roster),
    persist: vi.fn().mockResolvedValue({ added: 1, existing: 0, failed: [] }),
    ...overrides,
  };
}

describe('Intervals connection', () => {
  it('rejects a request without a Supabase session', async () => {
    const deps = dependencies({ authenticate: vi.fn().mockResolvedValue(null) });
    const response = await createIntervalsConnectionHandler(deps)({ ...request(), headers: {} });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an authenticated user who is not the configured owner', async () => {
    const deps = dependencies({ authenticate: vi.fn().mockResolvedValue({ id: 'other-coach' }) });
    const response = await createIntervalsConnectionHandler(deps)(request());
    expect(response.statusCode).toBe(403);
    expect(deps.loadRoster).not.toHaveBeenCalled();
  });

  it('returns only safe roster summaries to the owner', async () => {
    const response = await createIntervalsConnectionHandler(dependencies())(request());
    expect(JSON.parse(response.body)).toEqual({ athletes: [
      { id: 'i123', name: 'Ana Ciclista' },
      { id: 'i456', name: 'Luis Ciclista' },
    ] });
    expect(response.body).not.toContain('private@example.com');
    expect(response.body).not.toContain('never-return');
  });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
npm run test:run -- tests/functions/intervals-connection.test.ts
```

Expected: FAIL because `netlify/functions/intervals-connection.ts` does not exist.

- [ ] **Step 3: Implement the minimal owner and discovery handler**

Create `netlify/functions/intervals-connection.ts` with these concrete boundaries:

```ts
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

function safeRoster(rows: unknown[]): SafeAthlete[] {
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const value = row as Record<string, unknown>;
    return typeof value.id === 'string' && /^i\d+$/.test(value.id) && typeof value.name === 'string'
      ? [{ id: value.id, name: value.name.slice(0, 120) }]
      : [];
  });
}

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
    const roster = safeRoster(await deps.loadRoster());
    if (event.httpMethod === 'GET') return jsonResponse(200, { athletes: roster });
    // POST validation and persistence are added after their failing tests.
    return jsonResponse(400, { error: 'Selección no válida.' });
  };
}
```

Implement `defaults.ownerId()` by reading `INTERVALS_OWNER_USER_ID`. Implement `defaults.loadRoster()` with a 12-second timeout, Basic authentication using username `API_KEY`, response-size limit of 5 MB, and `GET https://intervals.icu/api/v1/athletes`. Do not include the upstream body in thrown errors.

- [ ] **Step 4: Run discovery tests and verify GREEN**

Run:

```bash
npm run test:run -- tests/functions/intervals-connection.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Add failing POST validation tests**

Append tests for malformed JSON, more than 100 IDs, duplicates, invalid IDs, and IDs absent from the fresh roster:

```ts
it('rejects a selection containing athletes outside the fresh roster', async () => {
  const deps = dependencies();
  const response = await createIntervalsConnectionHandler(deps)(request('POST', { athleteIds: ['i999'] }));
  expect(response.statusCode).toBe(400);
  expect(deps.persist).not.toHaveBeenCalled();
});

it('persists only a unique valid explicit selection', async () => {
  const deps = dependencies();
  const response = await createIntervalsConnectionHandler(deps)(request('POST', { athleteIds: ['i456'] }));
  expect(response.statusCode).toBe(200);
  expect(deps.persist).toHaveBeenCalledWith('coach-owner', [
    { id: 'i123', name: 'Ana Ciclista' },
    { id: 'i456', name: 'Luis Ciclista' },
  ], ['i456']);
});
```

- [ ] **Step 6: Run POST tests and verify RED**

Run the same targeted test command. Expected: the valid POST returns 400 and the persistence assertion fails.

- [ ] **Step 7: Implement POST validation and idempotent persistence**

Parse only `{ athleteIds }`, require 1-100 unique values matching `/^i\d+$/`, and verify every ID against the newly loaded roster before calling `persist`.

The default persistence implementation must:

```ts
for (const selected of selectedRoster) {
  const existing = await findAthleteByIntervalsId(selected.id);
  if (existing && existing.created_by !== coachId) {
    failed.push({ id: selected.id, reason: 'ownership_conflict' });
    continue;
  }
  const created = existing ?? await createAthlete({
    created_by: coachId,
    intervals_athlete_id: selected.id,
    display_name: selected.name,
  });
  try {
    await createCoachLink({ coach_id: coachId, athlete_id: created.id, role: 'coach' });
    existing ? existingCount++ : added++;
  } catch {
    if (!existing) await deleteAthleteCreatedByThisAttempt(created.id, coachId);
    failed.push({ id: selected.id, reason: 'persistence_error' });
  }
}
```

Use `resolution=ignore-duplicates` for profiles and links. Before linking an existing athlete, compare `created_by`. Every cleanup DELETE must filter by both `id` and `created_by`.

- [ ] **Step 8: Add security assertions**

Update `tests/security/netlify-config.test.ts` to read the new function and assert that it references server variables without `VITE_`, never serializes `INTERVALS_API_KEY`, and never returns `response.text()` from upstream.

- [ ] **Step 9: Run function and security tests**

Run:

```bash
npm run test:run -- tests/functions/intervals-connection.test.ts tests/security/netlify-config.test.ts
```

Expected: all targeted tests PASS.

- [ ] **Step 10: Commit Task 1**

```bash
git add netlify/functions/intervals-connection.ts netlify/functions/lib/authorization.d.ts tests/functions/intervals-connection.test.ts tests/security/netlify-config.test.ts
git commit -m "feat: add owner-only Intervals roster import"
```

---

### Task 2: Explicit roster selection panel

**Files:**
- Create: `src/features/athletes/intervalsConnectionApi.ts`
- Create: `src/features/athletes/IntervalsConnectionPanel.tsx`
- Create: `src/features/athletes/IntervalsConnectionPanel.test.tsx`
- Modify: `src/features/athletes/AthleteWorkspace.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: `getAccessToken()` and `/.netlify/functions/intervals-connection`.
- Produces: `IntervalsConnectionPanel({ api, onImported })`.
- Client types: `RosterCandidate`, `ImportSummary`, and `IntervalsConnectionApi`.

- [ ] **Step 1: Write the failing explicit-action UI test**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IntervalsConnectionPanel } from './IntervalsConnectionPanel';

it('does not contact Intervals until the coach asks to connect', async () => {
  const api = { discover: vi.fn(), importSelected: vi.fn() };
  render(<IntervalsConnectionPanel api={api} onImported={vi.fn()} />);
  expect(api.discover).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Conectar Intervals.icu' }));
  expect(api.discover).toHaveBeenCalledOnce();
});

it('imports only checked cyclists and refreshes the workspace', async () => {
  const api = {
    discover: vi.fn().mockResolvedValue([{ id: 'i123', name: 'Ana' }, { id: 'i456', name: 'Luis' }]),
    importSelected: vi.fn().mockResolvedValue({ added: 1, existing: 0, failed: [] }),
  };
  const onImported = vi.fn().mockResolvedValue(undefined);
  render(<IntervalsConnectionPanel api={api} onImported={onImported} />);
  await userEvent.click(screen.getByRole('button', { name: 'Conectar Intervals.icu' }));
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Ana' }));
  await userEvent.click(screen.getByRole('button', { name: 'Incorporar 1 ciclista' }));
  expect(api.importSelected).toHaveBeenCalledWith(['i123']);
  expect(onImported).toHaveBeenCalledOnce();
  expect(await screen.findByText('1 ciclista incorporado')).toBeVisible();
});
```

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
npm run test:run -- src/features/athletes/IntervalsConnectionPanel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the API adapter**

Create `intervalsConnectionApi.ts`:

```ts
import { getAccessToken } from '../../auth/supabase';

export type RosterCandidate = { id: string; name: string };
export type ImportSummary = { added: number; existing: number; failed: Array<{ id: string; reason: string }> };
export interface IntervalsConnectionApi {
  discover(): Promise<RosterCandidate[]>;
  importSelected(athleteIds: string[]): Promise<ImportSummary>;
}

async function authenticatedFetch(init?: RequestInit) {
  const token = await getAccessToken();
  return fetch('/.netlify/functions/intervals-connection', {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers },
  });
}

export const intervalsConnectionApi: IntervalsConnectionApi = {
  async discover() {
    const response = await authenticatedFetch();
    if (!response.ok) throw new Error(response.status === 503 ? 'La conexión todavía no está configurada.' : 'No se pudo consultar Intervals.icu.');
    return (await response.json() as { athletes: RosterCandidate[] }).athletes;
  },
  async importSelected(athleteIds) {
    const response = await authenticatedFetch({ method: 'POST', body: JSON.stringify({ athleteIds }) });
    if (!response.ok) throw new Error('No se pudieron incorporar los ciclistas seleccionados.');
    return response.json() as Promise<ImportSummary>;
  },
};
```

- [ ] **Step 4: Implement the minimal four-state panel**

Use state values `idle`, `loading`, `selection`, `importing`, `result`, and `error`. Render checkboxes only after explicit discovery. Disable import when no athlete is checked. Clear selected IDs whenever a new discovery starts. Render failures as counts without exposing server details.

- [ ] **Step 5: Run the component test and verify GREEN**

Run the targeted test command. Expected: both tests PASS.

- [ ] **Step 6: Integrate the panel and roster refresh**

In `AthleteWorkspace.tsx`, extract roster loading into `loadRoster()` and pass it to the panel:

```tsx
async function loadRoster() {
  setLoading(true);
  setError('');
  try { setAthletes(await api.list()); }
  catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo cargar la lista.'); }
  finally { setLoading(false); }
}

useEffect(() => { void loadRoster(); }, [api]);

<IntervalsConnectionPanel api={intervalsConnectionApi} onImported={loadRoster} />
```

Keep `Abrir demostración` available and do not select an imported cyclist automatically.

- [ ] **Step 7: Add focused styles**

Add `.intervals-connection`, `.roster-selection`, `.connection-status`, and `.connection-summary` rules using existing color variables, 44 px minimum button height, visible focus styles, and a single-column layout below 720 px.

- [ ] **Step 8: Run UI, accessibility, and full unit tests**

```bash
npm run test:run -- src/features/athletes/IntervalsConnectionPanel.test.tsx src/features/observations/observations.test.tsx
npm run test:run
```

Expected: all tests PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/features/athletes/intervalsConnectionApi.ts src/features/athletes/IntervalsConnectionPanel.tsx src/features/athletes/IntervalsConnectionPanel.test.tsx src/features/athletes/AthleteWorkspace.tsx src/styles/global.css
git commit -m "feat: add explicit Intervals roster selection"
```

---

### Task 3: Real cyclist synchronization control

**Files:**
- Create: `src/features/athletes/AthleteWorkspace.test.tsx`
- Modify: `src/features/athletes/AthleteWorkspace.tsx`
- Modify: `src/features/athletes/AthleteHeader.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Extends `AthleteApi` with `sync(intervalsId: string): Promise<{ warnings: string[] }>`.
- `AthleteHeader` receives `onSync`, `syncing`, and `syncMessage` for real athletes only.

- [ ] **Step 1: Write a failing synchronization UI test**

```tsx
it('synchronizes the selected real cyclist and reloads its normalized data', async () => {
  const api = {
    list: vi.fn().mockResolvedValue([{ id: 'uuid-1', intervalsId: 'i123', name: 'Ana' }]),
    load: vi.fn().mockResolvedValue({ id: 'uuid-1', intervalsId: 'i123', name: 'Ana', observations: [] }),
    sync: vi.fn().mockResolvedValue({ warnings: [] }),
  };
  render(<AthleteWorkspace api={api} />);
  await userEvent.selectOptions(await screen.findByLabelText('Ciclista'), 'uuid-1');
  await userEvent.click(await screen.findByRole('button', { name: 'Sincronizar Ana' }));
  expect(api.sync).toHaveBeenCalledWith('i123');
  expect(api.load).toHaveBeenCalledTimes(2);
  expect(await screen.findByText('Sincronización completada')).toBeVisible();
});
```

Add a second test proving the demo athlete never renders a synchronization button.

- [ ] **Step 2: Run the workspace test and verify RED**

Run:

```bash
npm run test:run -- src/features/athletes/AthleteWorkspace.test.tsx
```

Expected: FAIL because `AthleteApi.sync` and the button are absent.

- [ ] **Step 3: Implement the authenticated synchronization adapter**

Add to `defaultApi`:

```ts
async sync(intervalsId) {
  const token = await getAccessToken();
  const query = new URLSearchParams({ athleteId: intervalsId, syncKey: crypto.randomUUID() });
  const response = await fetch(`/.netlify/functions/sync-athlete?${query}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json() as { warnings?: string[]; error?: string };
  if (![200, 207].includes(response.status)) throw new Error(body.error ?? 'No se pudo sincronizar el ciclista.');
  return { warnings: body.warnings ?? [] };
}
```

- [ ] **Step 4: Add synchronization state and reload**

Store `syncing` and `syncMessage` in `AthleteWorkspace`. On success, call `api.load(athlete.id)` and replace the current athlete. Map warnings to `Sincronización parcial: potencia`, `actividades`, or `entrenamientos` using a closed dictionary. On failure, show a generic retryable error.

- [ ] **Step 5: Render the button only for real linked athletes**

Extend `AthleteHeader` without changing the demo label:

```tsx
{!demo && onSync && (
  <button type="button" className="secondary-action" disabled={syncing} onClick={onSync}>
    {syncing ? 'Sincronizando…' : `Sincronizar ${athlete.name}`}
  </button>
)}
{syncMessage && <p className="connection-status" role="status">{syncMessage}</p>}
```

- [ ] **Step 6: Run targeted and full tests**

```bash
npm run test:run -- src/features/athletes/AthleteWorkspace.test.tsx tests/functions/sync-athlete.test.ts
npm run test:run
```

Expected: targeted tests and the full suite PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/features/athletes/AthleteWorkspace.test.tsx src/features/athletes/AthleteWorkspace.tsx src/features/athletes/AthleteHeader.tsx src/styles/global.css
git commit -m "feat: synchronize linked Intervals cyclists"
```

---

### Task 4: Secure macOS local configuration and real runtime

**Files:**
- Create: `scripts/lib/local-runtime.mjs`
- Create: `scripts/configure-local.mjs`
- Create: `scripts/dev-real.mjs`
- Create: `tests/scripts/local-runtime.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`

**Interfaces:**
- Keychain services: `mfpp.metabolic-lab.intervals-api-key` and `mfpp.metabolic-lab.owner-user-id`.
- Produces commands `npm run configure:real` and `npm run dev:real`.
- `configure:real` validates the Intervals key, creates or resolves the local Supabase owner, and stores only the API key and UUID in Keychain.
- `dev:real` launches Netlify Dev on `127.0.0.1:4174` with in-memory environment variables.

- [ ] **Step 1: Write failing pure-runtime tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseSupabaseEnvironment, redactRuntimeError } from '../../scripts/lib/local-runtime.mjs';

it('maps local Supabase values without exposing the secret to Vite', () => {
  const env = parseSupabaseEnvironment('API_URL="http://127.0.0.1:54321"\nPUBLISHABLE_KEY="public"\nSECRET_KEY="secret"');
  expect(env).toMatchObject({
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SECRET_KEY: 'secret',
    VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'public',
  });
  expect(env).not.toHaveProperty('VITE_SUPABASE_SECRET_KEY');
});

it('removes credentials from runtime errors', () => {
  expect(redactRuntimeError('request failed with secret-value', ['secret-value'])).toBe('No se pudo iniciar el entorno real.');
});
```

- [ ] **Step 2: Run runtime tests and verify RED**

```bash
npm run test:run -- tests/scripts/local-runtime.test.ts
```

Expected: FAIL because the runtime module does not exist.

- [ ] **Step 3: Implement deterministic environment parsing**

`parseSupabaseEnvironment` must accept only `API_URL`, `PUBLISHABLE_KEY`, and `SECRET_KEY`, strip matching quotes, require all three, and return the exact mapping in the test. `redactRuntimeError` must never echo input text when it contains any configured secret.

- [ ] **Step 4: Implement protected configuration flow**

`configure-local.mjs` must perform these steps in order:

```js
const apiKey = await promptHidden('Pega la clave API de Intervals.icu');
const response = await fetch('https://intervals.icu/api/v1/athletes', {
  headers: { Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`, Accept: 'application/json' },
  signal: AbortSignal.timeout(12_000),
});
if (!response.ok) throw new Error('La clave de Intervals.icu no es válida.');
const email = await promptText('Correo del propietario para Supabase local');
const owner = await createOrFindLocalOwner(email, localSupabaseEnvironment);
await storeKeychainSecret('mfpp.metabolic-lab.intervals-api-key', apiKey);
await storeKeychainSecret('mfpp.metabolic-lab.owner-user-id', owner.id);
```

Use `osascript` with `with hidden answer` for the API key. Use `security add-generic-password -U` with arguments passed through `spawn`, never a shell command string. Print only the roster count and owner email after validation.

Create the owner through `POST /auth/v1/admin/users` with the local secret key and `{ email, email_confirm: true }`. If Supabase reports an existing user, list admin users and match the exact normalized email. Never store the email as an authorization secret.

- [ ] **Step 5: Implement secret-free runtime launch**

`dev-real.mjs` must read both Keychain items using `security find-generic-password -w`, run `supabase status -o env`, parse it, and spawn:

```js
spawn('npx', ['netlify', 'dev', '--offline', '--host', '127.0.0.1', '--port', '4174'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...supabaseEnvironment,
    INTERVALS_API_KEY: intervalsKey,
    INTERVALS_OWNER_USER_ID: ownerId,
  },
});
```

Reject owner IDs that are not UUIDs and empty API keys before spawning. Do not print the child environment.

- [ ] **Step 6: Pin Netlify CLI and add commands**

Run:

```bash
npm install --save-dev --save-exact netlify-cli@27.4.3
```

Add:

```json
"configure:real": "node scripts/configure-local.mjs",
"dev:real": "node scripts/dev-real.mjs"
```

Keep `package-lock.json` committed. Add `.netlify/` to `.gitignore`.

- [ ] **Step 7: Extend the secret scanner test surface**

Ensure `scripts/check-secrets.mjs` scans new scripts and rejects literal values matching Intervals keys, Supabase secret keys, or JWTs. The service names are safe to version.

- [ ] **Step 8: Run script and complete verification**

```bash
npm run test:run -- tests/scripts/local-runtime.test.ts
npm run security:secrets
npm run verify
```

Expected: runtime tests PASS, no secrets detected, and the full verification command exits 0.

- [ ] **Step 9: Commit Task 4**

```bash
git add scripts/lib/local-runtime.mjs scripts/configure-local.mjs scripts/dev-real.mjs tests/scripts/local-runtime.test.ts package.json package-lock.json .gitignore scripts/check-secrets.mjs
git commit -m "chore: add secure local real-data runtime"
```

---

### Task 5: Documentation, end-to-end coverage, and one-cyclist live acceptance

**Files:**
- Modify: `tests/e2e/coach-workflow.spec.ts`
- Modify: `docs/operations.md`
- Modify: `README-DESPLIEGUE.md`
- Modify: `docs/acceptance-status.md`

**Interfaces:**
- Documents the operator flow without recording any secret.
- Produces evidence for roster discovery, one-athlete import, one synchronization, RLS, advisors, and secret scanning.

- [ ] **Step 1: Add the mocked E2E connection regression flow**

In `tests/e2e/coach-workflow.spec.ts`, intercept only the new function routes:

```ts
await page.route('**/.netlify/functions/intervals-connection', async (route) => {
  if (route.request().method() === 'GET') {
    await route.fulfill({ json: { athletes: [{ id: 'i123', name: 'Ana Ciclista' }] } });
    return;
  }
  await route.fulfill({ json: { added: 1, existing: 0, failed: [] } });
});
await page.getByRole('button', { name: 'Conectar Intervals.icu' }).click();
await page.getByRole('checkbox', { name: 'Ana Ciclista' }).check();
await page.getByRole('button', { name: 'Incorporar 1 ciclista' }).click();
await expect(page.getByText('1 ciclista incorporado')).toBeVisible();
```

- [ ] **Step 2: Run the E2E regression after the unit-tested UI tasks**

```bash
npm run test:e2e -- tests/e2e/coach-workflow.spec.ts
```

Expected: PASS because Tasks 2-3 already established the behavior through failing component tests before implementation. If it fails, diagnose the mismatch and add a failing component regression test before changing production code.

- [ ] **Step 3: Document exact local operation**

Add this operator sequence to `docs/operations.md` and `README-DESPLIEGUE.md`:

```bash
supabase start
npm run configure:real
npm run dev:real
```

Document that the login email is read in local Mailpit at `http://127.0.0.1:54324`, the application opens at `http://127.0.0.1:4174`, and Supabase Studio is at `http://127.0.0.1:54323`. State that API keys must be pasted only into the protected macOS dialog.

- [ ] **Step 4: Run the complete automated acceptance suite**

```bash
supabase db reset --local
supabase db advisors --local --type all --level warn --fail-on error
npm run verify
npm run test:e2e
```

Expected: database reset succeeds, advisors report no warning/error findings, all unit tests pass, build and secret scan pass, and all Playwright tests pass.

- [ ] **Step 5: Configure the real local owner and Intervals key**

Run `npm run configure:real`. The user pastes the API key into the protected macOS dialog and enters the owner email. Confirm only that the key was accepted, the number of accessible cyclists, and the owner UUID format; never print their values.

- [ ] **Step 6: Start the real runtime and sign in**

Run `npm run dev:real`, request the Supabase magic link from the application, open the local message in Mailpit, and complete the login. Verify the account UUID matches the configured owner without displaying access tokens.

- [ ] **Step 7: Import and synchronize one explicitly chosen cyclist**

Use the UI to discover the roster. The user chooses one cyclist. Import that cyclist, select it in Mesa de análisis, and synchronize it once. Do not import the remaining roster during this acceptance test.

- [ ] **Step 8: Verify persisted rows and RLS**

Use parameterized `psql` or Supabase CLI queries to verify:

- One `athletes` row for the chosen Intervals ID.
- One `coach_athletes` row for the owner and athlete.
- Imported `activities`, `observations`, `derived_results`, and `planned_workouts` counts are non-negative and consistent with returned warnings.
- All public tables retain RLS.
- A second test user cannot select the imported athlete through the Data API.

Record counts and warning component names in `docs/acceptance-status.md`; do not record the cyclist's name, API key, email, raw physiological values, or tokens.

- [ ] **Step 9: Repeat security verification after the live test**

```bash
npm run security:secrets
git status --short
git diff --check
supabase db advisors --local --type all --level warn --fail-on error
```

Expected: no secrets, no unexpected generated files, no whitespace errors, and no advisor issues.

- [ ] **Step 10: Commit Task 5**

```bash
git add tests/e2e/coach-workflow.spec.ts docs/operations.md README-DESPLIEGUE.md docs/acceptance-status.md
git commit -m "docs: verify real Intervals connection locally"
```

## Final review gate

- [ ] Confirm every production behavior was preceded by a failing test.
- [ ] Run `npm run verify` and `npm run test:e2e` from `/Users/manuelfrancisperezperez/Desktop/MFPP Metabolic Lab`.
- [ ] Run `supabase db advisors --local --type all --level warn --fail-on error`.
- [ ] Confirm `git remote` prints nothing and `git branch --show-current` prints `main`.
- [ ] Confirm no command modified `/Users/manuelfrancisperezperez/Desktop/Perfil metabolico`.
- [ ] Request code review before declaring the connection complete.
