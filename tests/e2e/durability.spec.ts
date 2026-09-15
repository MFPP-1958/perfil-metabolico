import { expect, test } from '@playwright/test';

const athleteId = '44444444-4444-4444-8444-444444444444';
const snapshotId = '55555555-5555-4555-8555-555555555555';

function athlete() {
  return { id: athleteId, intervalsId: 'fixture-authorized', name: 'Jaume Santamaria', observations: [] };
}

function level(afterKj: number, declinePercent: number, freshWatts: number) {
  return {
    afterKj,
    afterKjPerKg: afterKj / 70,
    fatiguedWatts: freshWatts * (1 - declinePercent / 100),
    declinePercent,
    quality: 'observed' as const,
    supportingActivityCount: 3,
    supportingEffortCount: 5,
    powerSource: 'measured' as const,
  };
}

function rows(firstDecline = 6) {
  return ([10, 60, 300, 1_200] as const).map((seconds, index) => {
    const freshWatts = [900, 520, 365, 310][index];
    return {
      seconds,
      freshWatts,
      levels: {
        kj0: level(700, index === 0 ? firstDecline : 7 + index, freshWatts),
        kj1: level(1_400, 10 + index, freshWatts),
      },
      onsetAfterKj: 700,
      onsetAfterKjPerKg: 10,
    };
  });
}

function powerSnapshot(oldest: string, newest: string, environment: string) {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    athleteId,
    oldest,
    newest,
    environment,
    points: [
      { seconds: 5, watts: 900 },
      { seconds: 60, watts: 520 },
      { seconds: 180, watts: 405 },
      { seconds: 300, watts: 365 },
      { seconds: 1_200, watts: 310 },
    ],
    sourceModels: [],
    synchronizedAt: '2026-09-15T10:00:00.000Z',
    ftp: null,
  };
}

function durabilitySnapshot(oldest: string, newest: string, environment: string) {
  return {
    id: snapshotId,
    athleteId,
    oldest,
    newest,
    environment,
    weightKg: 70,
    weightObservedAt: '2026-09-15T09:00:00.000Z',
    synchronizedAt: '2026-09-15T10:00:00.000Z',
    sourceVersion: 'intervals-openapi-v1',
    result: {
      algorithmVersion: 'durability-record-profile@2.0.0',
      rows: rows(),
      coverage: 'high',
      warnings: [],
    },
  };
}

test('one global sync feeds Power and Durability after navigation and reload', async ({ page }) => {
  let syncPosts = 0;
  let synchronizedContext: { athleteId: string; oldest: string; newest: string; environment: string } | null = null;
  const analysisContexts: Array<{ athleteId: string; oldest: string; newest: string; environment: string }> = [];
  let confirmedBody: unknown = null;

  await page.route('**/.netlify/functions/athletes**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('syncState') === 'true') {
      await route.fulfill({ json: synchronizedContext ? {
        status: 'complete',
        synchronizedAt: '2026-09-15T10:00:00.000Z',
        warnings: [],
      } : null });
      return;
    }
    await route.fulfill({ json: url.searchParams.has('athleteId') ? athlete() : [athlete()] });
  });
  await page.route('**/.netlify/functions/sync-athlete', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ status: 405 });
      return;
    }
    syncPosts += 1;
    const body = route.request().postDataJSON() as typeof synchronizedContext & { syncKey: string };
    synchronizedContext = {
      athleteId: body.athleteId,
      oldest: body.oldest,
      newest: body.newest,
      environment: body.environment,
    };
    await route.fulfill({ json: {
      status: 'complete',
      synchronizedAt: '2026-09-15T10:00:00.000Z',
      warnings: [],
    } });
  });
  await page.route('**/.netlify/functions/power-analysis**', async (route) => {
    const url = new URL(route.request().url());
    const context = {
      athleteId: url.searchParams.get('athleteId') ?? '',
      oldest: url.searchParams.get('oldest') ?? '',
      newest: url.searchParams.get('newest') ?? '',
      environment: url.searchParams.get('environment') ?? '',
    };
    analysisContexts.push(context);
    await route.fulfill({ json: powerSnapshot(context.oldest, context.newest, context.environment) });
  });
  await page.route('**/.netlify/functions/durability-analysis**', async (route) => {
    if (route.request().method() === 'POST') {
      confirmedBody = route.request().postDataJSON();
      await route.fulfill({ json: {
        id: '77777777-7777-4777-8777-777777777777',
        snapshotId,
        algorithmVersion: 'durability-record-profile@2.0.0',
        comparisons: rows(12),
        quality: { coverage: 'high', warnings: ['Resultado recalculado en el servidor.'] },
        confirmedAt: '2026-09-15T10:30:00.000Z',
      } });
      return;
    }
    const url = new URL(route.request().url());
    const context = {
      athleteId: url.searchParams.get('athleteId') ?? '',
      oldest: url.searchParams.get('oldest') ?? '',
      newest: url.searchParams.get('newest') ?? '',
      environment: url.searchParams.get('environment') ?? '',
    };
    analysisContexts.push(context);
    await route.fulfill({ json: durabilitySnapshot(context.oldest, context.newest, context.environment) });
  });

  await page.goto('/');
  await page.getByLabel('Ciclista activo').selectOption({ label: 'Jaume Santamaria' });
  await page.getByRole('button', { name: 'Sincronizar con Intervals.icu' }).click();
  await expect(page.getByText('Sincronización completada')).toBeVisible();

  await page.getByRole('link', { name: 'Potencia' }).click();
  await expect(page.getByRole('table', { name: 'Potencia observada y modelada' })).toBeVisible();
  await page.getByRole('link', { name: 'Durabilidad' }).click();
  await expect(page.getByRole('table', { name: 'Potencia fresca y tras trabajo acumulado' })).toBeVisible();
  await expect(page.getByText(/10,0 kJ\/kg/).first()).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Ciclista activo')).toHaveValue(athleteId);
  await expect(page.getByText(/Última sincronización:/)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Potencia fresca y tras trabajo acumulado' })).toBeVisible();
  await page.getByRole('link', { name: 'Potencia' }).click();
  await expect(page.getByRole('table', { name: 'Potencia observada y modelada' })).toBeVisible();
  await page.getByRole('link', { name: 'Durabilidad' }).click();

  await page.getByRole('button', { name: 'Confirmar análisis' }).click();
  await expect(page.getByText('Resultado recalculado en el servidor.')).toBeVisible();
  await expect(page.getByText('12,0 % de descenso').first()).toBeVisible();

  expect(syncPosts).toBe(1);
  expect(synchronizedContext).not.toBeNull();
  expect(analysisContexts.length).toBeGreaterThanOrEqual(4);
  expect(analysisContexts.every((context) => JSON.stringify(context) === JSON.stringify(synchronizedContext))).toBe(true);
  expect(confirmedBody).toEqual({ snapshotId });
});

test('partial Durability data remains understandable and usable from the keyboard', async ({ page }) => {
  let confirmationPosts = 0;
  await page.addInitScript(({ selectedAthleteId }) => {
    window.localStorage.setItem('mfpp.analysis.preferences.v1', JSON.stringify({
      athleteId: selectedAthleteId,
      period: { preset: 90 },
      environment: 'all',
    }));
  }, { selectedAthleteId: athleteId });
  await page.route('**/.netlify/functions/athletes**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ json: url.searchParams.get('syncState') === 'true'
      ? { status: 'partial', synchronizedAt: '2026-09-15T10:00:00.000Z', warnings: ['durability_curves'] }
      : url.searchParams.has('athleteId') ? athlete() : [athlete()] });
  });
  await page.route('**/.netlify/functions/durability-analysis**', async (route) => {
    if (route.request().method() === 'POST') {
      confirmationPosts += 1;
      await route.fulfill({ status: 500, json: { error: 'Unexpected confirmation request' } });
      return;
    }
    const url = new URL(route.request().url());
    const snapshot = durabilitySnapshot(
      url.searchParams.get('oldest') ?? '',
      url.searchParams.get('newest') ?? '',
      url.searchParams.get('environment') ?? '',
    );
    await route.fulfill({ json: {
      ...snapshot,
      weightKg: null,
      weightObservedAt: null,
      result: {
        ...snapshot.result,
        coverage: 'insufficient',
        warnings: ['No hay datos suficientes para kJ1.'],
        rows: snapshot.result.rows.map((row) => ({ ...row, levels: { kj0: row.levels.kj0 } })),
      },
    } });
  });

  await page.goto('/durabilidad');
  await expect(page.getByRole('status').filter({ hasText: 'Sincronización parcial' }).first()).toBeVisible();
  await expect(page.getByText('Peso no disponible')).toBeVisible();
  await expect(page.getByText('No hay datos suficientes para kJ1.')).toBeVisible();
  await expect(page.getByText('La cobertura es insuficiente para confirmar este análisis.')).toBeVisible();
  const confirmButton = page.getByRole('button', { name: 'Confirmar análisis' });
  await expect(confirmButton).toBeDisabled();
  await confirmButton.dispatchEvent('click');
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  expect(confirmationPosts).toBe(0);
  const scrollRegion = page.getByLabel('Tabla desplazable de Durabilidad');
  await scrollRegion.focus();
  await expect(scrollRegion).toBeFocused();
  const outline = await scrollRegion.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('ArrowRight');
});
