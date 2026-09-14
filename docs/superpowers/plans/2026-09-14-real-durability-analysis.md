# Real Durability Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir `/durabilidad` en un análisis trazable del perfil de potencia récord de un ciclista antes y después de los umbrales de trabajo acumulado `kJ0` y `kJ1` de Intervals.icu.

**Architecture:** La sincronización global solicitará en una sola llamada la curva fresca y las dos curvas fatigadas, las normalizará y las guardará transaccionalmente en Supabase. Una función autenticada recalculará el resultado en servidor y una pantalla React consumirá la última instantánea compatible con el contexto global, siguiendo el patrón de cancelación y caché de Potencia.

**Tech Stack:** Node.js 22.x, TypeScript 5.9.3, React 19.2.8, React Router 7.18.3, Zod 4.5.4, Chart.js 4.5.1, Supabase/PostgreSQL local, Netlify Functions, Vitest 3.2.7 y Playwright 1.62.1.

**Spec:** `docs/superpowers/specs/2026-09-12-real-durability-analysis-design.md`

## Global Constraints

- Trabajar solo en `/Users/manuelfrancisperezperez/Desktop/MFPP Metabolic Lab`; no modificar `/Users/manuelfrancisperezperez/Desktop/Perfil metabolico`.
- Mantener una única sincronización global por ciclista, periodo y entorno; entrar en una ruta nunca contacta por sí solo con Intervals.icu.
- Usar exclusivamente curvas fresca, `kJ0` y `kJ1`; no descargar streams de actividades en esta fase.
- Comparar puntos exactos de 10, 60, 300 y 1.200 segundos; no interpolar ni extrapolar.
- Conservar el signo del descenso y no producir una puntuación general de durabilidad.
- Tratar la etiqueta como calidad de cobertura, no como confianza fisiológica.
- El navegador no puede crear instantáneas, elegir el atleta de una instantánea ni aportar resultados calculados como fuente de verdad.
- Las confirmaciones son inmutables y el servidor recalcula desde la instantánea persistida.
- Mantener las versiones fijadas en `package.json`; no añadir dependencias.
- Preservar la última instantánea válida ante actualizaciones parciales, fallos remotos y respuestas obsoletas.

---

### Task 1: Contrato y normalización de curvas fatigadas de Intervals.icu

**Files:**
- Create: `src/server/intervals/fixtures/durability-curves.json`
- Modify: `src/server/intervals/schemas.ts`
- Modify: `src/server/intervals/mappers.ts`
- Modify: `src/server/intervals/mappers.test.ts`
- Modify: `src/server/intervals/client.ts`
- Test: `src/server/intervals/client.test.ts`

**Interfaces:**
- Consumes: respuesta `DataCurveSetPowerCurve` y el formato de curvas `<period>`, `<period>-kj0`, `<period>-kj1` documentado en `docs/intervals-icu-openapi.json`.
- Produces: `mapDurabilityCurves(input: unknown): NormalizedDurabilityCurves` y `IntervalsClient.getDurabilityCurves(athleteId, period, newest, indoor?)`.

- [ ] **Step 1: Crear un fixture mínimo con orden variable y procedencia por punto**

```json
{
  "list": [
    { "id": "90d-kj1", "after_kj": 1400, "weight": 70, "secs": [10, 60, 300, 1200], "values": [820, 370, 260, 212], "activity_id": ["i3", "i3", "i4", "i4"], "submax_values": [[810, 805], [365], [255], [208]], "submax_activity_id": [["i5", "i6"], ["i5"], ["i6"], ["i6"]], "start_index": [1, 2, 3, 4], "end_index": [11, 62, 303, 1204], "powerModels": [] },
    { "id": "90d", "weight": 70, "secs": [10, 60, 300, 1200], "values": [900, 410, 285, 238], "activity_id": ["i1", "i1", "i2", "i2"], "start_index": [1, 2, 3, 4], "end_index": [11, 62, 303, 1204], "powerModels": [] },
    { "id": "90d-kj0", "after_kj": 700, "weight": 70, "secs": [10, 60, 300, 1200], "values": [870, 395, 274, 226], "activity_id": ["i2", "i2", "i3", "i3"], "start_index": [1, 2, 3, 4], "end_index": [11, 62, 303, 1204], "powerModels": [] }
  ]
}
```

- [ ] **Step 2: Escribir pruebas que exijan clasificación por sufijo, orden estable y rechazo aislado**

```ts
it('maps fresh, kj0 and kj1 independently of response order', () => {
  const mapped = mapDurabilityCurves(fixture);
  expect(mapped.fresh?.level).toBe('fresh');
  expect(mapped.fatigued.map((curve) => [curve.level, curve.afterKj])).toEqual([
    ['kj0', 700],
    ['kj1', 1400],
  ]);
  expect(mapped.fatigued[0].points[0]).toMatchObject({
    seconds: 10,
    watts: 870,
    activityId: 'i2',
    startIndex: 1,
    endIndex: 11,
  });
  expect(mapped.fatigued.find((curve) => curve.level === 'kj1')?.points[0].supportingActivityIds).toEqual(['i3', 'i5', 'i6']);
});

it('keeps a valid fresh curve when a fatigued curve is malformed', () => {
  const mapped = mapDurabilityCurves({ list: [fixture.list[1], { id: '90d-kj0', secs: [10], values: [] }] });
  expect(mapped.fresh?.points).toHaveLength(4);
  expect(mapped.fatigued).toHaveLength(0);
  expect(mapped.rejected).toEqual(['kj0']);
});
```

- [ ] **Step 3: Ejecutar las pruebas y comprobar el fallo inicial**

Run: `npx vitest run src/server/intervals/mappers.test.ts src/server/intervals/client.test.ts`

Expected: FAIL porque `mapDurabilityCurves` y `getDurabilityCurves` todavía no existen.

- [ ] **Step 4: Ampliar el esquema sin debilitar la validación de pares duración-potencia**

```ts
export const powerCurveSchema = z.object({
  id: z.string().min(1),
  after_kj: z.number().int().nonnegative().nullable().optional(),
  weight: nullableNumber,
  secs: z.array(z.number().int()),
  values: z.array(z.number().finite()).optional(),
  watts: z.array(z.number().finite()).optional(),
  activity_id: z.array(z.string()).optional(),
  submax_values: z.array(z.array(z.number().finite())).optional(),
  submax_activity_id: z.array(z.array(z.string())).optional(),
  start_index: z.array(z.number().int()).optional(),
  end_index: z.array(z.number().int()).optional(),
  powerModels: z.array(powerModelSchema).default([]),
}).loose().refine((curve) => (curve.values ?? curve.watts)?.length === curve.secs.length, {
  message: 'La curva no contiene pares completos de duración y potencia.',
});
```

- [ ] **Step 5: Implementar el normalizador por curva con errores aislados**

```ts
export type DurabilityCurveLevel = 'fresh' | 'kj0' | 'kj1';

export interface NormalizedDurabilityCurve {
  level: DurabilityCurveLevel;
  afterKj: number | null;
  weightKg: number | null;
  points: Array<{
    seconds: number;
    watts: number;
    activityId: string | null;
    supportingActivityIds: string[];
    startIndex: number | null;
    endIndex: number | null;
  }>;
}

export interface NormalizedDurabilityCurves {
  fresh: NormalizedDurabilityCurve | null;
  fatigued: NormalizedDurabilityCurve[];
  rejected: DurabilityCurveLevel[];
}
```

`mapDurabilityCurves` debe clasificar `-kj0` y `-kj1` por sufijo, considerar fresca la
curva sin esos sufijos, ordenar las fatigadas `kj0`, `kj1`, descartar puntos no positivos
y mantener alineados `activity_id`, `start_index` y `end_index` por índice.

- [ ] **Step 6: Añadir una llamada única con las tres curvas**

```ts
getDurabilityCurves(athleteId: string, period: string, newest: string, indoor?: boolean) {
  const query: Record<string, string> = {
    curves: [period, `${period}-kj0`, `${period}-kj1`].join(','),
    newest,
    type: 'Ride',
    subMaxEfforts: '3',
  };
  if (indoor !== undefined) query.filters = JSON.stringify([{ field_id: 'indoor', operator: 'eq', value: indoor }]);
  return this.transport.get(`/athlete/${athleteId}/power-curves`, query);
}
```

- [ ] **Step 7: Ejecutar las pruebas focalizadas**

Run: `npx vitest run src/server/intervals/mappers.test.ts src/server/intervals/client.test.ts`

Expected: PASS.

- [ ] **Step 8: Confirmar el contrato**

```bash
git add src/server/intervals
git commit -m "feat: normalize Intervals durability curves"
```

---

### Task 2: Motor fisiológico versionado de Durabilidad

**Files:**
- Create: `src/physiology/durability/types.ts`
- Modify: `src/physiology/durability/calculate.ts`
- Modify: `src/physiology/durability/calculate.test.ts`

**Interfaces:**
- Consumes: `DurabilityInput` con una curva fresca y cero, una o dos curvas fatigadas ya normalizadas.
- Produces: `calculateDurability(input: DurabilityInput): DurabilityResult` y `DURABILITY_ALGORITHM_VERSION = 'durability-record-profile@2.0.0'`.

- [ ] **Step 1: Definir los tipos cerrados del cálculo**

```ts
export type CoverageQuality = 'high' | 'moderate' | 'low' | 'insufficient';
export type CellQuality = 'observed' | 'insufficient' | 'incompatible';
export type DurabilityLevel = 'kj0' | 'kj1';

export interface DurabilityPoint {
  seconds: number;
  watts: number;
  activityId: string | null;
  supportingActivityCount: number;
  supportingEffortCount: number;
  powerSource: 'measured' | 'unknown';
}

export interface DurabilityInput {
  sport: 'Ride';
  environment: 'all' | 'outdoor' | 'indoor';
  oldest: string;
  newest: string;
  fresh: { weightKg: number | null; points: readonly DurabilityPoint[] };
  fatigued: readonly {
    level: DurabilityLevel;
    afterKj: number;
    weightKg: number | null;
    points: readonly DurabilityPoint[];
  }[];
}

export interface DurabilityLevelResult {
  afterKj: number;
  afterKjPerKg: number | null;
  fatiguedWatts: number | null;
  declinePercent: number | null;
  quality: CellQuality;
  supportingActivityCount: number;
  supportingEffortCount: number;
  powerSource: 'measured' | 'unknown';
}

export interface DurabilityRow {
  seconds: 10 | 60 | 300 | 1200;
  freshWatts: number | null;
  levels: Partial<Record<DurabilityLevel, DurabilityLevelResult>>;
  onsetAfterKj: number | null;
  onsetAfterKjPerKg: number | null;
}

export interface DurabilityResult {
  algorithmVersion: 'durability-record-profile@2.0.0';
  rows: DurabilityRow[];
  coverage: CoverageQuality;
  warnings: string[];
}
```

- [ ] **Step 2: Sustituir las pruebas del cálculo antiguo por casos numéricos versionados**

```ts
type PointTuple = readonly [number, number];

function points(values: readonly PointTuple[], weightSource: 'measured' | 'unknown' = 'measured'): DurabilityPoint[] {
  return values.map(([seconds, watts], index) => ({
    seconds,
    watts,
    activityId: `i${index + 1}`,
    supportingActivityCount: 2,
    supportingEffortCount: 3,
    powerSource: weightSource,
  }));
}

function inputWith(config: {
  fresh: readonly PointTuple[];
  kj0?: { afterKj: number; points: readonly PointTuple[] };
  kj1?: { afterKj: number; points: readonly PointTuple[] };
  weightKg?: number | null;
}): DurabilityInput {
  const weightKg = config.weightKg === undefined ? 70 : config.weightKg;
  const fatigued: Array<DurabilityInput['fatigued'][number]> = [];
  if (config.kj0) fatigued.push({ level: 'kj0', weightKg, afterKj: config.kj0.afterKj, points: points(config.kj0.points) });
  if (config.kj1) fatigued.push({ level: 'kj1', weightKg, afterKj: config.kj1.afterKj, points: points(config.kj1.points) });
  return {
    sport: 'Ride',
    environment: 'all',
    oldest: '2026-06-16',
    newest: '2026-09-14',
    fresh: { weightKg, points: points(config.fresh) },
    fatigued,
  };
}

function twoLevelInput() {
  return inputWith({
    fresh: [[10, 900], [60, 400], [300, 300], [1200, 240]],
    kj0: { afterKj: 700, points: [[10, 880], [60, 390], [300, 291], [1200, 232]] },
    kj1: { afterKj: 1400, points: [[10, 850], [60, 375], [300, 270], [1200, 215]] },
  });
}

it('keeps signed decline at exact canonical durations', () => {
  const result = calculateDurability(inputWith({
    fresh: [[10, 900], [60, 400], [300, 300], [1200, 240]],
    kj0: { afterKj: 700, points: [[10, 810], [60, 420], [300, 285], [1200, 216]] },
  }));
  expect(result.rows.find((row) => row.seconds === 10)?.levels.kj0?.declinePercent).toBeCloseTo(10);
  expect(result.rows.find((row) => row.seconds === 60)?.levels.kj0?.declinePercent).toBeCloseTo(-5);
});

it('does not interpolate a missing canonical duration', () => {
  const result = calculateDurability(inputWith({ fresh: [[10, 900], [60, 400]], kj0: { afterKj: 700, points: [[10, 810], [59, 401], [61, 399]] } }));
  expect(result.rows.find((row) => row.seconds === 60)?.levels.kj0?.quality).toBe('insufficient');
});

it('reports onset by accumulated work for each duration', () => {
  const result = calculateDurability(twoLevelInput());
  expect(result.rows.find((row) => row.seconds === 300)?.onsetAfterKj).toBe(1400);
});
```

- [ ] **Step 3: Ejecutar las pruebas para demostrar que el contrato antiguo no sirve**

Run: `npx vitest run src/physiology/durability/calculate.test.ts`

Expected: FAIL por ausencia de `rows`, niveles `kj0/kj1` y comienzo en kJ.

- [ ] **Step 4: Implementar la comparación exacta y firmada**

```ts
export const DURABILITY_ALGORITHM_VERSION = 'durability-record-profile@2.0.0';
export const CANONICAL_DURATIONS = [10, 60, 300, 1200] as const;

function declinePercent(freshWatts: number, fatiguedWatts: number) {
  return ((freshWatts - fatiguedWatts) / freshWatts) * 100;
}
```

El algoritmo debe buscar coincidencia exacta de segundos, calcular `afterKjPerKg` solo con
peso finito y positivo, conservar descensos negativos y usar el primer `afterKj` cuya
caída sea al menos 5 % como `onsetAfterKj`.

- [ ] **Step 5: Implementar calidad de cobertura sin llamarla confianza**

La calidad será `high` con tres duraciones válidas en ambos niveles, peso válido,
procedencia medida y dos actividades independientes por celda válida; `moderate` con dos
duraciones en ambos niveles o tres en uno; `low` con una o dos duraciones en un nivel,
peso ausente, una sola actividad o procedencia desconocida; e `insufficient` sin
comparaciones válidas.

- [ ] **Step 6: Añadir pruebas de incompatibilidad, peso ausente, caída negativa y valores no finitos**

```ts
const withoutWeight = inputWith({
  fresh: [[10, 900]],
  kj0: { afterKj: 700, points: [[10, 810]] },
  weightKg: null,
});
expect(calculateDurability(withoutWeight).coverage).toBe('low');
expect(calculateDurability(withoutWeight).warnings).toContain('No hay un peso válido para expresar el trabajo en kJ/kg.');

const nonFinite = inputWith({ fresh: [[10, Number.NaN]], kj0: { afterKj: 700, points: [[10, 810]] } });
expect(() => calculateDurability(nonFinite)).toThrow(/finito/i);
```

- [ ] **Step 7: Ejecutar la suite fisiológica**

Run: `npx vitest run src/physiology/durability/calculate.test.ts src/physiology/power-duration/fit.test.ts`

Expected: PASS.

- [ ] **Step 8: Confirmar el motor**

```bash
git add src/physiology/durability
git commit -m "feat: calculate signed cycling durability"
```

---

### Task 3: Persistencia, atomicidad y RLS de Durabilidad

**Files:**
- Modify: `supabase/schemas/01_core.sql`
- Modify: `supabase/schemas/02_rls.sql`
- Create: `supabase/migrations/20260914090000_add_durability_analysis.sql`
- Create: `supabase/tests/durability_security.test.sql`

**Interfaces:**
- Consumes: `sync_payload.durability_snapshot` dentro de `public.persist_athlete_sync(uuid,text,uuid,jsonb)`.
- Produces: `public.durability_curve_snapshots`, `public.durability_analysis_runs` y escritura atómica de instantánea durante la sincronización.

- [ ] **Step 1: Escribir pgTAP para demostrar los límites de seguridad antes de crear las tablas**

```sql
select plan(12);
select has_table('public', 'durability_curve_snapshots');
select has_table('public', 'durability_analysis_runs');
select table_privs_are('public', 'durability_curve_snapshots', 'authenticated', array['SELECT']);
select table_privs_are('public', 'durability_analysis_runs', 'authenticated', array['SELECT']);
select function_privs_are('public', 'persist_athlete_sync', array['uuid','text','uuid','jsonb'], 'authenticated', array[]::text[]);
```

Completar el archivo con pruebas de RLS entre dos ciclistas, inserción directa rechazada,
FK compuesta atleta-instantánea, idempotencia por huella y actualización/borrado rechazado
de un análisis confirmado.

- [ ] **Step 2: Ejecutar pgTAP y comprobar el fallo inicial**

Run: `npx supabase test db supabase/tests/durability_security.test.sql`

Expected: FAIL porque las tablas de Durabilidad no existen.

- [ ] **Step 3: Añadir tablas declarativas con restricciones JSON y contexto**

```sql
create table public.durability_curve_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  created_by uuid not null references public.coach_profiles(id),
  sport text not null check (sport = 'Ride'),
  environment text not null check (environment in ('all', 'outdoor', 'indoor')),
  oldest date not null,
  newest date not null,
  fresh_curve jsonb not null check (jsonb_typeof(fresh_curve) = 'object'),
  fatigued_curves jsonb not null check (jsonb_typeof(fatigued_curves) = 'array'),
  weight_kg numeric check (weight_kg is null or weight_kg > 0),
  weight_observed_at timestamptz,
  source_version text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  synchronized_at timestamptz not null,
  check (oldest <= newest),
  unique (athlete_id, sport, environment, oldest, newest, content_hash),
  unique (id, athlete_id)
);
```

Crear `durability_analysis_runs` con `comparisons` y `quality` JSON, FK compuesta
`(snapshot_id, athlete_id)`, unicidad `(snapshot_id, algorithm_version, created_by)` y un
trigger que rechace `UPDATE` y `DELETE`.

- [ ] **Step 4: Extender `persist_athlete_sync` dentro de la misma transacción**

```sql
if jsonb_typeof(sync_payload->'durability_snapshot') = 'object' then
  insert into public.durability_curve_snapshots (
    athlete_id, created_by, sport, environment, oldest, newest, fresh_curve,
    fatigued_curves, weight_kg, weight_observed_at, source_version, content_hash,
    synchronized_at
  ) values (
    target_athlete_id,
    target_coach_id,
    sync_payload->'durability_snapshot'->>'sport',
    sync_payload->'durability_snapshot'->>'environment',
    (sync_payload->'durability_snapshot'->>'oldest')::date,
    (sync_payload->'durability_snapshot'->>'newest')::date,
    sync_payload->'durability_snapshot'->'fresh_curve',
    sync_payload->'durability_snapshot'->'fatigued_curves',
    (sync_payload->'durability_snapshot'->>'weight_kg')::numeric,
    (sync_payload->'durability_snapshot'->>'weight_observed_at')::timestamptz,
    sync_payload->'durability_snapshot'->>'source_version',
    sync_payload->'durability_snapshot'->>'content_hash',
    (sync_payload->>'synchronized_at')::timestamptz
  )
  on conflict (athlete_id, sport, environment, oldest, newest, content_hash) do nothing;
end if;
```

Mantener el bloqueo de fila del ciclista y la comprobación `latest_sync_key = sync_key`
antes de insertar actividades, Potencia, Durabilidad y `athlete_sync_states`.

- [ ] **Step 5: Aplicar mínimos privilegios y RLS de solo lectura para usuarios**

```sql
revoke all on table public.durability_curve_snapshots from public, anon, authenticated, service_role;
revoke all on table public.durability_analysis_runs from public, anon, authenticated, service_role;
grant select on table public.durability_curve_snapshots, public.durability_analysis_runs to authenticated;
grant select, insert on table public.durability_curve_snapshots, public.durability_analysis_runs to service_role;
```

Crear únicamente políticas `SELECT` basadas en `coach_can_access_athlete`; no crear una
política de inserción para `authenticated`.

- [ ] **Step 6: Escribir una migración aditiva equivalente al esquema declarativo**

La migración debe crear tablas, índices, restricciones, trigger, privilegios, políticas y
reemplazar `persist_athlete_sync` sin reiniciar ni borrar la base local existente.

- [ ] **Step 7: Aplicar y verificar la base local**

Run: `npx supabase migration up --local`

Run: `npx supabase test db supabase/tests/durability_security.test.sql`

Run: `npx supabase db lint --local --level warning`

Expected: migración aplicada; pgTAP PASS; lint sin errores.

- [ ] **Step 8: Verificar que esquema y migraciones coinciden**

Run: `npx supabase db diff --local --strict-coverage`

Expected: `No schema changes found`.

- [ ] **Step 9: Confirmar la persistencia**

```bash
git add supabase
git commit -m "feat: persist immutable durability analyses"
```

---

### Task 4: Ampliación atómica de la sincronización global

**Files:**
- Modify: `netlify/functions/sync-athlete.ts`
- Modify: `tests/functions/sync-athlete.test.ts`
- Modify: `src/server/intervals/schemas.ts`
- Modify: `src/server/intervals/mappers.ts`
- Modify: `src/server/intervals/mappers.test.ts`

**Interfaces:**
- Consumes: `IntervalsClient.getDurabilityCurves`, `mapDurabilityCurves` y la RPC ampliada en Task 3.
- Produces: `createDurabilitySnapshotPayload(raw, activities, request, synchronizedAt)` y `sync_payload.durability_snapshot`.

```ts
interface DurabilitySnapshotPayload {
  sport: 'Ride';
  environment: 'all' | 'outdoor' | 'indoor';
  oldest: string;
  newest: string;
  fresh_curve: Record<string, unknown>;
  fatigued_curves: Array<Record<string, unknown>>;
  weight_kg: number | null;
  weight_observed_at: string | null;
  source_version: 'intervals-openapi-v1';
  content_hash: string;
}
```

- [ ] **Step 1: Añadir pruebas del contrato de sincronización común**

```ts
it('loads fresh, kj0 and kj1 in the same global synchronization', async () => {
  const loaded = await loadIntervalsAthleteData(client, 'i123', request);
  expect(transport.get).toHaveBeenCalledWith('/athlete/i123/power-curves', expect.objectContaining({
    curves: '90d,90d-kj0,90d-kj1',
  }));
  expect(loaded.durabilityCurves).not.toBeNull();
});

it('persists a partial durability snapshot without discarding a valid fresh curve', async () => {
  const normalized = normalizeAthleteData(partialCurves, request, now);
  expect(normalized.durabilitySnapshot?.fresh_curve).toBeDefined();
  expect(normalized.durabilitySnapshot?.fatigued_curves).toHaveLength(1);
  expect(normalized.warnings).toContain('durability_curves:1_rejected');
});
```

- [ ] **Step 2: Ejecutar las pruebas y comprobar el fallo inicial**

Run: `npx vitest run tests/functions/sync-athlete.test.ts src/server/intervals/mappers.test.ts`

Expected: FAIL porque la sincronización solo genera `snapshot` de Potencia.

- [ ] **Step 3: Usar la respuesta múltiple como fuente de Potencia y Durabilidad**

`loadIntervalsAthleteData` debe pedir una única respuesta de curvas múltiples. El mapper de
Potencia elegirá explícitamente la curva fresca; Durabilidad conservará fresca, `kJ0` y
`kJ1`. Una `kJ0` ausente o inválida no puede eliminar la curva fresca ni `kJ1`.

- [ ] **Step 4: Conservar procedencia del potenciómetro en actividades normalizadas**

Ampliar `activitySchema` con `device_watts`, devolver `deviceWatts` en `mapActivity` y
guardarlo como `normalized_data.deviceWatts`. Al crear la instantánea de Durabilidad,
resolver `point.powerSource = 'measured'` solo cuando todos los identificadores del récord
y sus esfuerzos secundarios correspondan a actividades aceptadas con
`deviceWatts === true`; usar `unknown` en los demás casos. Calcular
`supportingEffortCount` con el récord más los secundarios válidos y
`supportingActivityCount` con identificadores de actividad distintos. Persistir la
procedencia completa, pero devolver al navegador únicamente ambos recuentos.

- [ ] **Step 5: Crear una huella canónica reproducible**

```ts
const canonical = JSON.stringify({
  freshCurve,
  fatiguedCurves: [...fatiguedCurves].sort((a, b) => a.afterKj - b.afterKj),
  weightKg,
});
const contentHash = createHash('sha256').update(canonical).digest('hex');
```

Excluir nombres y objetos remotos completos. Ordenar puntos por segundos y curvas por
`after_kj` antes de calcular la huella.

- [ ] **Step 6: Incluir Durabilidad en recuentos y resumen global**

Añadir `durability_curves` a `SyncComponent`, `updated`, `warnings` y `counts`. Una
respuesta sin umbrales fatigados debe producir estado parcial y un mensaje legible, pero
persistir la curva fresca para que `/durabilidad` explique qué falta.

- [ ] **Step 7: Pasar la instantánea a la RPC existente**

```ts
sync_payload: {
  sport: 'Ride',
  environment: request.environment,
  oldest: request.oldest,
  newest: request.newest,
  synchronized_at: data.synchronizedAt,
  status: data.warnings.length ? 'partial' : 'complete',
  warnings: data.warnings,
  updated: data.updated,
  counts: data.counts,
  profile_name: data.profileName,
  activities: data.activities,
  planned_workouts: data.plannedWorkouts,
  observations: data.observations,
  derived_results: data.derivedResults,
  snapshot: data.snapshot,
  durability_snapshot: data.durabilitySnapshot,
}
```

No añadir una segunda operación de persistencia después de la RPC.

- [ ] **Step 8: Ejecutar pruebas de carrera, parcialidad e idempotencia**

Run: `npx vitest run tests/functions/sync-athlete.test.ts src/server/intervals/mappers.test.ts`

Run: `npx supabase test db supabase/tests/power_sync_security.test.sql supabase/tests/durability_security.test.sql`

Expected: PASS, incluida la regla de que una sincronización anterior no sobrescribe una
posterior.

- [ ] **Step 9: Confirmar la sincronización**

```bash
git add netlify/functions/sync-athlete.ts tests/functions/sync-athlete.test.ts src/server/intervals
git commit -m "feat: synchronize durability with athlete context"
```

---

### Task 5: API autenticada y confirmación recalculada en servidor

**Files:**
- Create: `netlify/functions/durability-analysis.ts`
- Create: `tests/functions/durability-analysis.test.ts`

**Interfaces:**
- Consumes: tablas de Task 3 y `calculateDurability` de Task 2.
- Produces: `GET /.netlify/functions/durability-analysis?athleteId=&oldest=&newest=&environment=` y `POST` con `{ snapshotId }`.

```ts
interface DurabilitySnapshotResponse {
  id: string;
  athleteId: string;
  oldest: string;
  newest: string;
  environment: 'all' | 'outdoor' | 'indoor';
  weightKg: number | null;
  weightObservedAt: string | null;
  synchronizedAt: string;
  sourceVersion: string;
  result: DurabilityResult;
}

interface ConfirmedDurabilityAnalysis {
  id: string;
  snapshotId: string;
  algorithmVersion: string;
  comparisons: DurabilityRow[];
  quality: { coverage: CoverageQuality; warnings: string[] };
  confirmedAt: string;
}
```

Las respuestas públicas no incluirán `activityId`, `startIndex`, `endIndex` ni
identificadores secundarios; solo recuentos de esfuerzos y actividades.

La función exportará
`createDurabilityAnalysisHandler(dependencies: Partial<DurabilityAnalysisDependencies>)`
para pruebas deterministas y `handler = createDurabilityAnalysisHandler()` para Netlify,
siguiendo la misma forma de `power-analysis.ts`.

```ts
type DurabilityAnalysisEvent = {
  httpMethod: string;
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string> | null;
  body?: string | null;
};

interface DurabilityQuery {
  athleteId: string;
  oldest: string;
  newest: string;
  environment: 'all' | 'outdoor' | 'indoor';
}

interface PersistedDurabilityAnalysis {
  athleteId: string;
  snapshotId: string;
  createdBy: string;
  algorithmVersion: 'durability-record-profile@2.0.0';
  comparisons: DurabilityRow[];
  quality: { coverage: CoverageQuality; warnings: string[] };
}

interface DurabilityAnalysisDependencies {
  authenticate(event: DurabilityAnalysisEvent): Promise<{ id: string } | null>;
  authorize(coachId: string, athleteId: string): Promise<'coach' | 'viewer' | null>;
  loadLatestSnapshot(query: DurabilityQuery): Promise<unknown | null>;
  loadSnapshot(snapshotId: string): Promise<unknown | null>;
  persistAnalysis(input: PersistedDurabilityAnalysis): Promise<{ row: unknown; created: boolean }>;
  now(): Date;
}
```

- [ ] **Step 1: Escribir pruebas HTTP antes de implementar la función**

```ts
const query = { athleteId, oldest: '2026-06-16', newest: '2026-09-14', environment: 'all' };
const getEvent = (values: typeof query) => ({
  httpMethod: 'GET',
  headers: { authorization: 'Bearer token' },
  queryStringParameters: values,
});
const postEvent = (body: unknown) => ({
  httpMethod: 'POST',
  headers: { authorization: 'Bearer token' },
  body: JSON.stringify(body),
});
const api = createDurabilityAnalysisHandler({
  authenticate: async () => ({ id: coachId }),
  authorize: async () => 'coach',
  loadLatestSnapshot: async () => snapshot,
  loadSnapshot: async () => snapshot,
  persistAnalysis: async () => ({ row: confirmedRow, created: true }),
  now: () => new Date('2026-09-14T10:00:00Z'),
});

it('returns 401 before parsing an invalid POST body', async () => {
  const unauthorized = createDurabilityAnalysisHandler({ authenticate: async () => null });
  const response = await unauthorized({ httpMethod: 'POST', headers: {}, body: '{' });
  expect(response.statusCode).toBe(401);
});

it('returns the latest exactly matching snapshot for an authorized viewer', async () => {
  const response = await api(getEvent(query));
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body)).toMatchObject({ athleteId: query.athleteId, environment: 'all' });
});

it('recalculates confirmation and ignores client supplied result fields', async () => {
  const response = await api(postEvent({ snapshotId, comparisons: [{ watts: 99999 }] }));
  expect(response.statusCode).toBe(400);
});
```

Completar con 400 para periodo inválido, 403 para cruce de ciclista, 404 sin instantánea,
409 para instantánea obsoleta, 403 al confirmar con rol `viewer` e idempotencia de POST.

- [ ] **Step 2: Ejecutar las pruebas y comprobar el fallo inicial**

Run: `npx vitest run tests/functions/durability-analysis.test.ts`

Expected: FAIL porque la función no existe.

- [ ] **Step 3: Implementar validación cerrada de consulta y cuerpo**

```ts
const querySchema = z.strictObject({
  athleteId: z.uuid(),
  oldest: z.iso.date(),
  newest: z.iso.date(),
  environment: z.enum(['all', 'outdoor', 'indoor']),
});

const confirmationSchema = z.strictObject({ snapshotId: z.uuid() });
```

Reutilizar la regla de 1 a 730 días y prohibir fechas futuras. Autenticar antes de parsear
el cuerpo en POST.

- [ ] **Step 4: Implementar GET con coincidencia exacta y cálculo compartido**

Seleccionar la última instantánea por `athlete_id`, `sport = Ride`, entorno, `oldest` y
`newest`. Validar la fila con Zod, transformarla a `DurabilityInput`, ejecutar
`calculateDurability` y devolver instantánea, resultado, versión y fecha.

- [ ] **Step 5: Implementar POST de fuente única**

Leer la instantánea por `snapshotId`, autorizar su `athlete_id`, exigir rol `coach`,
recalcular y rechazar cobertura `insufficient`. Insertar con
`on_conflict=snapshot_id,algorithm_version,created_by` y devolver la fila existente cuando
la operación sea repetida.

- [ ] **Step 6: Ejecutar las pruebas de función y seguridad**

Run: `npx vitest run tests/functions/durability-analysis.test.ts`

Run: `npx supabase test db supabase/tests/durability_security.test.sql`

Expected: PASS.

- [ ] **Step 7: Confirmar la API**

```bash
git add netlify/functions/durability-analysis.ts tests/functions/durability-analysis.test.ts
git commit -m "feat: add authorized durability analysis API"
```

---

### Task 6: Cliente, pantalla y navegación reales

**Files:**
- Create: `src/features/durability/durabilityApi.ts`
- Create: `src/features/durability/durabilityApi.test.ts`
- Create: `src/features/durability/DurabilityWorkspace.tsx`
- Create: `src/features/durability/DurabilityWorkspace.test.tsx`
- Create: `src/features/durability/DurabilityChart.tsx`
- Create: `src/features/durability/DurabilityChart.test.tsx`
- Modify: `src/features/durability/DurabilityView.tsx`
- Modify: `src/features/durability/DurabilityView.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/DemoViews.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: JSON de Task 5 y `AnalysisContextValue` existente.
- Produces: `DurabilityApi`, `DurabilityWorkspace` y una ruta `/durabilidad` poblada automáticamente.

- [ ] **Step 1: Escribir el esquema Zod y pruebas del cliente HTTP**

```ts
it('requests the exact active context with bearer auth', async () => {
  await api.load({ athleteId, oldest: '2026-06-16', newest: '2026-09-14', environment: 'all' }, signal);
  expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('athleteId='), expect.objectContaining({
    method: 'GET',
    headers: { Authorization: 'Bearer token' },
    signal,
  }));
});

it('confirms with snapshotId only', async () => {
  await api.confirm({ snapshotId });
  const init = vi.mocked(fetchImpl).mock.calls[0][1];
  expect(JSON.parse(String(init?.body))).toEqual({ snapshotId });
});
```

- [ ] **Step 2: Ejecutar pruebas del cliente y comprobar el fallo inicial**

Run: `npx vitest run src/features/durability/durabilityApi.test.ts`

Expected: FAIL porque `durabilityApi.ts` no existe.

- [ ] **Step 3: Implementar el cliente con mensajes seguros por estado HTTP**

Mapear 401, 403, 404 y 409 a mensajes en español; ante JSON inválido usar
`La respuesta de Durabilidad no es válida.` sin mostrar el cuerpo remoto.

- [ ] **Step 4: Escribir pruebas del workspace para estados y carreras**

```ts
vi.mock('../../analysis/AnalysisContext', () => ({ useAnalysis: vi.fn() }));
const mockedUseAnalysis = vi.mocked(useAnalysis);
const api: DurabilityApi = { load: vi.fn(), confirm: vi.fn() };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function snapshot(id: string, athleteId: string, label: string): DurabilitySnapshotResponse {
  return {
    id,
    athleteId,
    oldest: '2026-06-16',
    newest: '2026-09-14',
    environment: 'all',
    weightKg: 70,
    weightObservedAt: null,
    synchronizedAt: '2026-09-14T10:00:00Z',
    sourceVersion: 'intervals-openapi-v1',
    result: {
      algorithmVersion: 'durability-record-profile@2.0.0',
      coverage: 'moderate',
      warnings: [label],
      rows: [{
        seconds: 10,
        freshWatts: 900,
        levels: { kj0: { afterKj: 700, afterKjPerKg: 10, fatiguedWatts: 810, declinePercent: 10, quality: 'observed', supportingActivityCount: 2, supportingEffortCount: 3, powerSource: 'measured' } },
        onsetAfterKj: 700,
        onsetAfterKjPerKg: 10,
      }],
    },
  };
}

const athleteA = '11111111-1111-4111-8111-111111111111';
const athleteB = '22222222-2222-4222-8222-222222222222';
const snapshotA = snapshot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', athleteA, 'Datos de A');
const snapshotB = snapshot('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', athleteB, 'Datos de B');
const context = (activeAthleteId: string): AnalysisContextValue => ({
  athletes: [],
  athleteId: activeAthleteId,
  athlete: null,
  period: { preset: 90 },
  environment: 'all',
  today: '2026-09-14',
  sync: { status: 'complete', synchronizedAt: '2026-09-14T10:00:00Z', message: '' },
  loadingRoster: false,
  loadingAthlete: false,
  error: '',
  selectAthlete: vi.fn(),
  setPeriod: vi.fn(),
  setEnvironment: vi.fn(),
  synchronize: vi.fn(async () => undefined),
  reloadRoster: vi.fn(async () => undefined),
  addObservation: vi.fn(async () => undefined),
  clearError: vi.fn(),
});

it('loads the active athlete automatically without synchronizing', async () => {
  const analysis = context(athleteId);
  mockedUseAnalysis.mockReturnValue(analysis);
  render(<DurabilityWorkspace api={api} />);
  await screen.findByRole('heading', { name: 'Durabilidad' });
  expect(api.load).toHaveBeenCalledTimes(1);
  expect(analysis.synchronize).not.toHaveBeenCalled();
});

it('ignores a late response from the previous athlete', async () => {
  const first = deferred<DurabilitySnapshotResponse>();
  vi.mocked(api.load).mockReturnValueOnce(first.promise).mockResolvedValueOnce(snapshotB);
  mockedUseAnalysis.mockReturnValue(context(athleteA));
  const view = render(<DurabilityWorkspace api={api} />);
  mockedUseAnalysis.mockReturnValue(context(athleteB));
  view.rerender(<DurabilityWorkspace api={api} />);
  first.resolve(snapshotA);
  expect(screen.queryByText('Datos de A')).not.toBeInTheDocument();
});

it('keeps the compatible snapshot visible when refresh fails', async () => {
  vi.mocked(api.load).mockResolvedValueOnce(snapshotA).mockRejectedValueOnce(new Error('Fallo temporal'));
  const analysis = context(athleteA);
  mockedUseAnalysis.mockReturnValue(analysis);
  const view = render(<DurabilityWorkspace api={api} />);
  await screen.findByText('10,0 %');
  mockedUseAnalysis.mockReturnValue({ ...analysis, sync: { ...analysis.sync, synchronizedAt: '2026-09-14T11:00:00Z' } });
  view.rerender(<DurabilityWorkspace api={api} />);
  expect(await screen.findByText('Se muestra la última instantánea guardada.')).toBeVisible();
  expect(screen.getByText('10,0 %')).toBeVisible();
});
```

Cubrir también: sin ciclista, periodo inválido, 404, umbrales ausentes, peso ausente,
parcial, confirmación guardada, error de confirmación y demo aislada.

- [ ] **Step 5: Implementar `DurabilityWorkspace` con la generación de petición de Potencia**

Usar `requestGeneration`, `confirmationGeneration`, `AbortController`, `scopeKey` y
`requestKey`. Incluir `sync.synchronizedAt` en `requestKey` para releer la base después de
una sincronización común. No llamar a `synchronize()` al montar.

- [ ] **Step 6: Actualizar vista y gráfico sin puntuación general**

La vista debe mostrar kJ, kJ/kg, 10 s, 1 min, 5 min y 20 min; fresca, `kJ0`, `kJ1`,
descenso firmado, calidad por celda, comienzo por carga, procedencia y limitaciones. El
gráfico tendrá tabla equivalente y texto alternativo; los descensos negativos deben
quedar por debajo de cero.

- [ ] **Step 7: Sustituir la demo de ruta por el workspace real**

```tsx
const routeContent: Record<string, ReactNode> = {
  '/potencia': <PowerWorkspace api={powerAnalysisApi} />,
  '/durabilidad': <DurabilityWorkspace api={durabilityAnalysisApi} />,
  // Las demás rutas permanecen en su fase actual.
};
```

`DurabilityDemo` seguirá siendo un hijo explícito del workspace y se adaptará al nuevo
contrato sin escribir en la base.

- [ ] **Step 8: Ejecutar pruebas de componentes y aplicación**

Run: `npx vitest run src/features/durability src/app/App.test.tsx src/analysis/AnalysisProvider.test.tsx`

Expected: PASS.

- [ ] **Step 9: Confirmar la pantalla real**

```bash
git add src/features/durability src/app src/styles/global.css
git commit -m "feat: replace durability demo with real analysis"
```

---

### Task 7: Integración, accesibilidad y aceptación con un ciclista real

**Files:**
- Create: `tests/e2e/durability.spec.ts`
- Modify: `tests/e2e/coach-workflow.spec.ts`
- Modify: `tests/e2e/accessibility.spec.ts`
- Modify: `tests/e2e/visual.spec.ts`
- Modify: `docs/acceptance-status.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: flujo completo de Tasks 1–6.
- Produces: evidencia automatizada y aceptación local con Jaume Santamaria.

- [ ] **Step 1: Añadir E2E de sincronización única y navegación**

```ts
test('one global sync feeds power and durability after navigation and reload', async ({ page }) => {
  let syncPosts = 0;
  await page.route('**/.netlify/functions/sync-athlete', async (route) => {
    if (route.request().method() === 'POST') syncPosts += 1;
    await route.continue();
  });
  await page.goto('/');
  await page.getByLabel('Ciclista activo').selectOption({ label: 'Jaume Santamaria' });
  await page.getByRole('button', { name: 'Sincronizar con Intervals.icu' }).click();
  await expect(page.getByText('Sincronización completada')).toBeVisible();
  await page.getByRole('link', { name: 'Durabilidad' }).click();
  await expect(page.getByRole('heading', { name: 'Durabilidad' })).toBeVisible();
  await page.reload();
  await expect(page.getByText(/kJ\/kg|peso no disponible/)).toBeVisible();
  expect(syncPosts).toBe(1);
});
```

En la suite automatizada, usar fixtures locales y UUID ficticios autorizados; la
aceptación manual posterior utilizará la sesión local real.

- [ ] **Step 2: Añadir E2E de datos parciales, teclado y 200 % real**

Comprobar foco visible, orden de tabulación, tabla desplazable sin pérdida de contenido,
anuncios `role=status/alert`, ancho móvil de 360 px y zoom del navegador al 200 % mediante
el mecanismo real disponible en Chromium, no solo un viewport equivalente.

- [ ] **Step 3: Ejecutar toda la verificación automatizada**

Run: `npm run verify`

Run: `npm run test:e2e`

Run: `npx supabase test db supabase/tests/power_sync_security.test.sql supabase/tests/durability_security.test.sql`

Run: `npx supabase db lint --local --level warning`

Run: `npx supabase db diff --local --strict-coverage`

Run: `npm audit --omit=dev`

Expected: todas las pruebas pasan; lint sin errores; sin deriva de esquema; cero
vulnerabilidades de producción.

- [ ] **Step 4: Ejecutar aceptación local real sin confirmar un análisis innecesario**

Run: `npm run dev:real`

Abrir `http://127.0.0.1:4174/`, mantener Jaume seleccionado, ejecutar una sola
sincronización global, navegar a `/durabilidad`, comprobar el periodo actual, las curvas
disponibles, kJ/kJ/kg, calidad y advertencias. Recargar y verificar que la selección, la
última sincronización y el resultado persisten. No pulsar **Confirmar análisis** salvo que
la prueba de POST no tenga ya cobertura automatizada suficiente.

- [ ] **Step 5: Registrar evidencia y limitaciones reales**

Actualizar `docs/acceptance-status.md` con fecha, ciclista mostrado, contexto, métricas
visibles, componentes parciales y ausencia de una segunda llamada de sincronización.
Documentar en `README.md` que `kJ0/kJ1` dependen de la configuración de Intervals.icu y que
una cobertura alta sigue siendo un perfil récord de campo.

- [ ] **Step 6: Revisar cambios y confirmar la aceptación**

Run: `git diff --check`

Run: `git status --short`

```bash
git add tests/e2e docs/acceptance-status.md README.md
git commit -m "test: accept real durability workflow"
```

- [ ] **Step 7: Solicitar revisión final independiente**

El revisor debe comparar el diff completo con la especificación, revisar seguridad y
fisiología, ejecutar las pruebas focalizadas que considere necesarias y devolver
`APPROVED` o hallazgos priorizados con archivo y línea. Resolver cualquier hallazgo
Critical o Important antes de declarar completa la fase.
