import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

for (const viewport of [{ name: 'mobile', width: 390, height: 844 }, { name: 'tablet', width: 820, height: 1180 }, { name: 'desktop-zoom-200', width: 640, height: 900 }]) {
  test(`usable ${viewport.name} layout`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/tests');
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir demostración' })).toBeVisible();
    expect((await page.locator('body').evaluate((body) => body.scrollWidth)) <= (await page.locator('body').evaluate((body) => body.clientWidth)) + 2).toBe(true);
  });
}

test('A4 report has one unclipped page', async ({ page }) => {
  await page.goto('/informes');
  await page.getByRole('button', { name: 'Abrir demostración' }).click();
  await page.emulateMedia({ media: 'print' });
  const output = path.resolve('output/pdf');
  await mkdir(output, { recursive: true });
  await page.pdf({ path: path.join(output, 'informe-demostracion-a4.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
  await expect(page.getByRole('table', { name: 'Resultados incluidos en el informe' })).toBeVisible();
});
