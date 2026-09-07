import { expect, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

test('production bundle never exposes server secret variable names', async () => {
  const assets = path.resolve('dist/assets');
  const scripts = (await readdir(assets)).filter((file) => file.endsWith('.js'));
  const bundle = (await Promise.all(scripts.map((file) => readFile(path.join(assets, file), 'utf8')))).join('\n');
  expect(bundle).not.toContain('SUPABASE_SECRET_KEY');
  expect(bundle).not.toContain('INTERVALS_API_KEY');
});

test('demo data is never loaded without an explicit action', async ({ page }) => {
  await page.route('**/.netlify/functions/athletes**', async (route) => route.fulfill({ json: [] }));
  await page.goto('/potencia');
  await expect(page.getByText('Demostración sintética. No corresponde al ciclista activo.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Potencia observada y modelada' })).toHaveCount(0);
});
