import { expect, test } from '@playwright/test';

declare global { interface Window { axe: { run(): Promise<{ violations: Array<{ id: string; impact: string | null }> }> } } }

for (const route of ['/', '/potencia', '/durabilidad', '/tests', '/sesiones', '/prescripcion', '/evolucion', '/informes']) {
  test(`accessibility scan ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
    const violations = await page.evaluate(async () => (await window.axe.run()).violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious'));
    expect(violations).toEqual([]);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
  });
}
