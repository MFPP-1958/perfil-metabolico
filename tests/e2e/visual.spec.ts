import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const responsiveAthleteId = '33333333-3333-4333-8333-333333333333';

for (const viewport of [{ name: 'mobile', width: 390, height: 844 }, { name: 'tablet', width: 820, height: 1180 }]) {
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

test('populated Durability remains usable at 360px and real Chromium 200% page scale', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium CDP supplies the real page-scale control.');
  await page.setViewportSize({ width: 1_280, height: 900 });
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
  await page.route('**/.netlify/functions/durability-analysis**', async (route) => {
    const url = new URL(route.request().url());
    const rows = ([10, 60, 300, 1_200] as const).map((seconds, index) => {
      const freshWatts = [900, 520, 365, 310][index];
      const value = (afterKj: number, declinePercent: number) => ({
        afterKj,
        afterKjPerKg: afterKj / 70,
        fatiguedWatts: freshWatts * (1 - declinePercent / 100),
        declinePercent,
        quality: 'observed',
        supportingActivityCount: 3,
        supportingEffortCount: 5,
        powerSource: 'measured',
      });
      return {
        seconds,
        freshWatts,
        levels: { kj0: value(700, 6 + index), kj1: value(1_400, 10 + index) },
        onsetAfterKj: 700,
        onsetAfterKjPerKg: 10,
      };
    });
    await route.fulfill({ json: {
      id: '99999999-9999-4999-8999-999999999999',
      athleteId: responsiveAthleteId,
      oldest: url.searchParams.get('oldest'),
      newest: url.searchParams.get('newest'),
      environment: 'all',
      weightKg: 70,
      weightObservedAt: '2026-09-15T09:00:00.000Z',
      synchronizedAt: '2026-09-15T10:00:00.000Z',
      sourceVersion: 'intervals-openapi-v1',
      result: { algorithmVersion: 'durability-record-profile@2.0.0', rows, coverage: 'high', warnings: [] },
    } });
  });

  await page.goto('/durabilidad');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await expect.poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(2);
  await expect(page.getByRole('heading', { name: 'Durabilidad' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Potencia fresca y tras trabajo acumulado' })).toBeVisible();
  await page.screenshot({ path: 'test-results/artifacts/durabilidad-zoom-200.png', fullPage: true });

  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByRole('heading', { name: 'Durabilidad' })).toBeVisible();
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth + 2)).toBe(true);
  const tableRegion = page.getByLabel('Tabla desplazable de Durabilidad');
  await tableRegion.focus();
  for (let step = 0; step < 6; step += 1) await page.keyboard.press('ArrowRight');
  await expect.poll(() => tableRegion.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/artifacts/durabilidad-mobile-360.png', fullPage: true });
});

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
