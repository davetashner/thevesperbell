import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  runConsole,
  stubPointerLock,
  takeControl,
  turnTo,
  type PlayerState,
} from './helpers/player';

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
  test.setTimeout(240_000);
  await stubPointerLock(page);
  await page.goto('/?scene=testbed&arrows=standard&lane=0.9&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 30_000 });
  await takeControl(page);
  const quiver = async (): Promise<number> =>
    (JSON.parse((await app.getAttribute('data-player')) ?? '{}') as Player).bow?.quiver[
      'standard'
    ] ?? 0;
  // Stand at the back wall (arrows rest on its face, so the wall must not hide them), 5.5 m from the
  // room lever at (0, 1): the pile is the only thing in reach.
  await runConsole(page, 'tp 0 0 -4.5');
  // On CI's ~1 fps runner the teleport can land frames later (mw-fd3): wait until the player is there.
  await expect
    .poll(
      async () =>
        (JSON.parse((await app.getAttribute('data-player')) ?? '{}') as Partial<PlayerState>)
          .position?.z ?? 0,
      { timeout: 30_000 },
    )
    .toBeLessThan(-4);
  // Wait on game state, not time (mw-3xx). The readout's `latest` is the newest arrow, and right after
  // each shot that one is still flying (its position is mid-room), so aiming at it once left the player
  // facing the wrong way for good: CI trace, yaw -2.91 against -1.46 wanted. Wait until the newest arrow
  // is stuck, three have stuck, and one of them came to rest whole: a stone wall breaks 60% of arrows,
  // and a broken one has no prompt.
  interface Readout {
    stuck: number;
    intact: number;
    latest: { state: string; position: { x: number; z: number } } | null;
  }
  const arrows = async (): Promise<Readout | null> => {
    const json = await app.getAttribute('data-arrows');
    return json === null ? null : (JSON.parse(json) as Readout);
  };
  // Take the spot from the very reading that passed: a second read can find the next arrow in flight.
  const rested: { at: { x: number; z: number } | null } = { at: null };
  await expect
    .poll(
      async () => {
        const r = await arrows();
        const latest = r?.latest;
        const ready = r !== null && r.stuck >= 3 && r.intact >= 1 && latest?.state === 'stuck';
        rested.at = ready ? { x: latest.position.x, z: latest.position.z } : null;
        return rested.at !== null;
      },
      { timeout: 90_000 },
    )
    .toBe(true);
  // The pile is all one spot on the wall. One turnTo can run out of moves on a slow runner and leave
  // the player facing the room (mw-fd3), so keep turning until the aim is true.
  const aim = rested.at;
  if (aim === null) throw new Error('no resting arrow');
  await expect
    .poll(async () => Math.abs((await turnTo(page, aim)).error), { timeout: 60_000 })
    .toBeLessThan(0.1);
  const prompt = page.getByTestId('interact-prompt');
  await expect(prompt).toBeVisible({ timeout: 30_000 });
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
  await expect.poll(quiver, { timeout: 30_000 }).toBeGreaterThanOrEqual(before + n);
  if (dir !== undefined) await page.screenshot({ path: join(dir, 'after-take.png') });
});
