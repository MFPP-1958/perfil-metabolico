import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';

declare global { interface Window { axe: { run(): Promise<{ violations: Array<{ id: string; impact: string | null }> }> } } }

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

for (const route of ['/', '/potencia', '/durabilidad', '/tests', '/sesiones']) {
  test(`accessibility scan ${route}`, async ({ page }) => {
    await page.route('**/.netlify/functions/athletes**', async (request) => request.fulfill({ json: [] }));
    await page.goto(route);
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => (await window.axe.run()).violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious'));
    expect(violations).toEqual([]);
    const undersizedTargets = await page.locator('a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]')
      .evaluateAll((elements) => elements.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || getComputedStyle(element).visibility === 'hidden') return [];
        return rect.width < 44 || rect.height < 44
          ? [{ tag: element.tagName, label: element.getAttribute('aria-label') ?? element.textContent?.trim(), width: rect.width, height: rect.height }]
          : [];
      }));
    expect(undersizedTargets).toEqual([]);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
  });
}

const populatedAthleteId = '22222222-2222-4222-8222-222222222222';

function durabilityRows() {
  return ([10, 60, 300, 1_200] as const).map((seconds, index) => {
    const freshWatts = [900, 520, 365, 310][index];
    const level = (afterKj: number, declinePercent: number) => ({
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
      levels: { kj0: level(700, 6 + index), kj1: level(1_400, 10 + index) },
      onsetAfterKj: 700,
      onsetAfterKjPerKg: 10,
    };
  });
}

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
    await route.fulfill({ json: url.searchParams.get('syncState') === 'true'
      ? null
      : url.searchParams.has('athleteId') ? fixture : [fixture] });
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

test('populated Durability meets axe, keyboard, focus, semantics and 44px targets', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(({ athleteId }) => {
    window.localStorage.setItem('mfpp.analysis.preferences.v1', JSON.stringify({
      athleteId,
      period: { preset: 90 },
      environment: 'all',
    }));
  }, { athleteId: populatedAthleteId });
  await page.route('**/.netlify/functions/athletes**', async (route) => {
    const url = new URL(route.request().url());
    const fixture = { id: populatedAthleteId, intervalsId: 'fixture-durability', name: 'Ciclista de prueba', observations: [] };
    await route.fulfill({ json: url.searchParams.get('syncState') === 'true'
      ? { status: 'partial', synchronizedAt: '2026-09-15T10:00:00.000Z', warnings: ['durability_curves'] }
      : url.searchParams.has('athleteId') ? fixture : [fixture] });
  });
  await page.route('**/.netlify/functions/durability-analysis**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ json: {
      id: '88888888-8888-4888-8888-888888888888',
      athleteId: populatedAthleteId,
      oldest: url.searchParams.get('oldest'),
      newest: url.searchParams.get('newest'),
      environment: 'all',
      weightKg: 70,
      weightObservedAt: '2026-09-15T09:00:00.000Z',
      synchronizedAt: '2026-09-15T10:00:00.000Z',
      sourceVersion: 'intervals-openapi-v1',
      result: {
        algorithmVersion: 'durability-record-profile@2.0.0',
        rows: durabilityRows(),
        coverage: 'moderate',
        warnings: ['Cobertura parcial para kJ1.'],
      },
    } });
  });

  await page.goto('/durabilidad');
  await expect(page.getByRole('table', { name: 'Potencia fresca y tras trabajo acumulado' })).toBeVisible();
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => (await window.axe.run()).violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious'));
  expect(violations).toEqual([]);

  const targets = page.locator('a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]');
  const undersized = await targets.evaluateAll((elements) => elements.flatMap((element) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || getComputedStyle(element).visibility === 'hidden') return [];
    return rect.width < 44 || rect.height < 44
      ? [{ tag: element.tagName, name: element.getAttribute('aria-label') ?? element.textContent?.trim(), width: rect.width, height: rect.height }]
      : [];
  }));
  expect(undersized).toEqual([]);

  const focusable = page.getByLabel('Tabla desplazable de Durabilidad');
  await focusable.focus();
  await expect(focusable).toBeFocused();
  const focusStyle = await focusable.evaluate((element) => {
    const style = getComputedStyle(element);
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
      const [red = 0, green = 0, blue = 0] = channels.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const outline = luminance(style.outlineColor);
    const background = luminance(style.backgroundColor);
    return {
      style: style.outlineStyle,
      width: style.outlineWidth,
      contrast: (Math.max(outline, background) + 0.05) / (Math.min(outline, background) + 0.05),
    };
  });
  expect(focusStyle.style).not.toBe('none');
  expect(Number.parseFloat(focusStyle.width)).toBeGreaterThanOrEqual(3);
  expect(focusStyle.contrast).toBeGreaterThanOrEqual(3);

  const ids = await targets.evaluateAll((elements) => elements.flatMap((element, index) => {
    if (!(element as HTMLElement).offsetParent) return [];
    const id = `durability-keyboard-${index}`;
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
  await expect(page.getByRole('status').filter({ hasText: 'Sincronización parcial' }).first()).toBeVisible();
  await expect(page.getByRole('img', { name: /10 s: fresca 900 W/i })).toBeVisible();
});
