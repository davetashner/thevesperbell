import { expect, test } from '@playwright/test';
import { SCENES, collectProblems, distinctColours } from './helpers/scenes';

// mw-e00.21: every scene loads and renders with zero console errors. Split in two halves (every other
// scene, by sorted id) so the shard balancer can spread them; scenes.spec.ts has the rest.

for (const scene of SCENES.filter((_, index) => index % 2 === 1)) {
  test(`scene "${scene}" loads and renders with zero console errors`, async ({ page }) => {
    const problems = collectProblems(page);
    await page.goto(`/?scene=${scene}`);
    await expect(page.locator('#app')).toHaveAttribute('data-scene', scene, { timeout: 30_000 });
    await expect(page.getByTestId('scene-label')).toContainText(`(${scene}) · build `);
    await expect(page.getByTestId('scene-error')).toHaveCount(0);
    expect(await distinctColours(page, scene)).toBeGreaterThan(8);
    expect(problems).toEqual([]);
  });
}
