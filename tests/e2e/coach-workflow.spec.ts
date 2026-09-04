import { expect, test } from '@playwright/test';

test('coach reviews analysis, prescription and report demos explicitly', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('entrenador@prueba.local')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir demostración' }).click();
  await expect(page.getByText('Ciclista de demostración')).toBeVisible();
  await page.getByLabel('Valor').fill('285');
  await page.getByRole('button', { name: 'Añadir observación' }).click();
  await expect(page.getByText('285 W')).toBeVisible();

  await page.getByRole('link', { name: 'Potencia' }).click();
  await page.getByRole('button', { name: 'Abrir demostración' }).click();
  await expect(page.getByRole('table', { name: 'Potencia observada y modelada' })).toBeVisible();

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
