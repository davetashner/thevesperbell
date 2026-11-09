import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// mw-e05.7: arrows that stick stay, and Interact takes them back. `?arrows=standard` looses a standard
// arrow at the testbed's back wall every 2.5 s, all to the same spot, so they pile up within 1 m of one
// another (lane 0.9 is bare wall: arrows in the target board, a living thing, are not takeable); the player walks up, faces them and reads "Take arrows (n)", presses E and the quiver
// count rises by n. Set E2E_ARROW_SHOTS to a directory to also save screenshots.
test.use({ viewport: { width: 1024, height: 576 } });

interface Player {
  position: { x: number; y: number; z: number };
  yaw: number;
  bow?: { quiver: Record<string, number> };
}

test('AC-2: stuck arrows show "Take arrows (n)" and Interact puts them back in the quiver', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const lock: { element: Element | null } = { element: null };
    Object.defineProperty(Document.prototype, 'pointerLockElement', {
      configurable: true,
      get: () => lock.element,
    });
    Element.prototype.requestPointerLock = function requestPointerLock(this: Element) {
      lock.element = this;
      document.dispatchEvent(new Event('pointerlockchange'));
      return Promise.resolve();
    };
  });
  await page.goto('/?scene=testbed&arrows=standard&lane=0.9');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 5_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await page.getByTestId('game-canvas').click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
  const player = async (): Promise<Player> =>
    JSON.parse((await app.getAttribute('data-player')) ?? '{}') as Player;
  const wrap = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  const turnTo = async (yaw: number): Promise<void> => {
    const counts = Math.round(-wrap(yaw - (await player()).yaw) / 0.003);
    await page.evaluate((movementX) => {
      window.dispatchEvent(new MouseEvent('mousemove', { movementX, movementY: 0 }));
    }, counts);
  };
  await turnTo(0);
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await player()).position.z).toBeLessThan(-2.5);
  await page.keyboard.up('KeyW');
  // Wait for three arrows to be stuck whole.
  await expect
    .poll(
      async () => {
        const json = await app.getAttribute('data-arrows');
        return json === null ? 0 : (JSON.parse(json) as { stuck: number }).stuck;
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThanOrEqual(3);
  // Face the arrows (yaw: 0 looks along -z, positive turns left).
  const latest = JSON.parse((await app.getAttribute('data-arrows')) ?? '{}') as {
    latest: { position: { x: number; z: number } };
  };
  const at = (await player()).position;
  await turnTo(Math.atan2(-(latest.latest.position.x - at.x), -(latest.latest.position.z - at.z)));
  const prompt = page.getByTestId('interact-prompt');
  await expect(prompt).toContainText(/Take arrows? ?(\(\d+\))?/, { timeout: 10_000 });
  const label = (await prompt.textContent()) ?? '';
  const n = Number(/\((\d+)\)/.exec(label)?.[1] ?? '1');
  expect(n).toBeGreaterThanOrEqual(1);
  const dir = process.env['E2E_ARROW_SHOTS'];
  if (dir !== undefined) {
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: join(dir, 'take-prompt.png') });
  }
  const before = (await player()).bow?.quiver['standard'] ?? 0;
  // Press until the quiver rises (a press can land on a tick where focus is between neighbouring
  // arrows); the exact count is the unit test's.
  await expect
    .poll(
      async () => {
        await page.keyboard.press('KeyE');
        await page.waitForTimeout(300);
        return (await player()).bow?.quiver['standard'] ?? 0;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(before + 1);
  if (dir !== undefined) await page.screenshot({ path: join(dir, 'after-take.png') });
});
