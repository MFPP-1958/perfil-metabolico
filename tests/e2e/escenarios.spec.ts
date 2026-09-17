import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import type { MaderInputs } from '../../src/physiology/mader/model';
import { MADER_MODEL_VERSION } from '../../src/physiology/mader/references';
import { buildMetabolicScenario, type EventProfile } from '../../src/physiology/scenarios/scenario';
import { SCENARIO_MODEL_VERSION } from '../../src/physiology/scenarios/references';

declare global { interface Window { axe: { run(): Promise<{ violations: Array<{ id: string; impact: string | null }> }> } } }

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

const athleteId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const createdBy = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function athlete() {
  return {
    id: athleteId,
    intervalsId: 'fixture-scenarios',
    name: 'Jaume Santamaria',
    observations: [
      { id: '11111111-1111-4111-8111-111111111111', athleteId, metricCode: 'vo2max', value: 68, unit: 'ml·kg⁻¹·min⁻¹', observedAt: '2026-09-01T08:00:00.000Z', origin: 'laboratory', quality: 'measured', protocol: { name: 'rampa', version: '1' } },
      { id: '22222222-2222-4222-8222-222222222222', athleteId, metricCode: 'vlamax', value: 0.4, unit: 'mmol·l⁻¹·s⁻¹', observedAt: '2026-09-01T08:00:00.000Z', origin: 'external_model', quality: 'calculated', protocol: { name: 'wko5', version: '1' }, sourceReference: { software: 'WKO5' } },
      { id: '33333333-3333-4333-8333-333333333333', athleteId, metricCode: 'body_mass', value: 70, unit: 'kg', observedAt: '2026-09-01T08:00:00.000Z', origin: 'manual', quality: 'measured', protocol: { name: 'pesada', version: '1' } },
      { id: '44444444-4444-4444-8444-444444444444', athleteId, metricCode: 'p_vo2max', value: 400, unit: 'W', observedAt: '2026-09-01T08:00:00.000Z', origin: 'field_test', quality: 'measured', protocol: { name: 'rampa', version: '1' } },
    ],
  };
}

interface SaveRequestBody {
  athleteId: string;
  scenarioName: string;
  rationale: string;
  eventProfile: EventProfile;
  realInputs: MaderInputs;
  targets: { vlamax: number; vo2max?: number };
  referencePowerWatts: number;
  config: { restingVo2: number };
}

/**
 * Recompone en el servidor de pruebas exactamente lo que hace el endpoint
 * real: recalcula el resultado a partir de las entradas enviadas en vez de
 * confiar en lo que calculó el navegador. Así la prueba también comprueba
 * que el cuerpo enviado es suficiente para reproducir el escenario.
 */
function scenarioFromRequest(body: SaveRequestBody, id: string, createdAt: string) {
  const outcome = buildMetabolicScenario(
    body.realInputs,
    { restingVo2: body.config.restingVo2, referencePowerWatts: body.referencePowerWatts },
    body.targets,
  );
  return {
    id,
    athleteId: body.athleteId,
    createdBy,
    scenarioName: body.scenarioName,
    rationale: body.rationale,
    eventProfile: body.eventProfile,
    realInputs: body.realInputs,
    targets: body.targets,
    referencePowerWatts: body.referencePowerWatts,
    config: body.config,
    modelVersions: { mader: MADER_MODEL_VERSION, scenario: SCENARIO_MODEL_VERSION },
    outcome,
    contentHash: `e2e-hash-${id}`,
    createdAt,
  };
}

function routeAthletes(page: Page) {
  return page.route('**/.netlify/functions/athletes**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('syncState') === 'true') {
      await route.fulfill({ json: null });
      return;
    }
    await route.fulfill({ json: url.searchParams.has('athleteId') ? athlete() : [athlete()] });
  });
}

test('saving a metabolic scenario survives reload of the Tests route', async ({ page }) => {
  let savedScenarios: unknown[] = [];
  let saveCount = 0;

  await routeAthletes(page);
  await page.route('**/.netlify/functions/metabolic-scenarios**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: savedScenarios });
      return;
    }
    saveCount += 1;
    const body = route.request().postDataJSON() as SaveRequestBody;
    const saved = scenarioFromRequest(body, `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${saveCount}`, '2026-09-17T10:00:00.000Z');
    savedScenarios = [saved, ...savedScenarios];
    await route.fulfill({ json: saved });
  });

  await page.goto('/');
  await page.getByLabel('Ciclista activo').selectOption({ label: 'Jaume Santamaria' });
  await page.getByRole('link', { name: 'Tests' }).click();
  await expect(page.getByRole('heading', { name: 'Jaume Santamaria' })).toBeVisible();

  // No debe ofrecerse una demostración sintética en una ruta que ya tiene datos reales del ciclista.
  await expect(page.getByRole('button', { name: /demostración/i })).toHaveCount(0);

  await page.getByLabel(/VLa máx objetivo/i).fill('0.9');
  await expect(page.getByRole('img', { name: /perfil actual.*perfil objetivo/is })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Comparación de perfiles' })).toBeVisible();

  const guardar = page.getByRole('button', { name: 'Guardar escenario' });
  await expect(guardar).toBeDisabled();
  await page.getByLabel(/Nombre del escenario/i).fill('Techo glucolítico para el esprint');
  await page.getByLabel(/Justificaci/i).fill('Sube la VLa máx para preparar el esprint final del campeonato.');
  await expect(guardar).toBeEnabled();
  await guardar.click();

  const lista = page.getByRole('list', { name: /escenarios guardados/i });
  await expect(lista).toContainText('Techo glucolítico para el esprint');
  expect(saveCount).toBe(1);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Jaume Santamaria' })).toBeVisible();
  await expect(page.getByRole('list', { name: /escenarios guardados/i })).toContainText('Techo glucolítico para el esprint');
});

test('the Tests route with a proposed and saved scenario meets axe, keyboard, 360px and 200% scale checks', async ({ page, browserName }) => {
  const preSaved = scenarioFromRequest({
    athleteId,
    scenarioName: 'Techo glucolítico previo',
    rationale: 'Guardado en una sesión anterior.',
    eventProfile: 'rodador',
    realInputs: {
      vo2max: { value: 68, unit: 'ml·kg⁻¹·min⁻¹', quality: 'measured', observationId: 'o-vo2' },
      vlamax: { value: 0.4, unit: 'mmol·l⁻¹·s⁻¹', quality: 'calculated', observationId: 'o-vla', sourceReference: { software: 'WKO5' } },
      bodyMass: { value: 70, unit: 'kg', quality: 'measured', observationId: 'o-masa' },
      pVo2max: { value: 400, unit: 'W', quality: 'measured', observationId: 'o-pvo2' },
    },
    targets: { vlamax: 0.7 },
    referencePowerWatts: 250,
    config: { restingVo2: 5 },
  }, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '2026-09-10T10:00:00.000Z');
  let savedScenarios: unknown[] = [preSaved];

  await page.setViewportSize({ width: 1_280, height: 900 });
  await routeAthletes(page);
  await page.route('**/.netlify/functions/metabolic-scenarios**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: savedScenarios });
      return;
    }
    const body = route.request().postDataJSON() as SaveRequestBody;
    const saved = scenarioFromRequest(body, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '2026-09-17T11:00:00.000Z');
    savedScenarios = [saved, ...savedScenarios];
    await route.fulfill({ json: saved });
  });

  await page.goto('/');
  await page.getByLabel('Ciclista activo').selectOption({ label: 'Jaume Santamaria' });
  await page.getByRole('link', { name: 'Tests' }).click();
  await expect(page.getByRole('list', { name: /escenarios guardados/i })).toContainText('Techo glucolítico previo');
  await page.getByLabel(/VLa máx objetivo/i).fill('0.9');
  await expect(page.getByRole('table', { name: 'Comparación de perfiles' })).toBeVisible();

  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => (await window.axe.run()).violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious'));
  expect(violations).toEqual([]);

  const controls = page.locator('a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
  const ids = await controls.evaluateAll((elements) => elements.flatMap((element, index) => {
    if (!(element as HTMLElement).offsetParent) return [];
    const id = `escenarios-keyboard-${index}`;
    element.setAttribute('data-keyboard-control', id);
    return [id];
  }));
  const reached = new Set<string>();
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let step = 0; step < ids.length + 4; step += 1) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement?.getAttribute('data-keyboard-control'));
    if (id) reached.add(id);
  }
  expect([...reached].sort()).toEqual([...ids].sort());

  await page.setViewportSize({ width: 360, height: 900 });
  await expect(page.getByRole('heading', { name: 'Jaume Santamaria' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const scroller = document.scrollingElement ?? document.documentElement;
    return scroller.scrollWidth <= scroller.clientWidth + 2;
  })).toBe(true);

  test.skip(browserName !== 'chromium', 'Chromium CDP supplies the real page-scale control.');
  await page.setViewportSize({ width: 1_280, height: 900 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await expect.poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(2);
  await expect(page.getByRole('heading', { name: 'Jaume Santamaria' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const scroller = document.scrollingElement ?? document.documentElement;
    return scroller.scrollWidth <= scroller.clientWidth + 2;
  })).toBe(true);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
});
