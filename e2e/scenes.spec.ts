import { expect, test } from '@playwright/test';
import {
  SCENES,
  cameraData,
  canonical,
  collectProblems,
  distinctColours,
  nextFrames,
} from './helpers/scenes';

// mw-e00.21: greybox scenes, the ?scene= picker and the debug fly camera, against the production
// build (Chromium). The per-scene load tests are in scenes-load-a/b.spec.ts.

test('AC-1: ?scene=testbed renders the room → corridor → arena with zero console errors', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-first-frame-ms', /^\d+$/, { timeout: 30_000 });
  await expect(page.getByTestId('scene-label')).toHaveText(
    /^Greybox testbed \(testbed\) · build ([0-9a-f]{7}|unknown)$/,
  );
  expect(await distinctColours(page, 'testbed')).toBeGreaterThan(16);
  expect(problems).toEqual([]);
});

test('mw-e03.35 AC-4: ?scene=testbed registers its static colliders in the Rapier world with zero console errors', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-physics', 'ready');
  const colliders = Number(await app.getAttribute('data-colliders'));
  expect(colliders).toBeGreaterThan(0);
  await nextFrames(page);
  expect(problems).toEqual([]);
});

test('mw-e03.39 AC-6: the testbed spawns its movable props as physics objects with zero console errors', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 30_000 });
  // The loose crate, the arena plank, the bottle, clay pot and barrel (mw-e02.38), and the healing
  // draught (mw-e17.7) and closet key (mw-e17.5) lying on the floor.
  await expect(app).toHaveAttribute('data-physics-objects', '7');
  await nextFrames(page);
  await expect(app).not.toHaveAttribute('data-physics-budget', /.*/);
  expect(problems).toEqual([]);
});

test('no ?scene= boots the start scene (game.startScene: the slice) behind the title (mw-e01.2)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-scene', 'slice', { timeout: 30_000 });
  await expect(page.locator('[data-screen="title"]')).toBeVisible();
});

test('?scene=testbed still boots the testbed, with no title', async ({ page }) => {
  await page.goto('/?scene=testbed');
  await expect(page.locator('#app')).toHaveAttribute('data-scene', 'testbed', { timeout: 30_000 });
  await expect(page.locator('[data-screen]')).toHaveCount(0);
});

test('AC-4: ?scene=does-not-exist shows an error listing the available scenes and keeps running', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?scene=does-not-exist');
  const error = page.getByTestId('scene-error');
  await expect(error).toBeVisible();
  await expect(error.getByRole('heading')).toHaveText('No scene called "does-not-exist"');
  await expect(error.getByRole('link')).toHaveText(SCENES);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene-error', 'does-not-exist');
  await expect(app).toHaveAttribute('data-first-frame-ms', /^\d+$/);
  await expect(page.getByTestId('game-canvas')).toBeVisible();
  // Still alive: the loop keeps drawing, and the links pick a real scene.
  await nextFrames(page);
  await error.getByRole('link', { name: 'testbed' }).click();
  await expect(app).toHaveAttribute('data-scene', 'testbed');
  expect(problems).toEqual([]);
});

test('AC-5: with the debug camera on, WASD and mouse input move it; toggling off restores the prior camera', async ({
  page,
}) => {
  // On CI's software-GL runners beside heavy slice specs this one has timed out at 30 s with the fly
  // camera never switched on (it passes in under 10 s locally); give it 90 s there.
  test.slow(!!process.env['CI'], 'software-GL runners are slow');
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed');
  await nextFrames(page);
  const prior = await cameraData(page);

  await page.keyboard.press('F2');
  await expect(app).toHaveAttribute('data-debug-camera', 'on');
  await expect(page.getByTestId('debug-camera-hint')).toContainText('ON');

  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await cameraData(page)).position).not.toEqual(prior.position);
  await page.waitForTimeout(250);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyD');
  const flown = await cameraData(page);
  expect(canonical(flown.quaternion)).toEqual(canonical(prior.quaternion)); // keys only move

  const box = await page.getByTestId('game-canvas').boundingBox();
  if (box === null) throw new Error('no canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 40, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await cameraData(page)).quaternion).not.toEqual(flown.quaternion);

  await page.keyboard.press('F2');
  await expect(app).toHaveAttribute('data-debug-camera', 'off');
  expect(await cameraData(page)).toEqual(prior);
  // Off again: movement keys do nothing.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(200);
  await page.keyboard.up('KeyW');
  expect(await cameraData(page)).toEqual(prior);
  expect(problems).toEqual([]);
});
