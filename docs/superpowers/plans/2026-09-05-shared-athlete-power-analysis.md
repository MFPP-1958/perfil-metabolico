# Shared Athlete and Power Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make athlete, period, environment and synchronization global, then replace the Power demo with a traceable analysis of real Intervals.icu curve data.

**Architecture:** A React context owns validated non-sensitive preferences and exposes one synchronization action to every route. Authenticated Netlify Functions validate the internal athlete UUID and period, resolve the Intervals.icu identifier on the server, and persist normalized immutable curve snapshots and confirmed analysis runs in Supabase. The Power route reads those snapshots, applies the existing versioned ECP or Morton model in the client, and sends a complete result back for server-side verification and confirmation.

**Tech Stack:** React 19, TypeScript 5.9, React Router 7, Zod 4, Vitest, Testing Library, Playwright, Netlify Functions, Supabase/PostgreSQL 17, Chart.js 4.5.

**Spec:** `docs/superpowers/specs/2026-09-05-shared-athlete-power-analysis-design.md`

## Global Constraints

- Modify only `/Users/manuelfrancisperezperez/Desktop/MFPP Metabolic Lab`.
- Do not modify `/Users/manuelfrancisperezperez/Desktop/Perfil metabolico`.
- Default to 90 days; allow 30, 90, 180, 365 or a custom inclusive range of at most 730 days.
- Never place `INTERVALS_API_KEY`, `SUPABASE_SECRET_KEY`, physiological values or names in URLs, local storage or logs.
- Store only the authorized internal athlete UUID, period and environment in `localStorage`.
- Keep FTP, CP, W′ and Pmax separate in data, labels and reports.
- Never update zones, prescriptions or Intervals.icu from a confirmed power analysis.
- Keep synthetic demonstrations explicit and isolated from real state.
- Every code change follows a red-green TDD cycle and ends with a focused commit.

---

## File map

- `src/analysis/types.ts`: shared analysis-period, environment and sync-state contracts.
- `src/analysis/period.ts`: date resolution and validation without browser dependencies.
- `src/analysis/preferences.ts`: safe `localStorage` serialization and parsing.
- `src/analysis/AnalysisProvider.tsx`: authorized roster, active preferences and synchronization state.
- `src/analysis/AnalysisContextBar.tsx`: common athlete, period, environment and sync controls.
- `src/features/athletes/athleteApi.ts`: normalized roster/detail client extracted from the current workspace.
- `src/features/power/powerApi.ts`: read-snapshot and confirm-analysis browser client.
- `src/features/power/PowerWorkspace.tsx`: real-data route state and model selection.
- `src/features/power/PowerCurveChart.tsx`: accessible Chart.js rendering with log-duration axis.
- `netlify/functions/lib/analysis-period.ts`: strict request parsing shared by server functions.
- `netlify/functions/sync-athlete.ts`: period-aware synchronization and curve persistence.
- `netlify/functions/power-analysis.ts`: authorized snapshot reads and idempotent confirmations.
- `supabase/schemas/01_core.sql`: snapshot and confirmed-analysis tables and immutability trigger.
- `supabase/schemas/02_rls.sql`: RLS and grants for both new tables.
- `supabase/migrations/<timestamp>_add_power_analysis.sql`: generated reviewed migration applied without resetting real local data.

---

### Task 1: Period and preference domain

**Files:**
- Create: `src/analysis/types.ts`
- Create: `src/analysis/period.ts`
- Create: `src/analysis/preferences.ts`
- Create: `src/analysis/period.test.ts`
- Create: `src/analysis/preferences.test.ts`

**Interfaces:**
- Produces: `AnalysisPeriod`, `AnalysisEnvironment`, `SyncState`, `resolvePeriod(period, today)`, `loadAnalysisPreferences(storage, authorizedIds)`, `saveAnalysisPreferences(storage, value)`.
- Consumes: no application state or network services.

- [ ] **Step 1: Write failing date-resolution tests**

```ts
expect(resolvePeriod({ preset: 90 }, '2026-09-05')).toEqual({ oldest: '2026-06-08', newest: '2026-09-05', days: 90 });
expect(() => resolvePeriod({ preset: 'custom', oldest: '2024-01-01', newest: '2026-09-05' }, '2026-09-05')).toThrow('730');
expect(() => resolvePeriod({ preset: 'custom', oldest: '2026-09-06', newest: '2026-09-06' }, '2026-09-05')).toThrow('futuras');
```

- [ ] **Step 2: Run the period tests and verify RED**

Run: `npm run test:run -- src/analysis/period.test.ts`  
Expected: FAIL because `resolvePeriod` does not exist.

- [ ] **Step 3: Implement exact shared contracts and UTC-safe period resolution**

```ts
export type AnalysisPeriod =
  | { preset: 30 | 90 | 180 | 365 }
  | { preset: 'custom'; oldest: string; newest: string };
export type AnalysisEnvironment = 'all' | 'outdoor' | 'indoor';
export interface ResolvedPeriod { oldest: string; newest: string; days: number }
```

Use date-only UTC arithmetic. Presets are inclusive: `oldest = newest - (days - 1)`.

- [ ] **Step 4: Write failing preference-safety tests**

```ts
const saved = JSON.stringify({ athleteId: allowedId, period: { preset: 90 }, environment: 'all' });
expect(loadAnalysisPreferences(memoryStorage(saved), new Set([allowedId]))?.athleteId).toBe(allowedId);
expect(loadAnalysisPreferences(memoryStorage(saved), new Set())).toBeNull();
expect(saved).not.toContain('Jaume');
expect(saved).not.toContain('i593028');
```

- [ ] **Step 5: Implement strict preference parsing and persistence**

Use one key, `mfpp.analysis.preferences.v1`. Accept only UUID athlete IDs, the five period forms and three environments. Return `null` for malformed or unauthorized values.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm run test:run -- src/analysis/period.test.ts src/analysis/preferences.test.ts`  
Expected: PASS.

```bash
git add src/analysis
git commit -m "feat: add safe global analysis preferences"
```

---

### Task 2: Global provider and context controls

**Files:**
- Create: `src/features/athletes/athleteApi.ts`
- Create: `src/analysis/AnalysisProvider.tsx`
- Create: `src/analysis/AnalysisProvider.test.tsx`
- Create: `src/analysis/AnalysisContextBar.tsx`
- Create: `src/analysis/AnalysisContextBar.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/features/athletes/AthleteWorkspace.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: Task 1 contracts and the existing authenticated athlete/function APIs.
- Produces: `useAnalysis()`, `AnalysisProvider`, `AnalysisContextBar`, `athleteApi.list/load/sync`.

- [ ] **Step 1: Extract the current athlete API behind one module**

Move the existing `list`, `load`, `createObservation` and `sync` methods from
`AthleteWorkspace.tsx` to `athleteApi.ts` without changing request paths. Run the current
AthleteWorkspace tests before and after the move.

Run: `npm run test:run -- src/features/athletes/AthleteWorkspace.test.tsx`  
Expected: PASS before and after extraction.

- [ ] **Step 2: Write failing provider tests**

Test these observable behaviors:

```ts
expect(screen.getByLabelText('Ciclista activo')).toHaveValue(jaumeInternalId);
await user.click(screen.getByRole('link', { name: 'Potencia' }));
expect(screen.getByLabelText('Ciclista activo')).toHaveValue(jaumeInternalId);
expect(storage.getItem('mfpp.analysis.preferences.v1')).toContain(jaumeInternalId);
```

Also resolve two delayed roster/detail promises in reverse order and assert that the older
athlete response never becomes active.

- [ ] **Step 3: Implement `AnalysisProvider`**

Load the roster once per authenticated application mount. Restore preferences only after
the roster arrives. Increment a request generation on athlete/period changes. Expose:

```ts
const { athletes, athleteId, period, environment, sync, selectAthlete,
  setPeriod, setEnvironment, synchronize } = useAnalysis();
```

The synchronization call uses a generated `syncKey`, the resolved dates and internal UUID.

- [ ] **Step 4: Write failing context-bar interaction tests**

Cover preset selection, valid custom dates, invalid/future dates, environment selection,
disabled synchronization without an athlete, running state and complete/partial/failed copy.

- [ ] **Step 5: Build the common context bar**

Keep current typography and colors. Use semantic labels, a compact field group and one
primary button. Show `Última sincronización: fecha y hora` or `Todavía sin sincronizar`.
Custom dates appear only when `Personalizado` is selected. Error text uses `role="alert"`.

- [ ] **Step 6: Integrate provider and remove duplicate ownership**

Wrap `Application` with `AnalysisProvider`, render the bar once above `<Routes>`, and make
`AthleteWorkspace` consume the shared athlete selection. Keep its explicit Intervals roster
import panel and observation form. Do not duplicate the period controls inside the route.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm run test:run -- src/analysis/AnalysisProvider.test.tsx src/analysis/AnalysisContextBar.test.tsx src/features/athletes/AthleteWorkspace.test.tsx
npm run typecheck
```

Expected: all tests PASS and TypeScript exits 0.

```bash
git add src/analysis src/app/App.tsx src/features/athletes src/styles/global.css
git commit -m "feat: share athlete and period across routes"
```

---

### Task 3: Power snapshot database model

**Files:**
- Modify: `supabase/schemas/01_core.sql`
- Modify: `supabase/schemas/02_rls.sql`
- Modify: `tests/database/schema.test.ts`
- Create: `supabase/migrations/<generated_timestamp>_add_power_analysis.sql`

**Interfaces:**
- Consumes: existing `coach_can_access_athlete` and `coach_can_edit_athlete` functions.
- Produces: `public.power_curve_snapshots` and `public.power_analysis_runs`.

- [ ] **Step 1: Extend the schema contract test and verify RED**

Add both table names to the expected RLS list and assert:

```ts
expect(core).toContain('content_hash text not null');
expect(core).toContain('unique (athlete_id, sport, environment, oldest, newest, content_hash)');
expect(core).toContain('unique (snapshot_id, model, algorithm_version, created_by)');
expect(core).toContain('prevent_power_analysis_mutation');
expect(rls).toContain('power_curve_snapshots_select_authorized');
expect(rls).toContain('power_analysis_runs_insert_authorized');
```

Run: `npm run test:run -- tests/database/schema.test.ts`  
Expected: FAIL because the tables do not exist.

- [ ] **Step 2: Add constrained tables and indexes**

Use `jsonb_typeof(points) = 'array'`, `jsonb_typeof(source_models) = 'array'`,
`environment in ('all','outdoor','indoor')`, `model in ('ECP','MORTON_3P')`, non-negative
numeric checks, `oldest <= newest`, and indexes beginning with `athlete_id` and descending
time. `snapshot_id` uses `on delete restrict`.

- [ ] **Step 3: Add immutability and RLS**

Create a `before update or delete` trigger on `power_analysis_runs` that always raises
`Confirmed power analyses are immutable`. Grant authenticated SELECT through
`coach_can_access_athlete`; require edit access and `created_by = auth.uid()` for inserts.
Do not add an authenticated UPDATE or DELETE policy for confirmed runs.

- [ ] **Step 4: Generate and inspect the migration**

Run:

```bash
supabase db diff -f add_power_analysis
rg -n "power_curve_snapshots|power_analysis_runs|enable row level security|create policy" supabase/migrations/*_add_power_analysis.sql
```

Expected: one new migration containing both tables, constraints, trigger, grants and RLS.
Do not run `supabase db reset`, because the local database contains selected real cyclists.

- [ ] **Step 5: Apply without destroying existing data**

Run:

```bash
supabase migration up --local
supabase db lint --local --level warning
```

Expected: migration applies and database lint reports no schema errors.

- [ ] **Step 6: Run tests and commit**

Run: `npm run test:run -- tests/database/schema.test.ts`  
Expected: PASS.

```bash
git add supabase/schemas supabase/migrations tests/database/schema.test.ts
git commit -m "feat: persist immutable power analyses"
```

---

### Task 4: Period-aware synchronization and curve snapshots

**Files:**
- Create: `netlify/functions/lib/analysis-period.ts`
- Create: `tests/functions/analysis-period.test.ts`
- Modify: `netlify/functions/sync-athlete.ts`
- Modify: `tests/functions/sync-athlete.test.ts`
- Modify: `src/server/intervals/client.ts`
- Modify: `src/server/intervals/schemas.ts`
- Modify: `src/server/intervals/mappers.ts`
- Modify: `src/server/intervals/mappers.test.ts`

**Interfaces:**
- Consumes: internal athlete UUID, resolved date range, environment and `syncKey`.
- Produces: normalized `PowerCurveSnapshotPayload` and `SyncSummary`.

- [ ] **Step 1: Write failing request-validation tests**

Test valid UUID/date/environment input plus invalid UUID, future date, reverse range, 731
days, unknown JSON properties and bodies over 12 KB. Assert authorization happens before
any Intervals transport call.

Run: `npm run test:run -- tests/functions/analysis-period.test.ts tests/functions/sync-athlete.test.ts`  
Expected: FAIL because the new body contract is absent.

- [ ] **Step 2: Implement closed Zod parsing**

```ts
export const syncRequestSchema = z.strictObject({
  athleteId: z.uuid(),
  oldest: z.iso.date(),
  newest: z.iso.date(),
  environment: z.enum(['all', 'outdoor', 'indoor']),
  syncKey: z.string().regex(/^[a-zA-Z0-9_-]{6,80}$/),
});
```

Add the inclusive-day and future-date checks after parsing. Return Spanish 400/401/403/413
responses without echoing submitted values.

- [ ] **Step 3: Resolve the external athlete ID server-side**

Replace the public `athleteId=i...` query contract with the internal UUID request body.
Load `intervals_athlete_id` through the authorized coach relationship before constructing
any Intervals path.

- [ ] **Step 4: Request the exact period and environment**

Call activities/events with `oldest` and `newest`. Call power curves with one relative curve
`${days}d`, `newest` and `type=Ride`. For `indoor` send one serialized `ActivityFilter` with
`field_id: 'indoor'`, `operator: 'eq'` and `value: true`; for `outdoor` use the same filter
with `value: false`; for `all` omit `filters`. Preserve a component-level warning if a
request fails.

- [ ] **Step 5: Normalize and hash curve content**

Extend the mapper to return sorted unique positive `{ seconds, watts }` points and normalized
source models. Compute SHA-256 over canonical JSON containing points and models. Never hash
or persist the original upstream payload.

- [ ] **Step 6: Persist snapshots idempotently**

Insert with `resolution=ignore-duplicates` against
`athlete_id,sport,environment,oldest,newest,content_hash`. Changed content creates a new row;
identical content reuses the previous row. Keep the existing activity and observation
deduplication.

- [ ] **Step 7: Verify focused behavior and commit**

Run:

```bash
npm run test:run -- tests/functions/analysis-period.test.ts tests/functions/sync-athlete.test.ts src/server/intervals/mappers.test.ts
npm run typecheck
```

Expected: PASS with no network contact in tests.

```bash
git add netlify/functions src/server/intervals tests/functions
git commit -m "feat: synchronize period power snapshots"
```

---

### Task 5: Authorized power read and confirmation API

**Files:**
- Create: `netlify/functions/power-analysis.ts`
- Create: `tests/functions/power-analysis.test.ts`
- Create: `src/features/power/powerApi.ts`
- Create: `src/features/power/powerApi.test.ts`
- Modify: `tests/security/netlify-config.test.ts`

**Interfaces:**
- Consumes: Task 3 tables, Task 4 normalized snapshots and the existing fitting functions.
- Produces: `powerApi.load(query, signal)` and `powerApi.confirm(input)`.

- [ ] **Step 1: Write failing GET authorization tests**

Assert 401 without a bearer token, 403 for an athlete outside the roster, 400 for an invalid
range/filter and 200 with only the latest exact-context snapshot. The response contract is:

```ts
interface PowerSnapshot {
  id: string;
  athleteId: string;
  oldest: string;
  newest: string;
  environment: AnalysisEnvironment;
  points: Array<{ seconds: number; watts: number }>;
  sourceModels: SourcePowerModel[];
  synchronizedAt: string;
  ftp: { value: number; observedAt: string; quality: 'imported_estimate' } | null;
}
```

- [ ] **Step 2: Implement authorized GET**

Authenticate, authorize the internal UUID, query the exact period/environment ordered by
`synchronized_at desc`, limit one, and fetch the latest FTP observation separately. Parse
database JSON with Zod before returning it.

- [ ] **Step 3: Write failing confirmation tests**

Send snapshot ID, selected model and client result. Assert the server reloads the snapshot,
recalculates with `fitPowerDuration`, rejects mismatched numbers, inserts the server result,
and returns the existing row for an identical snapshot/model/version confirmation.

- [ ] **Step 4: Implement POST confirmation**

Use tolerance `0.01` only to compare the client display with the server recalculation. Store
the server values, model version, quality and confirmation time. Never accept `createdBy`,
`athleteId`, CP, W′, Pmax or RMSE as database authority from the browser.

- [ ] **Step 5: Implement the browser client**

Use `getAccessToken()`, JSON body for POST, `AbortSignal` for GET and specific Spanish errors
for 401, 403, 404 and 409. No physiological data enters the URL; GET identifies only internal
UUID, dates and environment.

- [ ] **Step 6: Run security tests and commit**

Run:

```bash
npm run test:run -- tests/functions/power-analysis.test.ts src/features/power/powerApi.test.ts tests/security/netlify-config.test.ts
npm run security:secrets
```

Expected: PASS and no secret patterns.

```bash
git add netlify/functions/power-analysis.ts tests/functions/power-analysis.test.ts src/features/power tests/security/netlify-config.test.ts
git commit -m "feat: add traceable power analysis API"
```

---

### Task 6: Real Power workspace

**Files:**
- Create: `src/features/power/PowerWorkspace.tsx`
- Create: `src/features/power/PowerWorkspace.test.tsx`
- Create: `src/features/power/PowerCurveChart.tsx`
- Create: `src/features/power/PowerCurveChart.test.tsx`
- Modify: `src/features/power/PowerDurationView.tsx`
- Modify: `src/features/power/PowerDurationView.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: `useAnalysis()`, `powerApi`, `fitPowerDuration`, `assessCurveCompleteness`.
- Produces: the real `/potencia` route with explicit demo fallback.

- [ ] **Step 1: Write failing workspace state tests**

Cover no cyclist, selected cyclist without snapshot, loading, stale cached snapshot, partial
sync warning, complete snapshot, model error and successful confirmation. Assert no GET is
made until a valid athlete and period exist, and an aborted old response cannot replace the
new cyclist.

- [ ] **Step 2: Implement request lifecycle**

Resolve the period from the global context, call `powerApi.load`, cancel on dependency
change, and keep separate `loading`, `error`, `snapshot`, `model` and `confirmation` state.
Default to Morton only when curve quality includes short and long coverage; otherwise use
ECP when it has at least two points of two minutes or more.

- [ ] **Step 3: Write failing chart tests**

Assert Chart.js receives a logarithmic x-axis, observed and modelled datasets with distinct
labels, no animation under reduced motion, and an adjacent accessible data table.

- [ ] **Step 4: Build the chart wrapper**

Register only required Chart.js controllers/elements/scales. Destroy the chart on unmount.
Use the existing navy, blue and amber tokens; do not create a decorative gradient. Keep the
table visible on desktop and horizontally scrollable on narrow screens.

- [ ] **Step 5: Adapt `PowerDurationView` for real context**

Render observed bests at exact durations only when present. Keep imported FTP in a separate
panel. Show CP, W′, Pmax, RMSE, residuals, source window, environment, algorithm version and
quality warnings. A failed fit must render a recoverable message instead of throwing the
route.

- [ ] **Step 6: Add model selection and confirmation**

Use a labelled radio group for ECP/Morton. **Confirmar análisis** sends snapshot ID and model,
disables while saving and renders the immutable confirmation timestamp returned by the
server. It never changes zones or prescriptions.

- [ ] **Step 7: Verify component accessibility and commit**

Run:

```bash
npm run test:run -- src/features/power/PowerWorkspace.test.tsx src/features/power/PowerCurveChart.test.tsx src/features/power/PowerDurationView.test.tsx
npm run typecheck
npm run lint
```

Expected: all commands exit 0.

```bash
git add src/features/power src/app/App.tsx src/styles/global.css
git commit -m "feat: replace power demo with real analysis"
```

---

### Task 7: End-to-end flow, production safety and operations

**Files:**
- Modify: `tests/e2e/coach-workflow.spec.ts`
- Modify: `tests/e2e/accessibility.spec.ts`
- Modify: `tests/e2e/visual.spec.ts`
- Modify: `docs/operations.md`
- Modify: `docs/acceptance-status.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: reproducible evidence that the first block works without real external calls in CI.

- [ ] **Step 1: Add an E2E fixture flow**

In E2E mode, provide two authorized cyclists and two delayed power snapshots. Test selection
of the first, navigation to Potencia, change to 180 days, selection of the second, reverse
resolution of requests, model choice and analysis confirmation. Assert only the second
ciclist's data remains visible.

- [ ] **Step 2: Extend accessibility and responsive checks**

Run axe on the populated Power route; navigate all controls by keyboard; test mobile,
tablet and 200 % zoom. Assert the chart has a visible table alternative and no clipped
confirmation action.

- [ ] **Step 3: Run the full automated gate**

Run:

```bash
npm run verify
npm run test:e2e
supabase db lint --local --level warning
npm audit --omit=dev
```

Expected: 0 failed tests, successful typecheck/lint/build/secret scan, no database lint
errors and 0 production dependency vulnerabilities.

- [ ] **Step 4: Perform real local acceptance without resetting data**

Start `npm run dev:real`, select Jaume, synchronize 90 days, open Potencia, switch between
ECP and Morton where coverage permits, and confirm one analysis. Repeat synchronization and
verify counts for the same snapshot and analysis remain unchanged. Record only row counts,
statuses and dates; do not copy names or physiological values into documentation.

- [ ] **Step 5: Update operations and acceptance status**

Document the global controls, stale-cache behavior, confirmation immutability and recovery
steps. Mark the block accepted only if the real flow and all automated gates pass.

- [ ] **Step 6: Commit final acceptance evidence**

```bash
git add tests/e2e docs/operations.md docs/acceptance-status.md
git commit -m "test: accept shared athlete power workflow"
```

---

## Completion definition

The block is complete only when all seven tasks are committed, the full verification gate
passes on the final tree, the local database migration is applied without losing existing
cyclists, and a real selected cyclist can synchronize and confirm a traceable Power analysis
while the same athlete and period remain selected across every route.
