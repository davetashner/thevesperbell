import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-e05.7: arrows that stick stay, and Interact takes them back. `?arrows=standard` looses a standard
// arrow at the testbed's back wall every 2.5 s, all to the same spot, so they pile up within 1 m of one
// another (lane 0.9 is bare wall: arrows in the target board, a living thing, are not takeable); the player (teleported to the wall, far from the room lever)
// faces them and reads "Take arrows (n)", presses E once and the quiver
// count rises by n (more if another arrow lands meanwhile). Set E2E_ARROW_SHOTS to a directory to also save screenshots.
test.use({ viewport: { width: 1024, height: 576 } });

interface Player {
  bow?: { quiver: Record<string, number> };
}

test('AC-2: stuck arrows show "Take arrows (n)" and Interact puts them back in the quiver', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await stubPointerLock(page);
  await page.goto('/?scene=testbed&arrows=standard&lane=0.9&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 5_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await takeControl(page);
  const quiver = async (): Promise<number> =>
    (JSON.parse((await app.getAttribute('data-player')) ?? '{}') as Player).bow?.quiver[
      'standard'
    ] ?? 0;
  // Stand at the back wall (arrows rest on its face, so the wall must not hide them), 5.5 m from the
  // room lever at (0, 1): the pile is the only thing in reach.
  await runConsole(page, 'tp 0 0 -4.5');
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
  const latest = JSON.parse((await app.getAttribute('data-arrows')) ?? '{}') as {
    latest: { position: { x: number; z: number } };
  };
  await turnTo(page, { x: latest.latest.position.x, z: latest.latest.position.z });
  const prompt = page.getByTestId('interact-prompt');
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await expect(prompt).toContainText(/Take arrows? ?(\(\d+\))?/);
  const label = (await prompt.textContent()) ?? '';
  const n = Number(/\((\d+)\)/.exec(label)?.[1] ?? '1');
  expect(n).toBeGreaterThanOrEqual(1);
  const dir = process.env['E2E_ARROW_SHOTS'];
  if (dir !== undefined) {
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: join(dir, 'take-prompt.png') });
  }
  const before = await quiver();
  // One press takes the whole pile. An arrow that lands between the prompt and the press joins it, and
  // none ever leaves, so the quiver rises by at least the n the prompt showed.
  await page.keyboard.press('KeyE');
  await expect.poll(quiver, { timeout: 5_000 }).toBeGreaterThanOrEqual(before + n);
  if (dir !== undefined) await page.screenshot({ path: join(dir, 'after-take.png') });
});
