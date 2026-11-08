import { expect, test, type Page } from '@playwright/test';
import {
  LOOK_SENSITIVITY,
  playerState,
  runConsole,
  stubPointerLock,
  takeControl,
  turnTo,
} from './helpers/player';

// mw-e08.25 AC-1: the Mage Hand use key in the running game, against the production build. The
// knight learns Mage Hand from the debug console, stands about 9 m from the mechanism room's north
// lever, holds the cast key (V) on it to take hold of the lever with the unseen hand, and presses
// Interact (E): the lever throws from across the room. Everything is read from the #app data
// readouts and the reticle.

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

/** The north lever (src/content/data/scene/mechanism-room.json). */
const LEVER = { x: 1.25, z: 4.5 };

interface Mechanisms {
  switches: Record<string, number>;
}

async function switches(page: Page): Promise<Record<string, number>> {
  const json = await page.locator('#app').getAttribute('data-mechanisms');
  return (JSON.parse(json ?? 'null') as Mechanisms).switches;
}

async function spellData(page: Page): Promise<{ started: number; learned: string[] }> {
  const json = await page.locator('#app').getAttribute('data-spells');
  return JSON.parse(json ?? 'null') as { started: number; learned: string[] };
}

test('AC-1: channelling Mage Hand on a lever 9 m away and pressing Interact throws it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await stubPointerLock(page);
  await page.goto('/?scene=mechanism-room&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'mechanism-room', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-debug-console', 'closed');
  await takeControl(page);

  await runConsole(page, 'spell learn mage-hand');
  await expect.poll(async () => (await spellData(page)).learned).toContain('mage-hand');
  // Across the room from the lever, looking at it.
  await runConsole(page, `tp ${String(LEVER.x)} 0 -4.5`);
  await turnTo(page, LEVER);
  // Tip the view down until the reticle ray meets the wall at the lever's height (1 m) from the 1.5 m
  // eye, 9.5 m away: about -0.05 rad.
  const want = -0.05;
  for (let i = 0; i < 6; i++) {
    const { pitch } = await playerState(page);
    if (Math.abs(pitch - want) < 0.015) break;
    await page.evaluate(
      (movementY) => {
        window.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY }));
      },
      Math.round((pitch - want) / LOOK_SENSITIVITY),
    );
    await expect
      .poll(async () => (await playerState(page)).pitch, { timeout: 5_000 })
      .not.toBe(pitch);
  }
  expect((await switches(page))['north-lever']).toBe(0);

  // Hold V to take hold of the lever; the reticle offers "Use".
  await page.keyboard.down('KeyV');
  const reticle = page.getByTestId('reticle');
  await expect(reticle.locator('.vb-reticle-note')).toHaveText('Use', { timeout: 10_000 });
  // The tether is not a plain interaction: nothing is in reach of the hands, and the press throws it.
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await switches(page))['north-lever']).toBe(1);
  await page.keyboard.up('KeyV');
  await expect(reticle.locator('.vb-reticle-note')).toHaveText('');
  expect(problems).toEqual([]);
});
