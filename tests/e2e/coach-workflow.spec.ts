import { expect, test } from '@playwright/test';

const firstAthleteId = '11111111-1111-4111-8111-111111111111';
const secondAthleteId = '22222222-2222-4222-8222-222222222222';

function athlete(id: string, name: string) {
  return { id, intervalsId: `fixture-${id.slice(0, 8)}`, name, observations: [] };
}

function powerSnapshot(athleteId: string, oldest: string, newest: string, firstWatts: number) {
  return {
    id: athleteId === firstAthleteId
      ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    athleteId,
    oldest,
    newest,
    environment: 'all',
    points: [
      { seconds: 5, watts: firstWatts },
      { seconds: 60, watts: 520 },
      { seconds: 180, watts: 405 },
      { seconds: 300, watts: 365 },
      { seconds: 1200, watts: 310 },
    ],
    sourceModels: [],
    synchronizedAt: '2026-09-07T10:00:00.000Z',
    ftp: null,
  };
}

test('coach reviews real athlete data and opens unfinished module demos explicitly', async ({ page }) => {
  await page.route('**/.netlify/functions/athletes**', async (route) => {
    const url = new URL(route.request().url());
    const fixture = athlete(firstAthleteId, 'Ciclista Uno');
    await route.fulfill({ json: url.searchParams.has('athleteId') ? fixture : [fixture] });
  });
  await page.route('**/.netlify/functions/observations', async (route) => {
    await route.fulfill({ json: route.request().postDataJSON() });
  });
  await page.goto('/');
  await expect(page.getByText('entrenador@prueba.local')).toBeVisible();
  await page.getByLabel('Ciclista activo').selectOption(firstAthleteId);
  await expect(page.getByRole('heading', { name: 'Ciclista Uno' })).toBeVisible();
  await page.getByLabel('Valor').fill('285');
  await page.getByRole('button', { name: 'Añadir observación' }).click();
  await expect(page.getByText('285 W')).toBeVisible();

  await page.getByRole('link', { name: 'Tests' }).click();
  await page.getByRole('button', { name: 'Abrir demostración' }).click();
  await expect(page.getByRole('heading', { name: 'VLa máx estimada' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mader experimental' })).toBeVisible();

  await page.getByRole('link', { name: 'Sesiones' }).click();
  await page.getByRole('button', { name: 'Abrir demostración' }).click();
  await expect(page.getByRole('table', { name: 'Bloques prescritos y realizados' })).toBeVisible();

  await page.getByRole('link', { name: 'Prescripción' }).click();
  await page.getByRole('button', { name: 'Abrir demostración' }).click();
  await expect(page.getByText('Borrador pendiente de revisión')).toBeVisible();
  await page.getByRole('button', { name: 'Aprobar prescripción' }).click();
  await expect(page.getByText(/Aprobada por entrenador-demo/)).toBeVisible();

  await page.getByRole('link', { name: 'Informes' }).click();
  await page.getByRole('button', { name: 'Abrir demostración' }).click();
  await expect(page.getByRole('heading', { name: 'Informe para el entrenador' })).toBeVisible();
});

test('coach explicitly imports a selected Intervals cyclist', async ({ page }) => {
  await page.route('**/.netlify/functions/athletes', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/.netlify/functions/intervals-connection', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { athletes: [{ id: 'i123', name: 'Ana Ciclista' }] } });
      return;
    }
    await route.fulfill({ json: { added: 1, existing: 0, failed: [] } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Conectar Intervals.icu' }).click();
  await page.getByRole('checkbox', { name: 'Ana Ciclista' }).check();
  await page.getByRole('button', { name: 'Incorporar 1 ciclista' }).click();
  await expect(page.getByText('1 ciclista incorporado')).toBeVisible();
});

test('latest cyclist remains authoritative when delayed power requests resolve in reverse order', async ({ page }) => {
  let releaseFirstSnapshot!: () => void;
  const firstSnapshotCanResolve = new Promise<void>((resolve) => { releaseFirstSnapshot = resolve; });
  let firstSnapshotRequested!: () => void;
  const firstSnapshotWasRequested = new Promise<void>((resolve) => { firstSnapshotRequested = resolve; });

  await page.route('**/.netlify/functions/athletes**', async (route) => {
    const url = new URL(route.request().url());
    const athleteId = url.searchParams.get('athleteId');
    if (!athleteId) {
      await route.fulfill({ json: [
        athlete(firstAthleteId, 'Ciclista Uno'),
        athlete(secondAthleteId, 'Ciclista Dos'),
      ] });
      return;
    }
    await route.fulfill({ json: athlete(
      athleteId,
      athleteId === firstAthleteId ? 'Ciclista Uno' : 'Ciclista Dos',
    ) });
  });

  await page.route('**/.netlify/functions/power-analysis**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { snapshotId: string; model: 'ECP' | 'MORTON_3P' };
      await route.fulfill({ json: {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        snapshotId: body.snapshotId,
        model: body.model,
        algorithmVersion: body.model === 'ECP' ? 'pd-ecp@1.0.0' : 'pd-morton-3p@1.0.0',
        cpWatts: 300,
        wPrimeJoules: 20_000,
        pmaxWatts: body.model === 'ECP' ? null : 1_100,
        rmseWatts: 8,
        quality: { complete: true, warnings: [] },
        confirmedAt: '2026-09-07T10:30:00.000Z',
      } });
      return;
    }

    const url = new URL(request.url());
    const athleteId = url.searchParams.get('athleteId') ?? '';
    const oldest = url.searchParams.get('oldest') ?? '';
    const newest = url.searchParams.get('newest') ?? '';
    if (athleteId === firstAthleteId) {
      firstSnapshotRequested();
      await firstSnapshotCanResolve;
      try {
        await route.fulfill({ json: powerSnapshot(firstAthleteId, oldest, newest, 999) });
      } catch {
        // The browser is expected to abort this stale request after changing cyclist.
      }
      return;
    }
    await route.fulfill({ json: powerSnapshot(secondAthleteId, oldest, newest, 777) });
    releaseFirstSnapshot();
  });

  await page.goto('/');
  await page.getByLabel('Ciclista activo').selectOption(firstAthleteId);
  await page.getByRole('link', { name: 'Potencia' }).click();
  await firstSnapshotWasRequested;
  await page.getByLabel('Periodo').selectOption('180');
  await page.getByLabel('Ciclista activo').selectOption(secondAthleteId);

  await expect(page.getByText('Mejor 5 s')).toBeVisible();
  await expect(page.getByText('777 W').first()).toBeVisible();
  await expect(page.getByText('999 W')).toHaveCount(0);
  await expect(page.getByLabel('Periodo')).toHaveValue('180');

  await page.getByRole('radio', { name: /^ECP/i }).check();
  await page.getByRole('button', { name: 'Confirmar análisis' }).click();
  await expect(page.getByText(/análisis confirmado de forma inmutable/i)).toBeVisible();
  await expect(page.getByText('999 W')).toHaveCount(0);
});
