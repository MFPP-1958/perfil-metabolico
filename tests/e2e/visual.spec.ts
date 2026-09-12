import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const responsiveAthleteId = '33333333-3333-4333-8333-333333333333';

for (const viewport of [{ name: 'mobile', width: 390, height: 844 }, { name: 'tablet', width: 820, height: 1180 }, { name: 'desktop-zoom-200', width: 640, height: 900 }]) {
  test(`populated Power has a usable ${viewport.name} layout`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(({ athleteId }) => {
      window.localStorage.setItem('mfpp.analysis.preferences.v1', JSON.stringify({
        athleteId,
        period: { preset: 90 },
        environment: 'all',
      }));
    }, { athleteId: responsiveAthleteId });
    await page.route('**/.netlify/functions/athletes**', async (route) => {
      const url = new URL(route.request().url());
      const fixture = { id: responsiveAthleteId, intervalsId: 'fixture-responsive', name: 'Ciclista de prueba', observations: [] };
      await route.fulfill({ json: url.searchParams.get('syncState') === 'true'
        ? null
        : url.searchParams.has('athleteId') ? fixture : [fixture] });
    });
    await page.route('**/.netlify/functions/power-analysis**', async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill({ json: {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        athleteId: responsiveAthleteId,
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
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Potencia observada y modelada' })).toBeVisible();
    expect((await page.locator('body').evaluate((body) => body.scrollWidth)) <= (await page.locator('body').evaluate((body) => body.clientWidth)) + 2).toBe(true);
    const confirm = page.getByRole('button', { name: 'Confirmar análisis' });
    await confirm.scrollIntoViewIfNeeded();
    const box = await confirm.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  });
}

test('A4 report has one unclipped page', async ({ page }) => {
  await page.route('**/.netlify/functions/athletes**', async (route) => route.fulfill({ json: [] }));
  await page.goto('/informes');
  await page.getByRole('button', { name: 'Abrir demostración' }).click();
  await page.emulateMedia({ media: 'print' });
  const output = path.resolve('test-results/artifacts');
  await mkdir(output, { recursive: true });
  await page.pdf({ path: path.join(output, 'informe-demostracion-a4.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
  await expect(page.getByRole('table', { name: 'Resultados incluidos en el informe' })).toBeVisible();
});
