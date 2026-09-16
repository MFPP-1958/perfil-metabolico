# Escenarios metabólicos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el entrenador vea, sobre un ciclista real, cómo cambiaría su reparto de sustratos si su VLa máx fuera otra, con el coste del cambio a la vista y la hipótesis guardada aparte de las mediciones.

**Architecture:** El motor de Mader se parte en dos: la guarda de procedencia, que se ejecuta una sola vez sobre las observaciones reales, y la proyección numérica, que se ejecuta dos veces, con los valores reales y con los objetivo. La ruta de Tests deja de servir datos sintéticos y lee el ciclista activo del contexto común. El escenario se guarda en su propia tabla, nunca en `observations`.

**Tech Stack:** TypeScript, React 19, Vite, Chart.js 4.5.1 (sin complementos externos), Zod, Vitest, Testing Library, Playwright, Supabase local con esquemas declarativos, funciones de Netlify.

**Spec:** `docs/superpowers/specs/2026-09-16-metabolic-scenarios-design.md`

## Global Constraints

- Trabajar **exclusivamente** en `/Users/manuelfrancisperezperez/Desktop/MFPP Metabolic Lab`, rama `main`. Las copias de `~/Desktop/Perfil metabolico` no se tocan.
- **Nunca** ejecutar `supabase db reset`: la base local es compartida. Las migraciones se generan con `supabase db diff` desde `supabase/schemas/`, jamás se escriben a mano, y se prueban dentro de `begin; … rollback;` con `docker exec -i supabase_db_perfil-metabolico psql`.
- Ningún valor objetivo se escribe en `observations` ni en `derived_results`.
- La guarda de `runMaderModel` no se relaja: ni se añaden calidades nuevas a `InputQuality` ni se admite un `observationId` inventado.
- Sin dependencias nuevas de npm. Las anotaciones del gráfico se resuelven con un complemento propio de Chart.js.
- Todo el texto de interfaz, en español, con la unidad y la fecha junto a cada cifra.
- Cada modelo o regla nueva se registra en `docs/model-register.md` con entradas, salidas, estado y límites.
- Verificación del proyecto: `npm run typecheck && npm run lint && npm run test:run`. El listón es cero avisos de ESLint.

---

### Task 1: Separar la guarda de la proyección en el motor de sustratos

Refactor sin cambio de comportamiento. `buildSubstrateProfile` conserva firma y salida; la aritmética queda disponible por separado para que el escenario la use dos veces sin volver a pasar por la guarda.

**Files:**
- Modify: `src/physiology/substrates/metabolism.ts:66-101`
- Test: `src/physiology/substrates/metabolism.test.ts`

**Interfaces:**
- Consumes: `sweepMetabolicStates`, `oxidativeCapacity`, `pyruvateDeficit` de `src/physiology/mader/sweep.ts`; `SubstratePoint`, `SubstrateConfig` ya exportados.
- Produces:
  - `export interface SubstrateValues { vo2max: number; vlamax: number; bodyMass: number; pVo2max: number }`
  - `export interface SubstrateProjection { curve: SubstratePoint[]; fatmax: SubstratePoint; mlss: SubstratePoint }`
  - `export function projectSubstrateCurve(values: SubstrateValues, config: SubstrateConfig): SubstrateProjection`

- [ ] **Step 1: Escribir la prueba que exige la equivalencia**

Añadir al final de `src/physiology/substrates/metabolism.test.ts`:

```ts
import { buildSubstrateProfile, projectSubstrateCurve } from './metabolism';

describe('projectSubstrateCurve', () => {
  const values = { vo2max: 68, vlamax: 0.8, bodyMass: 70, pVo2max: 400 };
  const config = { restingVo2: 5 };

  it('reproduce exactamente la curva que publica buildSubstrateProfile', () => {
    const gated = buildSubstrateProfile({
      vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'o-vo2' },
      vlamax: { value: 0.8, unit: 'mmol·l⁻¹·s⁻¹', quality: 'measured', observationId: 'o-vla' },
      bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'o-masa' },
      pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'o-pvo2' },
    }, config);
    const projected = projectSubstrateCurve(values, config);

    if (gated.status !== 'calculated') throw new Error('El perfil de referencia debe calcularse.');
    expect(projected.curve).toEqual(gated.curve);
    expect(projected.fatmax).toEqual(gated.fatmax);
    expect(projected.mlss).toEqual(gated.mlss);
  });

  it('desplaza el MLSS a menos vatios cuando sube la VLa máx', () => {
    const baja = projectSubstrateCurve({ ...values, vlamax: 0.4 }, config);
    const alta = projectSubstrateCurve({ ...values, vlamax: 0.9 }, config);
    expect(alta.mlss.powerWatts).toBeLessThan(baja.mlss.powerWatts);
    expect(alta.fatmax.powerWatts).toBeLessThan(baja.fatmax.powerWatts);
    expect(alta.fatmax.fatOxidationGramsPerMin).toBeLessThan(baja.fatmax.fatOxidationGramsPerMin);
  });
});
```

- [ ] **Step 2: Ejecutar la prueba y comprobar que falla**

Run: `npx vitest run src/physiology/substrates/metabolism.test.ts`
Expected: FAIL — `projectSubstrateCurve is not a function` (no está exportada).

- [ ] **Step 3: Extraer la proyección**

En `src/physiology/substrates/metabolism.ts`, sustituir el cuerpo de `buildSubstrateProfile` por esta pareja de funciones. La aritmética se mueve tal cual; no se cambia ni una constante.

```ts
export interface SubstrateValues {
  vo2max: number;
  vlamax: number;
  bodyMass: number;
  pVo2max: number;
}

export interface SubstrateProjection {
  curve: SubstratePoint[];
  fatmax: SubstratePoint;
  mlss: SubstratePoint;
}

/**
 * Aritmética pura del reparto de sustratos. No comprueba procedencia: quien la use
 * con valores que no son mediciones debe declararlo por su cuenta.
 */
export function projectSubstrateCurve(values: SubstrateValues, config: SubstrateConfig): SubstrateProjection {
  const { vo2max, vlamax, bodyMass, pVo2max } = values;
  const oxygenCostPerWatt = ((vo2max - config.restingVo2) * bodyMass) / pVo2max;
  const toWatts = (relative: number) => (relative * bodyMass - config.restingVo2 * bodyMass) / oxygenCostPerWatt;

  const { states, fatmax, mlss } = sweepMetabolicStates(vo2max, vlamax);
  const sweep = states.filter((state) => toWatts(state.vo2Relative) > 0);

  const requested = Math.max(2, config.curvePoints ?? 60);
  const sampleCount = Math.min(requested, sweep.length);
  const curve: SubstratePoint[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const index = Math.round((i * (sweep.length - 1)) / (sampleCount - 1));
    curve.push(describe(sweep[index], vo2max, bodyMass, toWatts));
  }

  return {
    curve,
    fatmax: describe(fatmax, vo2max, bodyMass, toWatts),
    mlss: describe(mlss, vo2max, bodyMass, toWatts),
  };
}

export function buildSubstrateProfile(inputs: MaderInputs, config: SubstrateConfig): SubstrateProfileResult {
  // El motor de Mader es la única puerta de entrada: reutiliza sus guardas de procedencia.
  const gate = runMaderModel(inputs, config);
  if (gate.status === 'blocked') {
    return { status: 'blocked', reasons: gate.reasons, version: SUBSTRATE_MODEL_VERSION };
  }

  const projection = projectSubstrateCurve({
    vo2max: inputs.vo2max.value,
    vlamax: inputs.vlamax.value,
    bodyMass: inputs.bodyMass.value,
    pVo2max: inputs.pVo2max.value,
  }, config);

  return {
    status: 'calculated',
    version: SUBSTRATE_MODEL_VERSION,
    ...projection,
    inputLineage: gate.inputLineage,
    cadenceWarning: gate.cadenceWarning,
    provenanceNotices: gate.provenanceNotices,
    limitations: [...SUBSTRATE_LIMITATIONS],
    reportEligible: gate.reportEligible,
  };
}
```

- [ ] **Step 4: Ejecutar las pruebas del motor**

Run: `npx vitest run src/physiology/substrates src/physiology/mader src/features/experimental`
Expected: PASS, incluidas las pruebas previas de sustratos y de `MaderView`, que no deben cambiar.

- [ ] **Step 5: Confirmar**

```bash
git add src/physiology/substrates/metabolism.ts src/physiology/substrates/metabolism.test.ts
git commit -m "refactor: separate the substrate gate from its projection"
```

---

### Task 2: Motor del escenario

**Files:**
- Create: `src/physiology/scenarios/references.ts`
- Create: `src/physiology/scenarios/scenario.ts`
- Test: `src/physiology/scenarios/scenario.test.ts`

**Interfaces:**
- Consumes: `projectSubstrateCurve`, `SubstrateProjection`, `SubstratePoint`, `SubstrateConfig` (Task 1); `runMaderModel`, `MaderInputs` de `src/physiology/mader/model.ts`; `SUBSTRATE_LIMITATIONS` de `src/physiology/substrates/references.ts`.
- Produces:
  - `SCENARIO_MODEL_VERSION = 'metabolic-scenario@1.0.0'`
  - `export type EventProfile = 'explosiva' | 'rodador' | 'escalador' | 'fondo'`
  - `export interface ScenarioTargets { vlamax: number; vo2max?: number }`
  - `export interface ScenarioConfig extends SubstrateConfig { referencePowerWatts?: number }`
  - `export interface ScenarioChange { ... }` (definido en el paso 3)
  - `export type MetabolicScenarioResult = { status: 'blocked' … } | { status: 'calculated' … }`
  - `export function buildMetabolicScenario(inputs: MaderInputs, config: ScenarioConfig, targets: ScenarioTargets): MetabolicScenarioResult`
  - `export function sampleAtPower(curve: readonly SubstratePoint[], watts: number): SubstratePoint`

- [ ] **Step 1: Escribir las referencias del modelo**

Crear `src/physiology/scenarios/references.ts`:

```ts
export const SCENARIO_MODEL_VERSION = 'metabolic-scenario@1.0.0';

export const SCENARIO_HYPOTHESIS_NOTICE =
  'El perfil objetivo es una hipótesis de trabajo del entrenador. No es una medición, no predice el resultado del entrenamiento y no afirma que el objetivo sea alcanzable.';

export const SCENARIO_MINOR_NOTICE =
  'En un ciclista en maduración el perfil se desplaza por el propio crecimiento. Un objetivo de VLa máx describe una hipótesis fechada, nunca una asignación de especialidad.';

export const SCENARIO_LIMITATIONS = [
  'El modelo trata la VLa máx y el VO₂max como parámetros independientes. El entrenamiento que mueve uno rara vez deja el otro intacto, así que un escenario que solo mueve uno describe un cambio aislado que el organismo no suele conceder por separado.',
  'La comparación conserva la masa corporal y la P@VO₂max reales. Un cambio de peso alteraría la conversión a vatios y haría que las dos curvas dejaran de ser comparables.',
] as const;
```

- [ ] **Step 2: Escribir las pruebas del escenario**

Crear `src/physiology/scenarios/scenario.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MaderInputs } from '../mader/model';
import { buildMetabolicScenario, sampleAtPower } from './scenario';
import { SCENARIO_MODEL_VERSION } from './references';

const inputs: MaderInputs = {
  vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'o-vo2' },
  vlamax: { value: 0.4, unit: 'mmol·l⁻¹·s⁻¹', quality: 'calculated', observationId: 'o-vla', sourceReference: { software: 'WKO5' } },
  bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'o-masa' },
  pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'o-pvo2' },
  comparison: { ftpWatts: 295 },
};
const config = { restingVo2: 5, referencePowerWatts: 250 };

describe('buildMetabolicScenario', () => {
  it('publica las dos proyecciones y la versión del modelo', () => {
    const result = buildMetabolicScenario(inputs, config, { vlamax: 0.8 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.version).toBe(SCENARIO_MODEL_VERSION);
    expect(result.current.curve.length).toBeGreaterThan(1);
    expect(result.target.curve.length).toBeGreaterThan(1);
    expect(result.appliedTargets).toEqual({ vlamax: 0.8, vo2max: 68 });
  });

  it('cifra el precio de subir la VLa máx con signo negativo', () => {
    const result = buildMetabolicScenario(inputs, config, { vlamax: 0.8 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.change.mlssWattsDelta).toBeLessThan(0);
    expect(result.change.fatmaxWattsDelta).toBeLessThan(0);
    expect(result.change.fatmaxFatGramsPerMinDelta).toBeLessThan(0);
    expect(result.change.carbohydrateGramsPerHourDeltaAtReference).toBeGreaterThan(0);
  });

  it('conserva el VO₂max real cuando no se propone objetivo', () => {
    const result = buildMetabolicScenario(inputs, config, { vlamax: 0.8 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.appliedTargets.vo2max).toBe(68);
  });

  it('aplica el VO₂max objetivo cuando se propone', () => {
    const soloVlamax = buildMetabolicScenario(inputs, config, { vlamax: 0.8 });
    const conVo2max = buildMetabolicScenario(inputs, config, { vlamax: 0.8, vo2max: 72 });
    if (soloVlamax.status !== 'calculated' || conVo2max.status !== 'calculated') {
      throw new Error('Los dos escenarios deben calcularse.');
    }
    expect(conVo2max.appliedTargets.vo2max).toBe(72);
    // Más techo oxidativo con la misma glucólisis desplaza el MLSS a más vatios.
    expect(conVo2max.target.mlss.powerWatts).toBeGreaterThan(soloVlamax.target.mlss.powerWatts);
  });

  it('avisa cuando el objetivo no se distingue de la sensibilidad del modelo', () => {
    const result = buildMetabolicScenario(inputs, { ...config, sensitivityVlamaxDelta: 0.1 }, { vlamax: 0.45 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.withinSensitivity).toBe(true);
    expect(result.notices.join(' ')).toMatch(/sensibilidad/i);
  });

  it('declara que no hay comparación cuando el objetivo iguala al valor real', () => {
    const result = buildMetabolicScenario(inputs, config, { vlamax: 0.4 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.comparable).toBe(false);
  });

  it('hereda el bloqueo y las razones de la guarda de procedencia', () => {
    const result = buildMetabolicScenario(
      { ...inputs, vo2max: { ...inputs.vo2max, quality: 'imported_estimate' } },
      config,
      { vlamax: 0.8 },
    );
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.reasons.join(' ')).toMatch(/VO₂max/);
  });

  it('bloquea un objetivo que no es un número positivo y finito', () => {
    for (const vlamax of [0, -0.2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = buildMetabolicScenario(inputs, config, { vlamax });
      expect(result.status).toBe('blocked');
    }
  });

  it('arrastra el aviso de procedencia del programa de terceros', () => {
    const result = buildMetabolicScenario(inputs, config, { vlamax: 0.8 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.provenanceNotices.join(' ')).toMatch(/WKO5/);
  });

  it('usa el MLSS actual como referencia cuando no se fija una potencia', () => {
    const result = buildMetabolicScenario(inputs, { restingVo2: 5 }, { vlamax: 0.8 });
    if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
    expect(result.referencePowerWatts).toBeCloseTo(result.current.mlss.powerWatts, 6);
  });
});

describe('sampleAtPower', () => {
  it('devuelve el punto de la curva más próximo a la potencia pedida', () => {
    const curve = [
      { powerWatts: 100, percentVo2max: 40, pyruvateDeficit: 0, netLactateAccumulation: 0, fatOxidationGramsPerMin: 0.5, carbohydrateGramsPerHour: 30, energyKcalPerHour: 400 },
      { powerWatts: 200, percentVo2max: 60, pyruvateDeficit: 0, netLactateAccumulation: 0, fatOxidationGramsPerMin: 0.7, carbohydrateGramsPerHour: 90, energyKcalPerHour: 700 },
    ];
    expect(sampleAtPower(curve, 190).powerWatts).toBe(200);
    expect(sampleAtPower(curve, 120).powerWatts).toBe(100);
  });
});
```

- [ ] **Step 3: Ejecutar las pruebas y comprobar el fallo inicial**

Run: `npx vitest run src/physiology/scenarios`
Expected: FAIL — no existe `./scenario`.

- [ ] **Step 4: Implementar el motor**

Crear `src/physiology/scenarios/scenario.ts`:

```ts
import { runMaderModel, type MaderInputs } from '../mader/model';
import { SUBSTRATE_LIMITATIONS } from '../substrates/references';
import {
  projectSubstrateCurve,
  type SubstrateConfig,
  type SubstratePoint,
  type SubstrateProjection,
} from '../substrates/metabolism';
import { SCENARIO_HYPOTHESIS_NOTICE, SCENARIO_LIMITATIONS, SCENARIO_MODEL_VERSION } from './references';

export type EventProfile = 'explosiva' | 'rodador' | 'escalador' | 'fondo';

export interface ScenarioTargets {
  vlamax: number;
  vo2max?: number;
}

export interface ScenarioConfig extends SubstrateConfig {
  /** Potencia sobre la que se lee el efecto práctico. Por defecto, el MLSS actual. */
  referencePowerWatts?: number;
}

export interface ScenarioChange {
  fatmaxWattsDelta: number;
  fatmaxFatGramsPerMinDelta: number;
  mlssWattsDelta: number;
  fatGramsPerMinDeltaAtReference: number;
  carbohydrateGramsPerHourDeltaAtReference: number;
  percentVo2maxAtReference: { current: number; target: number };
}

export type MetabolicScenarioResult =
  | { status: 'blocked'; reasons: string[]; version: typeof SCENARIO_MODEL_VERSION }
  | {
      status: 'calculated';
      version: typeof SCENARIO_MODEL_VERSION;
      current: SubstrateProjection;
      target: SubstrateProjection;
      appliedTargets: { vlamax: number; vo2max: number };
      realValues: { vlamax: number; vo2max: number };
      change: ScenarioChange;
      referencePowerWatts: number;
      comparable: boolean;
      withinSensitivity: boolean;
      notices: string[];
      limitations: string[];
      inputLineage: string[];
      cadenceWarning: string;
      provenanceNotices: string[];
      reportEligible: boolean;
    };

export function sampleAtPower(curve: readonly SubstratePoint[], watts: number): SubstratePoint {
  let closest = curve[0];
  let distance = Math.abs(closest.powerWatts - watts);
  for (const point of curve) {
    const candidate = Math.abs(point.powerWatts - watts);
    if (candidate < distance) {
      closest = point;
      distance = candidate;
    }
  }
  return closest;
}

function positive(value: number | undefined): boolean {
  return value != null && Number.isFinite(value) && value > 0;
}

export function buildMetabolicScenario(
  inputs: MaderInputs,
  config: ScenarioConfig,
  targets: ScenarioTargets,
): MetabolicScenarioResult {
  // La guarda se ejecuta una sola vez y solo sobre las entradas reales.
  const gate = runMaderModel(inputs, config);
  if (gate.status === 'blocked') {
    return { status: 'blocked', reasons: gate.reasons, version: SCENARIO_MODEL_VERSION };
  }

  const reasons: string[] = [];
  if (!positive(targets.vlamax)) reasons.push('La VLa máx objetivo debe ser un número positivo.');
  if (targets.vo2max !== undefined && !positive(targets.vo2max)) reasons.push('El VO₂max objetivo debe ser un número positivo.');
  if (targets.vo2max !== undefined && targets.vo2max <= config.restingVo2) reasons.push('El VO₂max objetivo debe superar al VO₂ de reposo configurado.');
  if (reasons.length) return { status: 'blocked', reasons, version: SCENARIO_MODEL_VERSION };

  const realValues = { vlamax: inputs.vlamax.value, vo2max: inputs.vo2max.value };
  const appliedTargets = { vlamax: targets.vlamax, vo2max: targets.vo2max ?? realValues.vo2max };

  const current = projectSubstrateCurve({
    vo2max: realValues.vo2max,
    vlamax: realValues.vlamax,
    bodyMass: inputs.bodyMass.value,
    pVo2max: inputs.pVo2max.value,
  }, config);

  const target = projectSubstrateCurve({
    vo2max: appliedTargets.vo2max,
    vlamax: appliedTargets.vlamax,
    bodyMass: inputs.bodyMass.value,
    pVo2max: inputs.pVo2max.value,
  }, config);

  const referencePowerWatts = positive(config.referencePowerWatts)
    ? (config.referencePowerWatts as number)
    : current.mlss.powerWatts;
  const currentAtReference = sampleAtPower(current.curve, referencePowerWatts);
  const targetAtReference = sampleAtPower(target.curve, referencePowerWatts);

  const vlamaxDistance = Math.abs(appliedTargets.vlamax - realValues.vlamax);
  const comparable = vlamaxDistance > 0.005 || appliedTargets.vo2max !== realValues.vo2max;
  const withinSensitivity = comparable && vlamaxDistance <= gate.sensitivity.vlamaxDelta;

  const notices = [SCENARIO_HYPOTHESIS_NOTICE];
  if (!comparable) {
    notices.push('El objetivo coincide con el valor real del ciclista: no hay nada que comparar.');
  }
  if (withinSensitivity) {
    notices.push(`La diferencia propuesta, de ${vlamaxDistance.toFixed(2)} mmol·l⁻¹·s⁻¹, no supera la sensibilidad del propio modelo, de ${gate.sensitivity.vlamaxDelta.toFixed(2)}. La separación entre las dos curvas no se distingue de su incertidumbre.`);
  }

  return {
    status: 'calculated',
    version: SCENARIO_MODEL_VERSION,
    current,
    target,
    appliedTargets,
    realValues,
    referencePowerWatts,
    comparable,
    withinSensitivity,
    change: {
      fatmaxWattsDelta: target.fatmax.powerWatts - current.fatmax.powerWatts,
      fatmaxFatGramsPerMinDelta: target.fatmax.fatOxidationGramsPerMin - current.fatmax.fatOxidationGramsPerMin,
      mlssWattsDelta: target.mlss.powerWatts - current.mlss.powerWatts,
      fatGramsPerMinDeltaAtReference: targetAtReference.fatOxidationGramsPerMin - currentAtReference.fatOxidationGramsPerMin,
      carbohydrateGramsPerHourDeltaAtReference: targetAtReference.carbohydrateGramsPerHour - currentAtReference.carbohydrateGramsPerHour,
      percentVo2maxAtReference: { current: currentAtReference.percentVo2max, target: targetAtReference.percentVo2max },
    },
    notices,
    limitations: [...SUBSTRATE_LIMITATIONS, ...SCENARIO_LIMITATIONS],
    inputLineage: gate.inputLineage,
    cadenceWarning: gate.cadenceWarning,
    provenanceNotices: gate.provenanceNotices,
    reportEligible: gate.reportEligible,
  };
}
```

- [ ] **Step 5: Ejecutar las pruebas del escenario**

Run: `npx vitest run src/physiology/scenarios`
Expected: PASS, las once pruebas.

- [ ] **Step 6: Confirmar**

```bash
git add src/physiology/scenarios
git commit -m "feat: compare a real metabolic profile against a target one"
```

---

### Task 3: Bandas orientativas de VLa máx por perfil de prueba

Una banda sin cita no se publica. Esta tarea es de lectura bibliográfica antes que de código: cada intervalo debe salir de una de las dos revisiones ya citadas en `docs/model-register.md`, y la población descrita viaja con él.

**Files:**
- Create: `src/physiology/scenarios/bands.ts`
- Test: `src/physiology/scenarios/bands.test.ts`
- Modify: `docs/model-register.md`

**Interfaces:**
- Consumes: `EventProfile` de `src/physiology/scenarios/scenario.ts`.
- Produces:
  - `VLAMAX_BANDS_VERSION = 'vlamax-reference-bands@1.0.0'`
  - `export interface VlamaxBand { profile: EventProfile; lower: number; upper: number; population: string; reference: string }`
  - `export const VLAMAX_REFERENCE_BANDS: readonly VlamaxBand[]`
  - `export function bandFor(profile: EventProfile): VlamaxBand | undefined`
  - `export const EVENT_PROFILE_LABELS: Readonly<Record<EventProfile, string>>`

- [ ] **Step 1: Leer las fuentes y anotar los intervalos**

Consultar, en este orden:

1. Quittmann OJ et al. *Maximal lactate accumulation rate: current evidence and future directions*. Eur J Appl Physiol (2025). DOI 10.1007/s00421-025-06022-7.
2. Sablain M et al. *Evaluating maximal lactate accumulation rate and estimated MLSS in cycling*. Eur J Appl Physiol (2025). DOI 10.1007/s00421-025-05751-z.

Para cada perfil de prueba, anotar el intervalo publicado, **la población exacta sobre la que se midió** (sexo, nivel, especialidad, edad) y la referencia completa. Si una de las dos fuentes no está accesible o no reporta un intervalo para un perfil, **ese perfil se queda sin banda**. No se interpola, no se redondea desde una figura y no se copia de material comercial.

- [ ] **Step 2: Escribir las pruebas de la regla de publicación**

Crear `src/physiology/scenarios/bands.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { VLAMAX_REFERENCE_BANDS, VLAMAX_BANDS_VERSION, bandFor, EVENT_PROFILE_LABELS } from './bands';

describe('bandas de referencia de VLa máx', () => {
  it('nombra la versión del conjunto', () => {
    expect(VLAMAX_BANDS_VERSION).toBe('vlamax-reference-bands@1.0.0');
  });

  it('acompaña cada banda de población y referencia con DOI', () => {
    for (const band of VLAMAX_REFERENCE_BANDS) {
      expect(band.population.length).toBeGreaterThan(10);
      expect(band.reference).toMatch(/doi/i);
      expect(band.lower).toBeGreaterThan(0);
      expect(band.upper).toBeGreaterThan(band.lower);
    }
  });

  it('no repite un perfil de prueba', () => {
    const profiles = VLAMAX_REFERENCE_BANDS.map((band) => band.profile);
    expect(new Set(profiles).size).toBe(profiles.length);
  });

  it('devuelve indefinido para un perfil sin banda sustentada', () => {
    const sinBanda = (['explosiva', 'rodador', 'escalador', 'fondo'] as const)
      .filter((profile) => !VLAMAX_REFERENCE_BANDS.some((band) => band.profile === profile));
    for (const profile of sinBanda) expect(bandFor(profile)).toBeUndefined();
  });

  it('etiqueta los cuatro perfiles de prueba en español', () => {
    expect(Object.keys(EVENT_PROFILE_LABELS).sort()).toEqual(['escalador', 'explosiva', 'fondo', 'rodador']);
  });
});
```

- [ ] **Step 3: Ejecutar y comprobar el fallo inicial**

Run: `npx vitest run src/physiology/scenarios/bands.test.ts`
Expected: FAIL — no existe `./bands`.

- [ ] **Step 4: Escribir el módulo con lo leído en el paso 1**

Crear `src/physiology/scenarios/bands.ts` con esta forma. Los valores numéricos y las poblaciones son los anotados en el paso 1; no se rellenan de memoria.

```ts
import type { EventProfile } from './scenario';

export const VLAMAX_BANDS_VERSION = 'vlamax-reference-bands@1.0.0';

export const EVENT_PROFILE_LABELS: Readonly<Record<EventProfile, string>> = {
  explosiva: 'Prueba explosiva, de esfuerzos repetidos',
  rodador: 'Rodador, esfuerzo sostenido',
  escalador: 'Escalador, ascensiones largas',
  fondo: 'Fondo, larga duración',
};

export interface VlamaxBand {
  profile: EventProfile;
  /** Límite inferior publicado, en mmol·l⁻¹·s⁻¹. */
  lower: number;
  /** Límite superior publicado, en mmol·l⁻¹·s⁻¹. */
  upper: number;
  /** Población exacta sobre la que se midió el intervalo. Viaja siempre junto a la banda. */
  population: string;
  /** Referencia completa con DOI de la que se leyó el intervalo. */
  reference: string;
}

/**
 * Orientación bibliográfica, nunca objetivo. Un perfil de prueba sin intervalo
 * sustentado se queda fuera de esta lista: la pantalla lo muestra sin banda.
 */
export const VLAMAX_REFERENCE_BANDS: readonly VlamaxBand[] = [
  // Una entrada por perfil con banda verificada en el paso 1.
];

export function bandFor(profile: EventProfile): VlamaxBand | undefined {
  return VLAMAX_REFERENCE_BANDS.find((band) => band.profile === profile);
}
```

- [ ] **Step 5: Ejecutar las pruebas**

Run: `npx vitest run src/physiology/scenarios`
Expected: PASS. Las pruebas pasan aunque la lista quede vacía, porque la regla es «ninguna banda sin cita», no «cuatro bandas».

- [ ] **Step 6: Registrar los modelos nuevos**

Añadir a la tabla de `docs/model-register.md` dos filas:

```markdown
| `metabolic-scenario@1.0.0` | Perfil real que supera la guarda de Mader y valores objetivo de VLa máx y VO₂max | Dos proyecciones de sustratos, desplazamiento de FATmax y MLSS, y cambio de grasa y carbohidrato en una potencia de referencia | Experimental | Hipótesis del entrenador, no predicción. Trata VLa máx y VO₂max como independientes. Hereda todos los límites del modelo de Mader y del reparto de sustratos. |
| `vlamax-reference-bands@1.0.0` | Perfil de prueba | Intervalo orientativo de VLa máx con su población y su cita | Referencia | Orientación bibliográfica, no objetivo. Un perfil sin intervalo publicado se queda sin banda. Una población distinta a la del ciclista invalida la lectura. |
```

- [ ] **Step 7: Confirmar**

```bash
git add src/physiology/scenarios/bands.ts src/physiology/scenarios/bands.test.ts docs/model-register.md
git commit -m "feat: add sourced vLa.max reference bands by event profile"
```

---

### Task 4: Métricas que el modelo necesita y el formulario no ofrece

**Files:**
- Modify: `src/features/observations/ObservationForm.tsx:5`
- Test: `src/features/observations/observations.test.tsx`

**Interfaces:**
- Consumes: `metricCatalog` de `src/domain/metrics.ts`, que ya define `p_vo2max`, `pmax` y `tte` con unidad y rango.
- Produces: nada nuevo. Cambia la lista `selectableMetrics`.

- [ ] **Step 1: Escribir la prueba que exige P@VO₂max en el formulario**

Añadir a `src/features/observations/observations.test.tsx`:

```ts
it('ofrece las métricas que el modelo de Mader necesita', () => {
  render(<ObservationForm athleteId={crypto.randomUUID()} onAdd={() => undefined} />);
  const metric = screen.getByLabelText('Métrica');
  const options = within(metric).getAllByRole('option').map((option) => option.textContent);
  expect(options).toEqual(expect.arrayContaining([
    'VO₂max (ml·kg⁻¹·min⁻¹)',
    'VLa máx (mmol·l⁻¹·s⁻¹)',
    'Masa corporal (kg)',
    'P@VO₂max (W)',
  ]));
});
```

Si `within` no está importado en ese archivo, añadirlo a la importación de `@testing-library/react`.

- [ ] **Step 2: Ejecutar y comprobar el fallo**

Run: `npx vitest run src/features/observations`
Expected: FAIL — la lista no contiene `P@VO₂max (W)`.

- [ ] **Step 3: Ampliar la lista seleccionable**

En `src/features/observations/ObservationForm.tsx`, sustituir la línea 5 por:

```ts
const selectableMetrics: readonly MetricCode[] = [
  'ftp', 'cp', 'lt1', 'vt1', 'p_vo2max', 'pmax', 'vo2max', 'vlamax', 'lactate', 'body_mass', 'tte', 'rpe',
];
```

- [ ] **Step 4: Ejecutar las pruebas**

Run: `npx vitest run src/features/observations`
Expected: PASS.

- [ ] **Step 5: Confirmar**

```bash
git add src/features/observations
git commit -m "feat: offer the metrics the Mader model needs"
```

---

### Task 5: Construir las entradas de Mader desde las observaciones reales

**Files:**
- Create: `src/features/experimental/maderInputs.ts`
- Test: `src/features/experimental/maderInputs.test.ts`

**Interfaces:**
- Consumes: `Observation` de `src/domain/observation.ts`; `metricCatalog`, `MetricCode` de `src/domain/metrics.ts`; `MaderInputs` de `src/physiology/mader/model.ts`.
- Produces:
  - `export interface MissingMetric { metricCode: MetricCode; label: string; protocol: string }`
  - `export type MaderInputsResult = { status: 'ready'; inputs: MaderInputs } | { status: 'incomplete'; missing: MissingMetric[] }`
  - `export function maderInputsFromObservations(observations: readonly Observation[]): MaderInputsResult`

- [ ] **Step 1: Escribir las pruebas**

Crear `src/features/experimental/maderInputs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Observation } from '../../domain/observation';
import { maderInputsFromObservations } from './maderInputs';

const athleteId = '11111111-1111-4111-8111-111111111111';

function observation(overrides: Partial<Observation>): Observation {
  return {
    id: crypto.randomUUID(),
    athleteId,
    metricCode: 'vo2max',
    value: 68,
    unit: 'ml·kg⁻¹·min⁻¹',
    observedAt: '2026-09-01T08:00:00.000Z',
    origin: 'laboratory',
    quality: 'measured',
    protocol: { name: 'rampa', version: '1' },
    ...overrides,
  } as Observation;
}

const completo: Observation[] = [
  observation({}),
  observation({ metricCode: 'vlamax', value: 0.4, unit: 'mmol·l⁻¹·s⁻¹', origin: 'external_model', quality: 'calculated', sourceReference: { software: 'WKO5' } }),
  observation({ metricCode: 'body_mass', value: 70, unit: 'kg', origin: 'manual' }),
  observation({ metricCode: 'p_vo2max', value: 400, unit: 'W', origin: 'field_test' }),
  observation({ metricCode: 'ftp', value: 295, unit: 'W', origin: 'field_test' }),
];

describe('maderInputsFromObservations', () => {
  it('construye las entradas con la observación más reciente de cada métrica', () => {
    const result = maderInputsFromObservations([
      ...completo,
      observation({ metricCode: 'vlamax', value: 0.6, unit: 'mmol·l⁻¹·s⁻¹', observedAt: '2026-09-10T08:00:00.000Z', origin: 'external_model', quality: 'calculated', sourceReference: { software: 'WKO5', version: '5.0.16' } }),
    ]);
    if (result.status !== 'ready') throw new Error('Las entradas deben estar completas.');
    expect(result.inputs.vlamax.value).toBe(0.6);
    expect(result.inputs.vlamax.sourceReference).toEqual({ software: 'WKO5', version: '5.0.16' });
    expect(result.inputs.comparison?.ftpWatts).toBe(295);
  });

  it('conserva identificador y calidad de cada observación usada', () => {
    const result = maderInputsFromObservations(completo);
    if (result.status !== 'ready') throw new Error('Las entradas deben estar completas.');
    expect(result.inputs.vo2max.quality).toBe('measured');
    expect(result.inputs.vo2max.observationId).toBe(completo[0].id);
  });

  it('nombra la métrica que falta y el protocolo que la produce', () => {
    const result = maderInputsFromObservations(completo.filter((item) => item.metricCode !== 'p_vo2max'));
    if (result.status !== 'incomplete') throw new Error('Debe faltar la P@VO₂max.');
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].metricCode).toBe('p_vo2max');
    expect(result.missing[0].label).toBe('P@VO₂max');
    expect(result.missing[0].protocol.length).toBeGreaterThan(10);
  });

  it('enumera todas las métricas ausentes de un ciclista sin perfil', () => {
    const result = maderInputsFromObservations([observation({ metricCode: 'ftp', value: 239, unit: 'W' })]);
    if (result.status !== 'incomplete') throw new Error('Debe faltar casi todo.');
    expect(result.missing.map((item) => item.metricCode).sort()).toEqual(['body_mass', 'p_vo2max', 'vlamax', 'vo2max']);
  });

  it('descarta observaciones rechazadas o incompletas', () => {
    const result = maderInputsFromObservations([
      ...completo,
      observation({ metricCode: 'vo2max', value: 99, observedAt: '2026-09-12T08:00:00.000Z', quality: 'rejected' }),
    ]);
    if (result.status !== 'ready') throw new Error('Las entradas deben estar completas.');
    expect(result.inputs.vo2max.value).toBe(68);
  });

  it('no inventa el FTP de comparación cuando no existe', () => {
    const result = maderInputsFromObservations(completo.filter((item) => item.metricCode !== 'ftp'));
    if (result.status !== 'ready') throw new Error('Las entradas deben estar completas.');
    expect(result.inputs.comparison?.ftpWatts).toBeUndefined();
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar el fallo**

Run: `npx vitest run src/features/experimental/maderInputs.test.ts`
Expected: FAIL — no existe `./maderInputs`.

- [ ] **Step 3: Implementar el lector**

Crear `src/features/experimental/maderInputs.ts`:

```ts
import { metricCatalog, type MetricCode } from '../../domain/metrics';
import type { Observation } from '../../domain/observation';
import type { MaderInputs } from '../../physiology/mader/model';

export interface MissingMetric {
  metricCode: MetricCode;
  label: string;
  /** Cómo se obtiene ese valor, para que el entrenador sepa qué hacer. */
  protocol: string;
}

export type MaderInputsResult =
  | { status: 'ready'; inputs: MaderInputs }
  | { status: 'incomplete'; missing: MissingMetric[] };

const REQUIRED: ReadonlyArray<{ code: MetricCode; protocol: string }> = [
  { code: 'vo2max', protocol: 'Prueba de laboratorio en rampa, o valor de laboratorio externo con su fecha.' },
  { code: 'vlamax', protocol: 'Test de esprint con lactato, o valor calculado en WKO5 con origen external_model.' },
  { code: 'body_mass', protocol: 'Pesada fechada, registro manual o importación de Intervals.icu.' },
  { code: 'p_vo2max', protocol: 'Potencia asociada al VO₂max, de la misma prueba que lo determinó.' },
];

const USABLE_QUALITIES = new Set(['measured', 'calculated', 'imported_estimate']);

function latest(observations: readonly Observation[], code: MetricCode): Observation | undefined {
  return observations
    .filter((observation) => observation.metricCode === code && USABLE_QUALITIES.has(observation.quality))
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0];
}

export function maderInputsFromObservations(observations: readonly Observation[]): MaderInputsResult {
  const found = new Map<MetricCode, Observation>();
  const missing: MissingMetric[] = [];

  for (const requirement of REQUIRED) {
    const observation = latest(observations, requirement.code);
    if (observation) found.set(requirement.code, observation);
    else missing.push({ metricCode: requirement.code, label: metricCatalog[requirement.code].label, protocol: requirement.protocol });
  }
  if (missing.length) return { status: 'incomplete', missing };

  const input = <Unit extends string>(code: MetricCode) => {
    const observation = found.get(code) as Observation;
    return {
      value: observation.value,
      unit: metricCatalog[code].unit as Unit,
      quality: observation.quality,
      observationId: observation.id,
      ...(observation.sourceReference ? { sourceReference: observation.sourceReference } : {}),
    };
  };

  const ftp = latest(observations, 'ftp');
  const cp = latest(observations, 'cp');
  const mlss = latest(observations, 'mlss');
  const comparison = {
    ...(ftp ? { ftpWatts: ftp.value } : {}),
    ...(cp ? { cpWatts: cp.value } : {}),
    ...(mlss ? { mlssMeasuredWatts: mlss.value } : {}),
  };

  return {
    status: 'ready',
    inputs: {
      vo2max: input<'ml·kg⁻¹·min⁻¹'>('vo2max'),
      vlamax: input<'mmol·l⁻¹·s⁻¹'>('vlamax'),
      bodyMass: input<'kg'>('body_mass'),
      pVo2max: input<'W'>('p_vo2max'),
      ...(Object.keys(comparison).length ? { comparison } : {}),
    },
  };
}
```

- [ ] **Step 4: Ejecutar las pruebas**

Run: `npx vitest run src/features/experimental`
Expected: PASS, incluidas las pruebas previas de `MaderView` y `SubstrateProfile`.

- [ ] **Step 5: Comprobar tipos y estilo**

Run: `npm run typecheck && npm run lint`
Expected: sin errores ni avisos.

- [ ] **Step 6: Confirmar**

```bash
git add src/features/experimental/maderInputs.ts src/features/experimental/maderInputs.test.ts
git commit -m "feat: build Mader inputs from the athlete's own observations"
```

---

### Task 6: La ruta de Tests deja de ser una demostración

**Files:**
- Create: `src/features/experimental/TestsWorkspace.tsx`
- Test: `src/features/experimental/TestsWorkspace.test.tsx`
- Modify: `src/features/tests/LactateSprintWizard.tsx:3-22`
- Modify: `src/app/App.tsx:14,58`
- Modify: `src/app/DemoViews.tsx:85` (eliminar `TestsDemo`)

**Interfaces:**
- Consumes: `useAnalysis` de `src/analysis/AnalysisContext.ts`, que expone `athlete: AthleteDetail | null` con sus `observations`, `loadingAthlete` y `addObservation`; `maderInputsFromObservations` (Task 5); `MaderView` de `./MaderView`.
- Produces: `export function TestsWorkspace(): JSX.Element`, montado en la ruta `/tests`.
- El asistente pasa a recibir `onConfirm`: `export function LactateSprintWizard({ initial, onConfirm }: { initial: LactateSprintSession; onConfirm?: (vlamax: number) => void })`.

- [ ] **Step 1: Escribir las pruebas de la ruta**

Crear `src/features/experimental/TestsWorkspace.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnalysisContext, type AnalysisContextValue } from '../../analysis/AnalysisContext';
import type { Observation } from '../../domain/observation';
import { TestsWorkspace } from './TestsWorkspace';

const athleteId = '11111111-1111-4111-8111-111111111111';

function observation(overrides: Partial<Observation>): Observation {
  return {
    id: crypto.randomUUID(), athleteId, metricCode: 'vo2max', value: 68,
    unit: 'ml·kg⁻¹·min⁻¹', observedAt: '2026-09-01T08:00:00.000Z', origin: 'laboratory',
    quality: 'measured', protocol: { name: 'rampa', version: '1' }, ...overrides,
  } as Observation;
}

function renderWith(observations: Observation[], athlete: Partial<AnalysisContextValue['athlete']> = {}) {
  const value = {
    athletes: [], athleteId, period: '90 días', environment: 'all', today: '2026-09-16',
    sync: { status: 'idle' }, loadingRoster: false, loadingAthlete: false, error: '',
    athlete: { id: athleteId, name: 'Jaume Santamaria', observations, ...athlete },
    selectAthlete: () => undefined, setPeriod: () => undefined, setEnvironment: () => undefined,
    synchronize: async () => undefined, reloadRoster: async () => undefined,
    addObservation: async () => undefined, clearError: () => undefined,
  } as unknown as AnalysisContextValue;
  return render(<AnalysisContext.Provider value={value}><TestsWorkspace /></AnalysisContext.Provider>);
}

const perfilCompleto = [
  observation({}),
  observation({ metricCode: 'vlamax', value: 0.4, unit: 'mmol·l⁻¹·s⁻¹', origin: 'external_model', quality: 'calculated', sourceReference: { software: 'WKO5' } }),
  observation({ metricCode: 'body_mass', value: 70, unit: 'kg', origin: 'manual' }),
  observation({ metricCode: 'p_vo2max', value: 400, unit: 'W', origin: 'field_test' }),
];

describe('TestsWorkspace', () => {
  it('nombra al ciclista activo y no ofrece demostración', () => {
    renderWith(perfilCompleto);
    expect(screen.getByText(/Jaume Santamaria/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /demostración/i })).not.toBeInTheDocument();
  });

  it('calcula el modelo de Mader con las observaciones del ciclista', () => {
    renderWith(perfilCompleto);
    expect(screen.getByText('MLSS modelado')).toBeInTheDocument();
    expect(screen.getByText(/WKO5/)).toBeInTheDocument();
  });

  it('dice qué métrica falta y qué protocolo la produce', () => {
    renderWith(perfilCompleto.filter((item) => item.metricCode !== 'p_vo2max'));
    expect(screen.getByRole('alert')).toHaveTextContent(/P@VO₂max/);
    expect(screen.getByRole('alert')).toHaveTextContent(/potencia asociada al VO₂max/i);
    expect(screen.queryByText('MLSS modelado')).not.toBeInTheDocument();
  });

  it('pide seleccionar ciclista cuando no hay ninguno', () => {
    const value = {
      athletes: [], athleteId: '', athlete: null, period: '90 días', environment: 'all',
      today: '2026-09-16', sync: { status: 'idle' }, loadingRoster: false, loadingAthlete: false,
      error: '', selectAthlete: () => undefined, setPeriod: () => undefined,
      setEnvironment: () => undefined, synchronize: async () => undefined,
      reloadRoster: async () => undefined, addObservation: async () => undefined,
      clearError: () => undefined,
    } as unknown as AnalysisContextValue;
    render(<AnalysisContext.Provider value={value}><TestsWorkspace /></AnalysisContext.Provider>);
    expect(screen.getByText(/Selecciona un ciclista/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar el fallo**

Run: `npx vitest run src/features/experimental/TestsWorkspace.test.tsx`
Expected: FAIL — no existe `./TestsWorkspace`.

- [ ] **Step 3: Implementar la ruta**

Crear `src/features/experimental/TestsWorkspace.tsx`:

```tsx
import { useMemo } from 'react';
import { useAnalysis } from '../../analysis/AnalysisContext';
import { LactateSprintWizard } from '../tests/LactateSprintWizard';
import { maderInputsFromObservations } from './maderInputs';
import { MaderView } from './MaderView';

export function TestsWorkspace() {
  const { athlete, loadingAthlete } = useAnalysis();
  const observations = useMemo(() => athlete?.observations ?? [], [athlete]);
  const inputs = useMemo(() => maderInputsFromObservations(observations), [observations]);

  if (!athlete) {
    return (
      <section className="empty-state" aria-labelledby="tests-title">
        <h1 id="tests-title">Tests fisiológicos</h1>
        <p>Selecciona un ciclista en la barra de análisis para trabajar con sus pruebas.</p>
      </section>
    );
  }

  return (
    <section className="model-view" aria-labelledby="tests-title">
      <header>
        <p className="eyebrow">Tests fisiológicos</p>
        <h1 id="tests-title">{athlete.name}</h1>
        <p>Protocolos guiados y modelos alimentados por sus propias observaciones.</p>
      </header>

      {loadingAthlete && <p role="status">Cargando las observaciones del ciclista.</p>}

      <LactateSprintWizard initial={{ baselineLactate: 0, sprintDurationSeconds: 0, alacticTimeSeconds: 0, samples: [] }} />

      {inputs.status === 'incomplete' ? (
        <div role="alert" className="protocol-result protocol-result--warning">
          <h2>Perfil incompleto</h2>
          <p>El modelo de Mader necesita estas métricas antes de poder calcular nada:</p>
          <ul>
            {inputs.missing.map((metric) => (
              <li key={metric.metricCode}><strong>{metric.label}</strong>: {metric.protocol}</li>
            ))}
          </ul>
          <p>Se añaden en la mesa de análisis, con su origen, su protocolo y su fecha.</p>
        </div>
      ) : (
        <MaderView inputs={inputs.inputs} />
      )}
    </section>
  );
}
```

- [ ] **Step 4: Guardar el resultado del test de lactato como observación**

En `src/features/tests/LactateSprintWizard.tsx`, aceptar un `onConfirm` opcional y llamarlo con la VLa máx estimada al pulsar el botón, que hoy no hace nada:

```tsx
export function LactateSprintWizard({ initial, onConfirm }: { initial: LactateSprintSession; onConfirm?: (vlamax: number) => void }) {
```

```tsx
<button type="button" disabled={!complete} onClick={() => { if (complete && result.status === 'estimated') onConfirm?.(result.vlamax); }}>Confirmar y guardar resultado</button>
```

Ajustar los nombres `result.status` y `result.vlamax` a los que ya devuelve el módulo `lactate-sprint@1.0.0` en ese archivo; no inventar campos.

En `TestsWorkspace`, pasar el manejador que crea la observación:

```tsx
const { athlete, loadingAthlete, addObservation } = useAnalysis();
```

```tsx
<LactateSprintWizard
  initial={{ baselineLactate: 0, sprintDurationSeconds: 0, alacticTimeSeconds: 0, samples: [] }}
  onConfirm={(vlamax) => {
    void addObservation({
      id: crypto.randomUUID(), athleteId: athlete.id, metricCode: 'vlamax', value: vlamax,
      unit: 'mmol·l⁻¹·s⁻¹', observedAt: new Date().toISOString(), origin: 'field_test',
      quality: 'measured', protocol: { name: 'esprint con lactato', version: 'lactate-sprint@1.0.0' },
    });
  }}
/>
```

- [ ] **Step 5: Montar la ruta y retirar la demostración**

En `src/app/App.tsx`, importar `TestsWorkspace` desde `../features/experimental/TestsWorkspace`, sustituir `'/tests': <TestsDemo />` por `'/tests': <TestsWorkspace />`, y quitar `TestsDemo` de la importación de `./DemoViews`. En `src/app/DemoViews.tsx`, borrar la función `TestsDemo` y las importaciones que queden sin uso.

- [ ] **Step 6: Ejecutar toda la suite**

Run: `npm run test:run`
Expected: PASS. Las pruebas antiguas que renderizaban `MaderView` con entradas fijas siguen valiendo: el componente no cambia de firma.

- [ ] **Step 7: Confirmar**

```bash
git add src/features/experimental src/features/tests src/app/App.tsx src/app/DemoViews.tsx
git commit -m "feat: run the tests route on the selected athlete"
```

---

### Task 7: Gráfico comparado de oxidación de grasa

**Files:**
- Create: `src/features/experimental/ScenarioChart.tsx`
- Test: `src/features/experimental/ScenarioChart.test.tsx`
- Modify: `src/styles/` (la hoja donde vive `.substrate-profile__canvas`; localizarla con `grep -rn "substrate-profile__canvas" src/styles`)

**Interfaces:**
- Consumes: el resultado calculado de `buildMetabolicScenario` (Task 2); `Chart` de `chart.js` con los controladores ya registrados en `SubstrateProfile.tsx`.
- Produces: `export function ScenarioChart({ scenario, ftpWatts }: { scenario: CalculatedScenario; ftpWatts?: number }): JSX.Element`, donde `CalculatedScenario = Extract<MetabolicScenarioResult, { status: 'calculated' }>`.

- [ ] **Step 1: Escribir las pruebas de contenido y accesibilidad**

Crear `src/features/experimental/ScenarioChart.test.tsx`. El lienzo no se dibuja en jsdom, así que lo que se prueba es el texto que acompaña al gráfico, que es justamente lo que un lector de pantalla recibe:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildMetabolicScenario } from '../../physiology/scenarios/scenario';
import type { MaderInputs } from '../../physiology/mader/model';
import { ScenarioChart } from './ScenarioChart';

const inputs: MaderInputs = {
  vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'o-vo2' },
  vlamax: { value: 0.4, unit: 'mmol·l⁻¹·s⁻¹', quality: 'measured', observationId: 'o-vla' },
  bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'o-masa' },
  pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'o-pvo2' },
};

function scenario() {
  const result = buildMetabolicScenario(inputs, { restingVo2: 5 }, { vlamax: 0.8 });
  if (result.status !== 'calculated') throw new Error('El escenario debe calcularse.');
  return result;
}

describe('ScenarioChart', () => {
  it('describe las dos curvas con sus cifras en la alternativa textual', () => {
    const result = scenario();
    render(<ScenarioChart scenario={result} ftpWatts={295} />);
    const image = screen.getByRole('img');
    const description = image.getAttribute('aria-label') ?? '';
    expect(description).toMatch(/perfil actual/i);
    expect(description).toMatch(/perfil objetivo/i);
    expect(description).toMatch(new RegExp(`${Math.round(result.current.fatmax.powerWatts)} W`));
    expect(description).toMatch(new RegExp(`${Math.round(result.target.fatmax.powerWatts)} W`));
  });

  it('genera el título desde los mismos valores que dibuja', () => {
    const result = scenario();
    render(<ScenarioChart scenario={result} ftpWatts={295} />);
    const heading = screen.getByRole('heading', { level: 3 }).textContent ?? '';
    expect(heading).toContain(`${Math.round(result.current.fatmax.powerWatts)} W`);
    expect(heading).toContain(`${Math.round(result.target.fatmax.powerWatts)} W`);
  });

  it('distingue el perfil objetivo por algo más que el color', () => {
    render(<ScenarioChart scenario={scenario()} ftpWatts={295} />);
    expect(screen.getByText(/trazo discontinuo/i)).toBeInTheDocument();
  });

  it('advierte cuando la curva objetivo agota la grasa dentro del rango dibujado', () => {
    render(<ScenarioChart scenario={scenario()} ftpWatts={295} />);
    expect(screen.getByText(/artefacto de la formulación/i)).toBeInTheDocument();
  });

  it('avisa de que no hay FTP medido cuando no se pasa', () => {
    render(<ScenarioChart scenario={scenario()} />);
    expect(screen.getByText(/sin FTP medido/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar el fallo**

Run: `npx vitest run src/features/experimental/ScenarioChart.test.tsx`
Expected: FAIL — no existe `./ScenarioChart`.

- [ ] **Step 3: Implementar el gráfico**

Crear `src/features/experimental/ScenarioChart.tsx` siguiendo el patrón de `SubstrateProfile.tsx`: `useRef` sobre el lienzo, `useEffect` que construye el `Chart` y lo destruye al desmontar, colores leídos de las variables CSS, `prefers-reduced-motion` respetado.

Diferencias respecto a `SubstrateProfile`:

- Dos conjuntos de datos, ambos de grasa en g/min contra vatios: el actual con `borderDash: []` y el objetivo con `borderDash: [8, 4]`.
- Un complemento propio, declarado en el mismo archivo, que dibuja las anotaciones. No se instala ninguna dependencia:

```ts
interface Marker { x: number; y: number; label: string }

const annotationPlugin = {
  id: 'escenario-anotaciones',
  afterDatasetsDraw(chart: Chart, _args: unknown, options: { markers: Marker[]; ftp?: number; colours: { current: string; target: string; muted: string } }) {
    const { ctx, scales } = chart;
    ctx.save();
    if (options.ftp != null) {
      const x = scales.x.getPixelForValue(options.ftp);
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = options.colours.muted;
      ctx.beginPath();
      ctx.moveTo(x, chart.chartArea.top);
      ctx.lineTo(x, chart.chartArea.bottom);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const marker of options.markers) {
      const x = scales.x.getPixelForValue(marker.x);
      const y = scales.fat.getPixelForValue(marker.y);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(marker.label, x + 10, y - 10);
    }
    ctx.restore();
  },
};
```

Registrarlo con `Chart.register(annotationPlugin)` junto a los controladores. El eje vertical
se declara con identificador `fat`, que es el que el complemento consulta en `scales.fat`.

**Las etiquetas se construyen siempre desde los valores del escenario**, nunca desde texto fijo:

```tsx
const format = (value: number, decimals = 0) =>
  value.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const anchorLabel = (prefix: string, point: SubstratePoint) =>
  `${prefix} ${format(point.powerWatts)} W (${format(point.fatOxidationGramsPerMin, 2)} g/min)`;

const title = `Subir la VLa máx de ${format(scenario.realValues.vlamax, 2)} a ${format(scenario.appliedTargets.vlamax, 2)} desplaza el FATmax de ${format(scenario.current.fatmax.powerWatts)} W a ${format(scenario.target.fatmax.powerWatts)} W`;
```

El encabezado `<h3>` del componente muestra ese mismo `title`.

Debajo del lienzo, tres textos fijos y uno condicional:

- una leyenda en texto: «Perfil actual, trazo continuo. Perfil objetivo, trazo discontinuo.»;
- la advertencia del MLSS cuando `scenario.target.mlss.powerWatts` cae dentro del rango dibujado: «La curva objetivo llega a cero gramos por minuto en su MLSS modelado, de X W. La extinción completa de la oxidación de grasas es un artefacto de la formulación, no una afirmación fisiológica.»;
- cuando no se recibe `ftpWatts`: «Sin FTP medido: el gráfico se dibuja sin la referencia de FTP.»;
- la alternativa textual completa en `aria-label` del lienzo, con las dos curvas, sus FATmax y sus MLSS en vatios y en gramos por minuto.

- [ ] **Step 4: Ejecutar las pruebas**

Run: `npx vitest run src/features/experimental/ScenarioChart.test.tsx`
Expected: PASS.

- [ ] **Step 5: Confirmar**

```bash
git add src/features/experimental/ScenarioChart.tsx src/features/experimental/ScenarioChart.test.tsx src/styles
git commit -m "feat: draw the current and target fat oxidation curves together"
```

---

### Task 8: Panel del escenario, con sus palancas y su lectura

**Files:**
- Create: `src/features/experimental/ScenarioPanel.tsx`
- Test: `src/features/experimental/ScenarioPanel.test.tsx`
- Modify: `src/features/experimental/TestsWorkspace.tsx`

**Interfaces:**
- Consumes: `buildMetabolicScenario`, `EventProfile` (Task 2); `bandFor`, `EVENT_PROFILE_LABELS` (Task 3); `ScenarioChart` (Task 7); `MaderInputs`.
- Produces: `export function ScenarioPanel({ inputs, minor }: { inputs: MaderInputs; minor: boolean }): JSX.Element`.

- [ ] **Step 1: Escribir las pruebas del panel**

Crear `src/features/experimental/ScenarioPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { MaderInputs } from '../../physiology/mader/model';
import { ScenarioPanel } from './ScenarioPanel';

const inputs: MaderInputs = {
  vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'o-vo2' },
  vlamax: { value: 0.4, unit: 'mmol·l⁻¹·s⁻¹', quality: 'measured', observationId: 'o-vla' },
  bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'o-masa' },
  pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'o-pvo2' },
  comparison: { ftpWatts: 295 },
};

describe('ScenarioPanel', () => {
  it('no calcula nada hasta que se propone una VLa máx objetivo', () => {
    render(<ScenarioPanel inputs={inputs} minor={false} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/Propón una VLa máx objetivo/i)).toBeInTheDocument();
  });

  it('compara los dos perfiles al introducir el objetivo', async () => {
    const user = userEvent.setup();
    render(<ScenarioPanel inputs={inputs} minor={false} />);
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
    expect(await screen.findByRole('img')).toBeInTheDocument();
    expect(screen.getByText(/Qué cuesta el cambio/i)).toBeInTheDocument();
  });

  it('marca cada cifra objetivo con la palabra objetivo', async () => {
    const user = userEvent.setup();
    render(<ScenarioPanel inputs={inputs} minor={false} />);
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
    const tabla = await screen.findByRole('table', { name: /comparación de perfiles/i });
    expect(tabla).toHaveTextContent(/objetivo/i);
  });

  it('avisa fuera del rango del catálogo sin llegar a calcular', async () => {
    const user = userEvent.setup();
    render(<ScenarioPanel inputs={inputs} minor={false} />);
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '7');
    expect(await screen.findByRole('alert')).toHaveTextContent(/fuera del rango/i);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('muestra la banda orientativa con su población y su cita', async () => {
    const user = userEvent.setup();
    render(<ScenarioPanel inputs={inputs} minor={false} />);
    await user.selectOptions(screen.getByLabelText(/Perfil de la prueba/i), 'explosiva');
    const banda = screen.queryByTestId('banda-orientativa');
    if (banda) {
      expect(banda).toHaveTextContent(/doi/i);
      expect(banda).toHaveTextContent(/orientación/i);
    } else {
      expect(screen.getByText(/sin banda publicada/i)).toBeInTheDocument();
    }
  });

  it('añade el aviso de maduración en un menor', async () => {
    const user = userEvent.setup();
    render(<ScenarioPanel inputs={inputs} minor />);
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
    expect(await screen.findByText(/maduración/i)).toBeInTheDocument();
  });

  it('declara siempre que el perfil objetivo es una hipótesis', async () => {
    const user = userEvent.setup();
    render(<ScenarioPanel inputs={inputs} minor={false} />);
    await user.type(screen.getByLabelText(/VLa máx objetivo/i), '0.8');
    expect(await screen.findByText(/hipótesis de trabajo del entrenador/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar el fallo**

Run: `npx vitest run src/features/experimental/ScenarioPanel.test.tsx`
Expected: FAIL — no existe `./ScenarioPanel`.

- [ ] **Step 3: Implementar el panel**

Crear `src/features/experimental/ScenarioPanel.tsx` con:

- Estado local para `targetVlamax`, `targetVo2max`, `eventProfile` y `referencePower`, todos como texto, convertidos con `Number()` al usarlos.
- Validación contra `metricCatalog.vlamax` y `metricCatalog.vo2max` antes de calcular: fuera de `[min, max]`, se muestra un `role="alert"` y no se llama al motor.
- `useMemo` que llama a `buildMetabolicScenario(inputs, { restingVo2: 5, referencePowerWatts }, { vlamax, vo2max })` solo cuando los valores son válidos.
- `ScenarioChart` con `ftpWatts={inputs.comparison?.ftpWatts}`.
- Una sección «Qué cuesta el cambio» con las cifras de `scenario.change`, cada una con su unidad y su signo explícito.
- Una tabla con `aria-label="Comparación de perfiles"` y dos filas rotuladas «Perfil actual» y «Perfil objetivo», más una fila de diferencias. Cada celda del perfil objetivo lleva la palabra «objetivo» en su encabezado de fila.
- La banda: `bandFor(eventProfile)`; si existe, un bloque con `data-testid="banda-orientativa"` que muestra intervalo, población, la cita y la palabra «orientación»; si no, el texto «Este perfil de prueba no tiene banda publicada en las fuentes del proyecto».
- `scenario.notices`, `scenario.provenanceNotices`, `scenario.cadenceWarning` y `scenario.limitations`, todos renderizados.
- Cuando `minor` es cierto, además `SCENARIO_MINOR_NOTICE`.

- [ ] **Step 4: Montar el panel en la ruta de Tests**

En `TestsWorkspace.tsx`, dentro de la rama en la que `inputs.status === 'ready'`, añadir bajo `<MaderView … />`:

```tsx
<ScenarioPanel inputs={inputs.inputs} minor={isMinor(athlete)} />
```

Resolver la minoría de edad desde el dato del ciclista que ya exista en `AthleteDetail`. Si `AthleteDetail` no expone fecha de nacimiento ni edad, pasar `minor={false}` y **dejar una prueba pendiente anotada en el acta de aceptación**, en lugar de inventar el dato.

- [ ] **Step 5: Ejecutar la suite completa**

Run: `npm run test:run && npm run typecheck && npm run lint`
Expected: PASS y sin avisos.

- [ ] **Step 6: Confirmar**

```bash
git add src/features/experimental
git commit -m "feat: propose a target profile and read what the change costs"
```

---

### Task 9: Tabla de escenarios en la base de datos

**Files:**
- Modify: `supabase/schemas/01_core.sql`
- Modify: `supabase/schemas/02_rls.sql`
- Create: `supabase/migrations/<generada por db diff>_metabolic_scenarios.sql`
- Test: el archivo pgTAP del proyecto (localizarlo con `ls supabase/tests` antes de empezar; si no existe, crear `supabase/tests/metabolic_scenarios.test.sql` siguiendo el patrón de las pruebas de durabilidad)

**Interfaces:**
- Consumes: `public.athletes`, `public.coach_profiles`, `public.coach_can_access_athlete`, `public.coach_can_edit_athlete`, ya definidas.
- Produces: tabla `public.metabolic_scenarios` con RLS de lectura por acceso al ciclista y escritura exclusiva de `service_role`.

- [ ] **Step 1: Escribir las pruebas pgTAP antes de crear la tabla**

Cubrir: que un entrenador sin acceso no ve filas; que `authenticated` no puede insertar; que `service_role` sí; que la fila es inmutable ante `update` y `delete`; que `event_profile` rechaza un valor fuera de los cuatro admitidos; y que `targets` exige la clave `vlamax`.

- [ ] **Step 2: Ejecutar pgTAP y comprobar el fallo inicial**

Run: `docker exec -i supabase_db_perfil-metabolico psql -U postgres -d postgres -f - < supabase/tests/metabolic_scenarios.test.sql`
Expected: FAIL — la relación `public.metabolic_scenarios` no existe.

- [ ] **Step 3: Declarar la tabla en el esquema**

Añadir a `supabase/schemas/01_core.sql`, después de las tablas de durabilidad:

```sql
create table public.metabolic_scenarios (
  id uuid primary key default extensions.gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  created_by uuid not null references public.coach_profiles(id),
  scenario_name text not null check (char_length(scenario_name) between 1 and 120),
  rationale text not null check (char_length(rationale) between 1 and 2000),
  event_profile text not null check (event_profile in ('explosiva', 'rodador', 'escalador', 'fondo')),
  -- Entradas reales con su procedencia, copiadas para que el escenario sea reproducible.
  real_inputs jsonb not null check (jsonb_typeof(real_inputs) = 'object'),
  -- Valores propuestos por el entrenador. Nunca son mediciones.
  targets jsonb not null check (jsonb_typeof(targets) = 'object' and targets ? 'vlamax'),
  reference_power_watts numeric not null check (reference_power_watts > 0),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  model_versions jsonb not null check (jsonb_typeof(model_versions) = 'object'),
  outcome jsonb not null check (jsonb_typeof(outcome) = 'object'),
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (athlete_id, content_hash)
);

create index metabolic_scenarios_athlete_created_idx
on public.metabolic_scenarios (athlete_id, created_at desc);
create index metabolic_scenarios_created_by_idx
on public.metabolic_scenarios (created_by);

create or replace function public.prevent_metabolic_scenario_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Saved metabolic scenarios are immutable';
end;
$$;

create trigger metabolic_scenarios_immutable
before update or delete on public.metabolic_scenarios
for each row execute function public.prevent_metabolic_scenario_mutation();
```

Y a `supabase/schemas/02_rls.sql`:

```sql
alter table public.metabolic_scenarios enable row level security;
revoke all on table public.metabolic_scenarios from public, anon, authenticated, service_role;
grant select on table public.metabolic_scenarios to authenticated;
grant select, insert on table public.metabolic_scenarios to service_role;

create policy metabolic_scenarios_select_authorized on public.metabolic_scenarios
for select to authenticated using ((select public.coach_can_access_athlete(athlete_id)));
```

- [ ] **Step 4: Generar la migración con la herramienta, nunca a mano**

Run: `supabase db diff -f metabolic_scenarios`
Expected: un archivo nuevo en `supabase/migrations/` que contiene exactamente la tabla, los índices, el disparador y las políticas. Leerlo entero antes de seguir.

- [ ] **Step 5: Probar la migración en una transacción revertida**

```bash
docker exec -i supabase_db_perfil-metabolico psql -U postgres -d postgres <<'SQL'
begin;
\i /dev/stdin
rollback;
SQL
```

Alternativa equivalente y más cómoda: concatenar `begin;`, el contenido de la migración y `rollback;` en un archivo temporal del directorio de trabajo y pasarlo por `psql`. Expected: sin errores, y la tabla no existe al terminar.

- [ ] **Step 6: Aplicar la migración a la base compartida**

Run: `supabase migration up`
Expected: aplica solo la migración nueva. **No usar `db reset`.**

- [ ] **Step 7: Ejecutar pgTAP**

Run: el mismo comando del paso 2.
Expected: PASS.

- [ ] **Step 8: Confirmar**

```bash
git add supabase
git commit -m "feat: store metabolic scenarios apart from measurements"
```

---

### Task 10: Función de servidor y adaptador de cliente

**Files:**
- Create: `netlify/functions/metabolic-scenarios.ts`
- Test: `netlify/functions/metabolic-scenarios.test.ts`
- Create: `src/features/experimental/scenarioApi.ts`
- Test: `src/features/experimental/scenarioApi.test.ts`

**Interfaces:**
- Consumes: `authenticateRequest` de `./lib/authorization.js`, `bearerToken` y `jsonResponse` de `./lib/http.js`, con el patrón exacto de `netlify/functions/power-analysis.ts`; `buildMetabolicScenario` (Task 2); `getAccessToken` de `src/auth/supabase.ts`.
- Produces:
  - Servidor: `GET /.netlify/functions/metabolic-scenarios?athleteId=<uuid>` devuelve la lista del ciclista, más reciente primero; `POST` guarda uno y devuelve la fila creada.
  - Cliente: `export interface ScenarioApi { list(athleteId: string, signal: AbortSignal): Promise<SavedScenario[]>; save(input: SaveScenarioInput): Promise<SavedScenario> }` y `export const scenarioApi: ScenarioApi`.

- [ ] **Step 1: Escribir las pruebas del servidor**

Crear `netlify/functions/metabolic-scenarios.test.ts` cubriendo:

- 401 sin credenciales;
- 403 con un ciclista al que el entrenador no tiene acceso;
- 400 con `targets.vlamax` ausente, cero, negativo o no finito;
- 400 cuando las entradas reales no superan la guarda de Mader;
- el servidor **recalcula** el resultado y **descarta** el `outcome` que venga en el cuerpo: una petición con un `outcome` manipulado se guarda con el recalculado;
- dos peticiones idénticas no crean dos filas, porque el `content_hash` coincide;
- **ningún valor objetivo llega a `observations` ni a `derived_results`**: la prueba inyecta un
  `persistScenario` que registra cada tabla escrita y comprueba que la única es
  `metabolic_scenarios`;
- la respuesta nunca incluye claves ni correos.

Seguir el estilo de `netlify/functions/power-analysis.ts`: dependencias inyectadas (`authenticate`, `authorize`, `persistScenario`, `now`) para que la prueba no toque la red ni la base.

- [ ] **Step 2: Ejecutar y comprobar el fallo**

Run: `npx vitest run netlify/functions/metabolic-scenarios.test.ts`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar la función**

El cuerpo admitido se valida con Zod:

```ts
const saveScenarioSchema = z.strictObject({
  athleteId: z.uuid(),
  scenarioName: z.string().min(1).max(120),
  rationale: z.string().min(1).max(2_000),
  eventProfile: z.enum(['explosiva', 'rodador', 'escalador', 'fondo']),
  realInputs: z.strictObject({
    vo2max: modelInputSchema,
    vlamax: modelInputSchema,
    bodyMass: modelInputSchema,
    pVo2max: modelInputSchema,
    comparison: z.strictObject({
      ftpWatts: z.number().finite().positive().optional(),
      cpWatts: z.number().finite().positive().optional(),
      lt2Watts: z.number().finite().positive().optional(),
      mlssMeasuredWatts: z.number().finite().positive().optional(),
    }).optional(),
  }),
  targets: z.strictObject({
    vlamax: z.number().finite().positive(),
    vo2max: z.number().finite().positive().optional(),
  }),
  referencePowerWatts: z.number().finite().positive(),
  config: z.strictObject({ restingVo2: z.number().finite().positive() }),
});
```

El servidor llama a `buildMetabolicScenario` con lo recibido y guarda **su** resultado, no el del cliente. El `content_hash` se calcula sobre `athleteId`, `realInputs`, `targets`, `referencePowerWatts`, `config` y las versiones de modelo, con `createHash('sha256')` de `node:crypto` sobre el JSON con las claves ordenadas.

- [ ] **Step 4: Ejecutar las pruebas del servidor**

Run: `npx vitest run netlify/functions/metabolic-scenarios.test.ts`
Expected: PASS.

- [ ] **Step 5: Escribir el adaptador de cliente y sus pruebas**

`src/features/experimental/scenarioApi.ts` copia la forma de `src/features/power/powerApi.ts`: esquemas Zod para la respuesta, mensajes por código de estado en español, `parseSuccessfulResponse`, y `createScenarioApi({ getToken, fetchImpl })` para poder probarlo con un `fetch` falso. Las pruebas cubren: cabecera `Authorization`, respuesta inválida que produce un error legible, y 403 traducido.

- [ ] **Step 6: Ejecutar las pruebas del adaptador**

Run: `npx vitest run src/features/experimental/scenarioApi.test.ts`
Expected: PASS.

- [ ] **Step 7: Confirmar**

```bash
git add netlify/functions/metabolic-scenarios.ts netlify/functions/metabolic-scenarios.test.ts src/features/experimental/scenarioApi.ts src/features/experimental/scenarioApi.test.ts
git commit -m "feat: save scenarios through the server, recomputed there"
```

---

### Task 11: Guardar, recuperar y dejar constancia

**Files:**
- Modify: `src/features/experimental/ScenarioPanel.tsx`
- Modify: `src/features/experimental/ScenarioPanel.test.tsx`
- Create: `tests/e2e/escenarios.spec.ts` (confirmar antes la carpeta real con `ls tests`)
- Modify: `docs/acceptance-status.md`
- Modify: `docs/operations.md`

**Interfaces:**
- Consumes: `scenarioApi` (Task 10); `ScenarioPanel` (Task 8).
- Produces: el panel gana botón de guardado, lista de escenarios guardados y recuperación al volver a la ruta.

- [ ] **Step 1: Escribir las pruebas de guardado en el panel**

Añadir a `ScenarioPanel.test.tsx`, con un `scenarioApi` falso inyectado por props:

- el botón de guardar está deshabilitado mientras falten nombre o justificación;
- al guardar se envían las entradas reales, los objetivos y la potencia de referencia;
- un escenario guardado aparece en la lista con su fecha y su nombre;
- un fallo del servidor deja el formulario intacto y muestra el mensaje;
- el guardado está deshabilitado cuando `comparable` es falso.

- [ ] **Step 2: Ejecutar y comprobar el fallo**

Run: `npx vitest run src/features/experimental/ScenarioPanel.test.tsx`
Expected: FAIL en las pruebas nuevas.

- [ ] **Step 3: Implementar el guardado**

Añadir a `ScenarioPanel` los campos de nombre y justificación, el botón, los estados `idle | saving | saved | error`, y la carga de la lista con `useEffect` y `AbortController`, siguiendo el patrón de `PowerWorkspace`.

- [ ] **Step 4: Ejecutar la suite completa**

Run: `npm run test:run && npm run typecheck && npm run lint && npm run build && npm run security:secrets`
Expected: todo en verde y sin secretos detectados.

- [ ] **Step 5: Escribir la prueba de navegador**

En Playwright, con la sesión local: seleccionar ciclista, ir a Tests, comprobar que **no** existe el botón de demostración, introducir una VLa máx objetivo, ver las dos curvas, guardar el escenario, recargar y comprobar que sigue ahí. Añadir la comprobación de axe, el recorrido por teclado, el ancho de 360 px y la escala al 200 %, como en las pruebas de Durabilidad.

- [ ] **Step 6: Ejecutar Playwright**

Run: `npm run test:e2e`
Expected: PASS.

- [ ] **Step 7: Aceptación con datos reales**

Con Docker abierto y `npm run dev:real`: cargar a un ciclista real, añadirle a mano VO₂max, VLa máx y P@VO₂max por el formulario de observaciones, comprobar que la ruta de Tests calcula, proponer una VLa máx objetivo, leer el coste, guardar, recargar y recuperar. Anotar las cifras obtenidas.

- [ ] **Step 8: Actualizar el acta de aceptación**

Añadir a `docs/acceptance-status.md` una fila 21, «Escenarios metabólicos», con la evidencia real del paso 7, y en «Alcance pendiente» dejar constancia de dos cosas: que las rutas de Sesiones, Prescripción, Evolución e Informes siguen en demostración, y si quedó pendiente el aviso de menores por no exponer `AthleteDetail` la edad.

- [ ] **Step 9: Confirmar**

```bash
git add src/features/experimental tests docs
git commit -m "feat: keep a saved scenario across reloads"
```

---

## Notas para quien ejecute

- Los cuatro bloques que siguen a este, en orden: Evolución, Sesiones, Prescripción e Informes. Cada uno necesita su propia spec antes de su plan. Informes va el último porque depende de los otros tres.
- Si al implementar aparece que `AthleteDetail` no expone la edad del ciclista, no inventarla ni derivarla de la fecha de creación: pasar `minor={false}`, anotarlo en el acta y dejarlo para el bloque que incorpore la ficha del ciclista.
- Si una banda de VLa máx no se puede verificar en las fuentes, la lista se queda corta. Es el resultado correcto, no un fallo de la tarea.
