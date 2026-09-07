import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';

declare global { interface Window { axe: { run(): Promise<{ violations: Array<{ id: string; impact: string | null }> }> } } }

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

for (const route of ['/', '/potencia', '/durabilidad', '/tests', '/sesiones', '/prescripcion', '/evolucion', '/informes']) {
  test(`accessibility scan ${route}`, async ({ page }) => {
    await page.route('**/.netlify/functions/athletes**', async (request) => request.fulfill({ json: [] }));
    await page.goto(route);
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => (await window.axe.run()).violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious'));
    expect(violations).toEqual([]);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
  });
}

const populatedAthleteId = '22222222-2222-4222-8222-222222222222';

test('populated Power analysis is accessible and every control is keyboard reachable', async ({ page }) => {
  await page.addInitScript(({ athleteId }) => {
    window.localStorage.setItem('mfpp.analysis.preferences.v1', JSON.stringify({
      athleteId,
      period: { preset: 90 },
      environment: 'all',
    }));
  }, { athleteId: populatedAthleteId });
  await page.route('**/.netlify/functions/athletes**', async (route) => {
    const url = new URL(route.request().url());
    const fixture = { id: populatedAthleteId, intervalsId: 'fixture-power', name: 'Ciclista de prueba', observations: [] };
    await route.fulfill({ json: url.searchParams.has('athleteId') ? fixture : [fixture] });
  });
  await page.route('**/.netlify/functions/power-analysis**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ json: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      athleteId: populatedAthleteId,
      oldest: url.searchParams.get('oldest'),
      newest: url.searchParams.get('newest'),
      environment: 'all',
      points: [
        { seconds: 5, watts: 900 },
        { seconds: 60, watts: 520 },
        { seconds: 180, watts: 405 },
        { seconds: 300, watts: 365 },
        { seconds: 1200, watts: 310 },
      ],
      sourceModels: [],
      synchronizedAt: '2026-09-07T10:00:00.000Z',
      ftp: null,
    } });
  });

  await page.goto('/potencia');
  await expect(page.getByRole('table', { name: 'Potencia observada y modelada' })).toBeVisible();
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => (await window.axe.run()).violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious'));
  expect(violations).toEqual([]);

  const expectedControlIds = await page.locator('a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]')
    .evaluateAll((controls) => controls.filter((control) => {
      const element = control as HTMLElement;
      const radio = element instanceof HTMLInputElement && element.type === 'radio';
      return element.getClientRects().length > 0
        && getComputedStyle(element).visibility !== 'hidden'
        && (!radio || (element as HTMLInputElement).checked);
    }).map((control, index) => {
      const id = `keyboard-control-${index}`;
      control.setAttribute('data-keyboard-control', id);
      return id;
    }));
  const reached = new Set<string>();
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let step = 0; step < expectedControlIds.length + 4; step += 1) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement?.getAttribute('data-keyboard-control'));
    if (id) reached.add(id);
  }
  expect([...reached].sort()).toEqual([...expectedControlIds].sort());

  const selectedModelId = await page.getByRole('radio', { name: /Morton 3P/i })
    .getAttribute('data-keyboard-control');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let step = 0; step < expectedControlIds.length + 2; step += 1) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement?.getAttribute('data-keyboard-control'));
    if (id === selectedModelId) break;
  }
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: /^ECP/i })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /Morton 3P/i })).toBeChecked();
});
