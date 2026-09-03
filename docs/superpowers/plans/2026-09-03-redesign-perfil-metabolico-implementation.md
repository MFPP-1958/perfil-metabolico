# Professional Metabolic Profile Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static prototype with a private, traceable and tested cycling physiology application while preserving the existing dashboard as a migration reference.

**Architecture:** A React and TypeScript frontend talks only to authenticated Netlify functions. Supabase provides authentication and PostgreSQL persistence with row-level security; a typed server adapter is the only component allowed to call Intervals.icu. Physiological calculations live in a pure, versioned domain package and never infer one physiological construct from another without an explicit method.

**Tech Stack:** Node.js 22, TypeScript 5, React 19, Vite 7, Vitest, Testing Library, Zod, Supabase Auth/PostgreSQL, Netlify Functions, Chart.js 4, Playwright, axe-core.

**Spec:** `docs/superpowers/specs/2026-09-03-redesign-perfil-metabolico-design.md`

## Global Constraints

- The production browser must never receive the Intervals.icu API key or a Supabase secret/service-role key.
- Every database table in the exposed `public` schema must have RLS enabled and policies must combine `TO authenticated` with ownership predicates.
- Every physiological value must retain value, unit, date, origin, quality, protocol and algorithm version where applicable.
- FTP, eFTP, CP, MLSS, LT1, VT1, Pmax, 5-second power, P@VO2max, FRC and W-prime remain separate metrics.
- Mader outputs are experimental and cannot update zones automatically.
- Prescription output is a draft until explicitly approved by the coach.
- The current `public/index.html` remains available as reference until migration acceptance.
- Implement behavior test-first and commit after every task.

---

## Phase 0 — Containment

### Task 1: Establish the TypeScript test and build foundation

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `eslint.config.js`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/test/setup.ts`
- Create: `src/smoke.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`.

- [x] Write `src/smoke.test.ts` asserting that the test environment exposes `document`.
- [x] Run `npm test -- --run src/smoke.test.ts` and confirm it fails before dependencies and configuration exist.
- [x] Add pinned dependencies and scripts; generate and commit the lockfile with `npm install`.
- [x] Run the smoke test, typecheck, lint and production build.
- [x] Commit foundation files with `chore: establish typed application foundation`.

### Task 2: Secure and narrow the legacy proxy

**Files:**
- Create: `netlify/functions/lib/http.js`
- Create: `netlify/functions/lib/authorization.js`
- Create: `tests/functions/intervals.test.js`
- Modify: `netlify/functions/intervals.js`
- Modify: `netlify.toml`
- Modify: `README-DESPLIEGUE.md`

**Interfaces:**
- Produces: `authorizeAthlete(userId: string, athleteId: string): Promise<boolean>`.
- Produces: server-owned route handlers for athletes, athlete profile, activities, power curves, streams, intervals and planned events.
- Consumes: `INTERVALS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and bearer access token.

- [x] Write tests that reject anonymous requests, arbitrary paths, unknown athletes, unsupported query keys and non-GET methods.
- [x] Write a test proving that sensitive Athlete and Wellness fields are never returned.
- [x] Run the function tests and confirm the current proxy fails the new authentication and athlete-authorization cases.
- [x] Replace the client-provided path proxy with named operations and server-side URL construction.
- [x] Validate the Supabase bearer token and authorization record before calling Intervals.icu.
- [x] Add bounded time ranges, response sizes, timeouts and safe error bodies.
- [x] Remove the query-string access code flow and the optional unauthenticated production mode.
- [x] Pin security headers and remove the production dependency on inline script execution from the new app entry point.
- [x] Run function tests and `npm run lint`.
- [x] Commit with `security: authenticate and constrain Intervals access`.

### Task 3: Preserve the prototype and correct dangerous legacy behavior

**Files:**
- Create: `legacy/dashboard-v7.html`
- Create: `tests/legacy/legacy-safety.test.ts`
- Modify: `public/index.html`
- Remove after copy verification: `dashboard_metabolico_mfpp_v7_filtro_ids_entrenados.html`

**Interfaces:**
- Produces: a read-only legacy reference under `legacy/` and a neutral application entry point.

- [x] Write tests that detect automatic demo loading, unsafe athlete-name HTML insertion and the incorrect seconds-to-hours conversion.
- [x] Run the tests and confirm each test fails against the current HTML.
- [x] Move the unused historical dashboard into `legacy/` and document that it is not published.
- [x] Stop loading the demo automatically, escape all imported/user text and correct duration formatting.
- [x] Disable automatic prescriptions and direct FATmax-to-LT1 application in the legacy screen.
- [x] Run legacy safety tests and inspect the page at desktop and mobile widths.
- [x] Commit with `fix: contain unsafe legacy dashboard behavior`.

---

## Phase 1 — Private Modular Platform

### Task 4: Create the domain contracts and validation catalog

**Files:**
- Create: `src/domain/metrics.ts`
- Create: `src/domain/observation.ts`
- Create: `src/domain/test-session.ts`
- Create: `src/domain/activity.ts`
- Create: `src/domain/report.ts`
- Create: `src/domain/validation.ts`
- Create: `src/domain/validation.test.ts`

**Interfaces:**
- Produces: `MetricCode`, `Observation`, `TestSession`, `DerivedResult`, `ActivitySummary`, `PlannedWorkout`, `ReportSnapshot`.
- Produces: Zod schemas with exact unit and range checks.

- [x] Write failing tests for invalid units, impossible negative values, missing provenance and forbidden silent metric substitutions.
- [x] Run `npm test -- --run src/domain/validation.test.ts` and confirm failure.
- [x] Implement discriminated domain schemas and a metric/unit catalog.
- [x] Add explicit quality states: `measured`, `imported_estimate`, `calculated`, `incomplete`, `rejected`.
- [x] Run domain tests and typecheck.
- [x] Commit with `feat: define traceable physiological domain contracts`.

### Task 5: Add Supabase schema, indexes and RLS

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/schemas/01_core.sql`
- Create: `supabase/schemas/02_rls.sql`
- Create: `supabase/seed.sql`
- Create: `tests/database/schema.test.ts`
- Create: `docs/database.md`

**Interfaces:**
- Produces tables: `coach_profiles`, `athletes`, `coach_athletes`, `observations`, `test_sessions`, `derived_results`, `activities`, `planned_workouts`, `prescriptions`, `reports`, `audit_events`.
- Produces ownership policies based on `(select auth.uid())` and `coach_athletes` membership.

- [x] Write schema assertions for primary keys, foreign keys, uniqueness, timestamps, metric check constraints and required indexes.
- [x] Write policy assertions proving another authenticated coach cannot read or mutate an athlete.
- [x] Run database schema tests and confirm failure before schemas exist. Local execution is pending a container runtime.
- [x] Create declarative schemas with `uuid` keys, `timestamptz`, constrained text catalogs and indexes on foreign keys and date filters.
- [x] Enable RLS on every public table; add separate select/insert/update/delete policies with `USING` and `WITH CHECK` where required.
- [x] Revoke anonymous access to all professional data.
- [ ] Generate and review a migration using the installed Supabase CLI workflow.
- [ ] Run migrations, database tests and Supabase advisors locally.
- [x] Commit declarative schemas and documentation with `feat: add private metabolic data store`.

Environment note: `supabase` 2.116.0 is installed, but neither Docker nor Podman is
available. Migration generation, local policy integration tests and advisors remain
unchecked until a container runtime or a disposable Supabase project is provided.

### Task 6: Implement authenticated application shell

**Files:**
- Modify: `index.html`
- Replace: `src/main.ts` with `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/app/routes.tsx`
- Create: `src/auth/supabase.ts`
- Create: `src/auth/AuthGate.tsx`
- Create: `src/auth/AuthGate.test.tsx`
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`
- Modify: `netlify.toml`

**Interfaces:**
- Produces: `AuthGate`, authenticated routes and `getAccessToken(): Promise<string>`.
- Consumes: publishable `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` only.

- [x] Write component tests for signed-out, loading, signed-in and expired-session states.
- [x] Run tests and confirm failure before the shell exists.
- [x] Implement passwordless email sign-in and sign-out using a publishable key.
- [x] Add route protection, session expiry handling and a visible current-user menu.
- [x] Build responsive semantic navigation with keyboard operation and visible focus.
- [x] Verify no secret-named environment variable is referenced from `src/`.
- [x] Run component tests, axe checks, typecheck and build.
- [x] Commit with `feat: add authenticated responsive application shell`.

### Task 7: Implement the typed Intervals.icu adapter and synchronization API

**Files:**
- Create: `src/server/intervals/schemas.ts`
- Create: `src/server/intervals/client.ts`
- Create: `src/server/intervals/mappers.ts`
- Create: `src/server/intervals/mappers.test.ts`
- Create: `src/server/intervals/fixtures/*.json`
- Create: `netlify/functions/athletes.ts`
- Create: `netlify/functions/sync-athlete.ts`
- Create: `netlify/functions/activity-detail.ts`
- Create: `tests/functions/sync-athlete.test.ts`

**Interfaces:**
- Produces: `IntervalsClient.getAthlete`, `getActivities`, `getPowerCurves`, `getActivityStreams`, `getActivityIntervals`, `getPlannedWorkouts`.
- Produces: `mapSportSettings`, `mapPowerCurve`, `mapActivity`, `mapPlannedWorkout`.

- [x] Create anonymized fixtures covering null fields, indoor/outdoor FTP, multiple sports, ECP and Morton models, missing efforts and partial API failure.
- [x] Write mapper tests asserting explicit field origins and distinct metric codes.
- [x] Write synchronization tests for authorization, partial failure and stale-request cancellation.
- [x] Run mapper tests and confirm failure.
- [x] Implement strict Zod parsing and explicit field mapping; reject unknown response shapes with a safe diagnostic.
- [x] Implement authenticated functions with server-side athlete checks, bounded concurrency, timeout and partial-result reporting.
- [x] Persist only normalized fields and synchronization metadata.
- [x] Add cancellation keys so stale synchronization results cannot replace a newer athlete request.
- [x] Run adapter, function and database tests.
- [x] Commit with `feat: synchronize typed Intervals athlete data`.

### Task 8: Build athlete selection, data quality and observation entry

**Files:**
- Create: `src/features/athletes/AthleteSelector.tsx`
- Create: `src/features/athletes/AthleteHeader.tsx`
- Create: `src/features/athletes/DataQualityPanel.tsx`
- Create: `src/features/observations/ObservationForm.tsx`
- Create: `src/features/observations/ObservationCard.tsx`
- Create: `src/features/observations/ObservationHistory.tsx`
- Create: `src/features/observations/observations.test.tsx`

**Interfaces:**
- Consumes: domain observation schemas and authenticated athlete API.
- Produces: athlete-scoped context and immutable observation creation flow.

- [x] Write tests for empty startup, athlete switching, stale request cancellation, provenance display and validation errors.
- [x] Run tests and confirm failure.
- [x] Implement searchable athlete selection and a persistent identity/period header.
- [x] Implement quality chips using text and shape as well as color.
- [x] Implement protocol-aware observation forms and immutable history.
- [x] Add a separate, unmistakable demo mode using synthetic data.
- [x] Run tests, axe checks and responsive browser verification.
- [x] Commit with `feat: add athlete workspace and traceable observations`.

---

## Phase 2 — Validatable Physiology Engine

### Task 9: Implement versioned power-duration analysis

**Files:**
- Create: `src/physiology/power-duration/types.ts`
- Create: `src/physiology/power-duration/fit.ts`
- Create: `src/physiology/power-duration/quality.ts`
- Create: `src/physiology/power-duration/fit.test.ts`
- Create: `src/features/power/PowerDurationView.tsx`
- Create: `src/features/power/PowerDurationView.test.tsx`

**Interfaces:**
- Produces: `fitPowerDuration(input, modelType): PowerDurationFit` with input points, residuals, RMSE, CP, W-prime, Pmax and warnings.
- Produces: `assessCurveCompleteness(points): CurveQuality`.

- [x] Write numeric fixture tests for ECP and Morton model outputs and missing-domain warnings.
- [x] Run tests and confirm failure.
- [x] Implement model adapters without converting FTP into CP or 5-second power into Pmax.
- [x] Implement residual and curve-completeness checks.
- [x] Render observed/modelled curves, input points, units, period, sport, indoor state and uncertainty text.
- [x] Provide an accessible result table matching the graph.
- [x] Run numeric, component and accessibility tests.
- [x] Commit with `feat: add versioned power duration analysis`.

### Task 10: Implement physiological durability

**Files:**
- Create: `src/physiology/durability/calculate.ts`
- Create: `src/physiology/durability/calculate.test.ts`
- Create: `src/features/durability/DurabilityView.tsx`
- Create: `src/features/durability/DurabilityView.test.tsx`

**Interfaces:**
- Produces: `calculateDurability(fresh, fatigued, workload): DurabilityResult`.
- Input workload includes `priorKjPerKg`, `priorWorkAboveCpKj` and intensity distribution.

- [x] Write tests for percentage decline, missing matched durations, incompatible conditions and insufficient observations.
- [x] Run tests and confirm failure.
- [x] Implement matched-duration comparisons at 10 seconds, 1, 5 and 20 minutes.
- [x] Include workload context and observation counts; do not output a generic stamina score.
- [x] Render fresh/fatigued comparison, onset of deterioration and confidence warnings.
- [x] Run numeric, component and accessibility tests.
- [x] Commit with `feat: quantify cycling durability from accumulated work`.

### Task 11: Implement the guided lactate sprint protocol

**Files:**
- Create: `src/physiology/lactate/protocol.ts`
- Create: `src/physiology/lactate/protocol.test.ts`
- Create: `src/features/tests/LactateSprintWizard.tsx`
- Create: `src/features/tests/LactateSprintWizard.test.tsx`

**Interfaces:**
- Produces: `evaluateLactateSprint(session): LactateSprintAssessment`.
- Produces either `peak_accumulation_rate`, `vlamax_estimate` or `invalid`, with reasons and sensitivity bounds.

- [x] Write tests for high baseline lactate, absent minute labels, no confirmed peak, invalid alactic time and complete protocol.
- [x] Run tests and confirm failure.
- [x] Implement protocol validation, peak detection and sensitivity to alactic-time method.
- [x] Build the wizard for preparation, sprint configuration, samples, review and coach confirmation.
- [x] Prevent incomplete protocols from producing a VLa-max label.
- [x] Represent raw samples separately from the versioned derived assessment so persistence can remain immutable.
- [x] Run numeric, component and accessibility tests.
- [x] Commit with `feat: add evidence graded lactate sprint testing`.

### Task 12: Isolate the experimental Mader model

**Files:**
- Create: `src/physiology/mader/model.ts`
- Create: `src/physiology/mader/model.test.ts`
- Create: `src/physiology/mader/references.ts`
- Create: `src/features/experimental/MaderView.tsx`
- Create: `src/features/experimental/MaderView.test.tsx`

**Interfaces:**
- Produces: `runMaderModel(inputs, config): ExperimentalMaderResult`.
- Result includes MLSS estimate, FATmax estimate, input lineage, version, cadence warning and sensitivity range.

- [x] Port the current equations into tests and independently calculate reference cases.
- [x] Add tests proving missing measured-compatible inputs block execution and FATmax cannot update LT1.
- [x] Run tests and confirm failure before implementation.
- [x] Implement the pure model with declared constants, versions and sensitivity runs.
- [x] Build an experimental-only view with evidence notice and comparison to separately stored FTP, CP, LT2 or MLSS.
- [x] Require coach acknowledgement before including results in reports.
- [x] Run numeric, component and accessibility tests.
- [x] Commit with `feat: isolate experimental Mader analysis`.

### Task 13: Build longitudinal evolution views

**Files:**
- Create: `src/physiology/change/meaningful-change.ts`
- Create: `src/physiology/change/meaningful-change.test.ts`
- Create: `src/features/evolution/EvolutionView.tsx`
- Create: `src/features/evolution/EvolutionView.test.tsx`

**Interfaces:**
- Produces: `classifyChange(previous, current, typicalError): ChangeAssessment`.

- [ ] Write tests for changes below, within and above measurement error and for incompatible protocols.
- [ ] Run tests and confirm failure.
- [ ] Implement protocol-compatible comparisons and change classification.
- [ ] Render timelines with source, model version, uncertainty and filters.
- [ ] Suppress directional claims when observations are incompatible.
- [ ] Run tests and accessibility checks.
- [ ] Commit with `feat: add uncertainty aware athlete evolution`.

---

## Phase 3 — Coach Workflow

### Task 14: Compare structured prescribed and completed sessions

**Files:**
- Create: `src/training/alignment/types.ts`
- Create: `src/training/alignment/align.ts`
- Create: `src/training/alignment/align.test.ts`
- Create: `src/features/sessions/SessionReview.tsx`
- Create: `src/features/sessions/SessionReview.test.tsx`

**Interfaces:**
- Produces: `alignWorkout(planned, completed): SessionAlignment` with warm-up, work, recovery and cooldown blocks.

- [ ] Write tests for exact match, skipped repetition, early stop, extra repetition, mixed targets and title-only fallback.
- [ ] Run tests and confirm failure.
- [ ] Implement ordered block alignment using structured workout data first.
- [ ] Keep title parsing as a manual fallback with an explicit low-confidence label.
- [ ] Calculate block-specific duration, power, variability, HR, cadence, RPE and compliance.
- [ ] Render partial failures and permit coach notes.
- [ ] Run unit, component and accessibility tests.
- [ ] Commit with `feat: compare structured workouts with completed sessions`.

### Task 15: Create explainable, coach-approved prescriptions

**Files:**
- Create: `src/prescription/rules.ts`
- Create: `src/prescription/generate.ts`
- Create: `src/prescription/generate.test.ts`
- Create: `src/features/prescription/PrescriptionEditor.tsx`
- Create: `src/features/prescription/PrescriptionEditor.test.tsx`

**Interfaces:**
- Produces: `generatePrescriptionDraft(context): PrescriptionDraft`.
- Produces: approval transition `draft -> approved` with coach, timestamp and immutable evidence snapshot.

- [ ] Write tests proving missing goals, phase or availability block generation and that no draft is approved automatically.
- [ ] Write tests for minor age bands preventing permanent phenotype labels and automatic specialization.
- [ ] Run tests and confirm failure.
- [ ] Implement a compact rule catalog with cited rationale, dosage, progression, cancellation and evaluation criteria.
- [ ] Build an editor that exposes evidence, missing context and coach overrides.
- [ ] Persist draft and approval as separate audited actions.
- [ ] Run unit, component, RLS and accessibility tests.
- [ ] Commit with `feat: add explainable coach approved prescriptions`.

### Task 16: Generate audience-specific reports

**Files:**
- Create: `src/reports/build-report.ts`
- Create: `src/reports/build-report.test.ts`
- Create: `src/features/reports/ReportBuilder.tsx`
- Create: `src/features/reports/ReportBuilder.test.tsx`
- Create: `src/styles/report.css`

**Interfaces:**
- Produces: `buildReportSnapshot(audience, approvedData): ReportSnapshot`.

- [ ] Write tests for coach, cyclist and family variants, missing approval, source citations and model-version display.
- [ ] Run tests and confirm failure.
- [ ] Implement report snapshots from approved results only.
- [ ] Build print-specific templates without settings, credentials, navigation or unrelated tabs.
- [ ] Add plain-language explanations and limitations appropriate to each audience.
- [ ] Verify PDF output visually at A4 and confirm no clipped tables or charts.
- [ ] Run report, accessibility and build tests.
- [ ] Commit with `feat: generate reproducible athlete reports`.

### Task 17: Complete security, accessibility, operations and migration acceptance

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/coach-workflow.spec.ts`
- Create: `tests/e2e/authorization.spec.ts`
- Create: `tests/e2e/accessibility.spec.ts`
- Create: `.github/workflows/ci.yml`
- Create: `docs/operations.md`
- Create: `docs/privacy-checklist.md`
- Create: `docs/model-register.md`
- Modify: `README-DESPLIEGUE.md`
- Modify: `netlify.toml`

**Interfaces:**
- Produces: reproducible CI and operational acceptance evidence for the complete application.

- [ ] Write end-to-end tests for authentication, athlete isolation, synchronization, test entry, analysis, session review, prescription approval and report generation.
- [ ] Add automated axe scans for every primary route and keyboard traversal checks.
- [ ] Add CI jobs for lockfile install, typecheck, lint, unit tests, database tests, build and E2E tests.
- [ ] Add dependency audit, secret scan and production-header assertions.
- [ ] Document environment setup, key rotation, backups, restore drill, retention, export, deletion and incident response.
- [ ] Document every model version, evidence category, inputs, outputs and limitations.
- [ ] Run the complete verification suite from a clean install.
- [ ] Inspect desktop, tablet, mobile, 200% zoom, keyboard navigation, screen-reader names and A4 reports.
- [ ] Confirm all 15 acceptance criteria in the approved specification with recorded evidence.
- [ ] Archive the legacy dashboard only after confirming no unique workflow remains.
- [ ] Commit with `release: complete professional metabolic profile application`.

## Execution Order and Checkpoints

Tasks run strictly in numerical order. Phase checkpoints occur after Tasks 3, 8, 13 and
17. At each checkpoint:

1. Run the full test, lint, typecheck and build suite available at that point.
2. Review the diff against the specification.
3. Record unresolved external configuration separately from code defects.
4. Commit only when the checkpoint is clean.

The absence of live Supabase or Intervals.icu credentials must not cause tests to contact
production. Contract tests use anonymized fixtures; live smoke tests are an explicit,
manual deployment step.
