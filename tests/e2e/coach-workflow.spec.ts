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
    await route.fulfill({ json: url.searchParams.get('syncState') === 'true'
      ? null
      : url.searchParams.has('athleteId') ? fixture : [fixture] });
  });
  await page.route('**/.netlify/functions/observations', async (route) => {
    await route.fulfill({ json: route.request().postDataJSON() });
  });
  await page.route('**/.netlify/functions/durability-analysis**', async (route) => {
    await route.fulfill({ status: 404, json: { error: 'missing_snapshot' } });
  });
  await page.route('**/.netlify/functions/sessions**', async (route) => {
    const url = new URL(route.request().url());
    const activityId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const interval = (index: number, type: string, movingSeconds: number, averageWatts: number) => ({
      index, type, startSeconds: index * 300, movingSeconds, averageWatts, averageHeartRate: 160, averageCadence: 90,
    });
    await route.fulfill({ json: url.searchParams.has('activityId')
      ? { activityId, powerZones: null, intervals: [
        interval(0, 'RECOVERY', 900, 150), interval(1, 'WORK', 300, 290), interval(2, 'WORK', 295, 285), interval(3, 'WORK', 305, 280),
      ] }
      : { activities: [{
        id: activityId, startedAt: '2026-09-06T08:00:00+00:00', name: "Pista - FTP (15')- 1 x ( 3 x 5' @ 100 % FTP R-3' @ 60 % )",
        durationSeconds: 4200, averagePowerWatts: 210, indoor: false,
      }] } });
  });
  await page.goto('/');
  await expect(page.getByText('entrenador@prueba.local')).toBeVisible();
  await page.getByLabel('Ciclista activo').selectOption(firstAthleteId);
  await expect(page.getByRole('heading', { name: 'Ciclista Uno' })).toBeVisible();
  await page.getByLabel('Valor').fill('285');
  await page.getByRole('button', { name: 'Añadir observación' }).click();
  await expect(page.getByText('285 W')).toBeVisible();

  // La única observación de Ciclista Uno es el FTP añadido arriba, ninguna
  // de las cuatro métricas que pide el modelo de Mader: la ruta de Tests ya
  // no ofrece demostración (Task 6 la retiró de aquí) sino que dice qué
  // métricas faltan y qué protocolo produce cada una.
  await page.getByRole('link', { name: 'Tests' }).click();
  const perfilIncompleto = page.getByRole('alert').filter({ hasText: 'Perfil incompleto' });
  await expect(perfilIncompleto).toContainText('VO₂max');
  await expect(perfilIncompleto).toContainText('Prueba de laboratorio en rampa, o valor de laboratorio externo con su fecha.');
  await expect(perfilIncompleto).toContainText('VLa máx');
  await expect(perfilIncompleto).toContainText('Test de esprint con lactato, o valor calculado en WKO5 con origen external_model.');
  await expect(perfilIncompleto).toContainText('Masa corporal');
  await expect(perfilIncompleto).toContainText('Pesada fechada, registro manual o importación de Intervals.icu.');
  await expect(perfilIncompleto).toContainText('P@VO₂max');
  await expect(perfilIncompleto).toContainText('Potencia asociada al VO₂max, de la misma prueba que lo determinó.');

  await page.getByRole('link', { name: 'Durabilidad' }).click();
  await expect(page.getByRole('heading', { name: 'No hay datos de Durabilidad' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir demostración sintética' }).click();
  await expect(page.getByRole('status')).toHaveText(/Demostración sintética/);

  await page.getByRole('link', { name: 'Sesiones' }).click();
  await page.getByRole('button', { name: /FTP \(15'\)/ }).click();
  const resultado = page.getByRole('region', { name: 'Resultado' });
  await expect(resultado).toContainText('3 de 3');
  await expect(page.getByRole('checkbox', { name: 'Intervalo 1 cuenta como serie' })).not.toBeChecked();

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
  let firstSnapshotRequestCount = 0;
  let firstSnapshotSettledCount = 0;
  let releaseStarted = false;
  let twoFirstSnapshotsRequested!: () => void;
  const twoFirstSnapshotRequests = new Promise<void>((resolve) => { twoFirstSnapshotsRequested = resolve; });
  let allFirstSnapshotsSettled!: () => void;
  const allFirstSnapshotHandlersSettled = new Promise<void>((resolve) => { allFirstSnapshotsSettled = resolve; });
  let confirmedRequest: { snapshotId: string; model: 'ECP' | 'MORTON_3P' } | null = null;

  await page.route('**/.netlify/functions/athletes**', async (route) => {
    const url = new URL(route.request().url());
    const athleteId = url.searchParams.get('athleteId');
    if (url.searchParams.get('syncState') === 'true') {
      await route.fulfill({ json: null });
      return;
    }
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
      confirmedRequest = body;
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
      firstSnapshotRequestCount += 1;
      if (firstSnapshotRequestCount === 2) twoFirstSnapshotsRequested();
      await firstSnapshotCanResolve;
      try {
        await route.fulfill({ json: powerSnapshot(firstAthleteId, oldest, newest, 999) });
      } catch {
        // The browser is expected to abort this stale request after changing cyclist.
      } finally {
        firstSnapshotSettledCount += 1;
        if (releaseStarted && firstSnapshotSettledCount === firstSnapshotRequestCount) {
          allFirstSnapshotsSettled();
        }
      }
      return;
    }
    await route.fulfill({ json: powerSnapshot(secondAthleteId, oldest, newest, 777) });
    releaseStarted = true;
    releaseFirstSnapshot();
  });

  await page.goto('/');
  await page.getByLabel('Ciclista activo').selectOption(firstAthleteId);
  await page.getByRole('link', { name: 'Potencia' }).click();
  await page.getByLabel('Periodo').selectOption('180');
  await twoFirstSnapshotRequests;
  await page.getByLabel('Ciclista activo').selectOption(secondAthleteId);

  await expect(page.getByText('Mejor 5 s')).toBeVisible();
  await expect(page.getByText('777 W').first()).toBeVisible();
  await expect(page.getByText('999 W')).toHaveCount(0);
  await expect(page.getByLabel('Periodo')).toHaveValue('180');

  await page.getByRole('radio', { name: /^ECP/i }).check();
  await page.getByRole('button', { name: 'Confirmar análisis' }).click();
  await expect(page.getByText(/análisis confirmado de forma inmutable/i)).toBeVisible();
  await allFirstSnapshotHandlersSettled;
  expect(confirmedRequest).toMatchObject({
    snapshotId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    model: 'ECP',
  });
  await expect(page.getByText('999 W')).toHaveCount(0);
});
