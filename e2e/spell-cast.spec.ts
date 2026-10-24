import { expect, test, type Page } from '@playwright/test';
import {
  holdKey,
  LOOK_SENSITIVITY,
  playerState,
  runConsole,
  stubPointerLock,
  takeControl,
  turnTo,
} from './helpers/player';

// mw-e06.15: aim and cast in the greybox testbed against the production build (Chromium). The
// player learns Ember from the debug console, stands in front of the loose crate, aims the
// reticle down at it and presses the cast key (V): the bolt flies, hits the crate and sets it
// alight. The page publishes the player's casting on #app[data-spells] (selected spell, mana,
// casts, hits with whether the target burns); the test only reads it. Set E2E_SPELL_SHOT to a file
// path to also save a screenshot of the reticle with the Ember in flight.

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

/** The loose crate (src/content/data/scene/testbed.json). */
const CRATE = { x: -1, z: -2 };

interface SpellData {
  selected: string | null;
  learned: string[];
  mana: number | null;
  casts: number;
  hits: { spell: string; spawn: string | null; burning: boolean }[];
  fizzles: string[];
  refusals: number;
  aim: { valid: boolean; clamped: boolean; mode: string } | null;
}

async function spells(page: Page): Promise<SpellData> {
  const json = await page.locator('#app').getAttribute('data-spells');
  return JSON.parse(json ?? 'null') as SpellData;
}

async function start(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await stubPointerLock(page);
  await page.goto('/?scene=testbed&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-debug-console', 'closed');
  await takeControl(page);
  return problems;
}

/** Learns Ember, stands 3.5 m south of the crate looking at it, and tips the view down onto it. */
async function aimAtCrate(page: Page): Promise<void> {
  await runConsole(page, 'spell learn ember');
  await expect.poll(async () => (await spells(page)).selected, { timeout: 15_000 }).toBe('ember');
  await runConsole(page, `tp ${String(CRATE.x)} 0 1.5`);
  await turnTo(page, { x: CRATE.x, z: CRATE.z });
  // Tip the view down until the reticle ray meets the crate, 3.5 m ahead and about 0.5 m up from
  // the head's 1.5 m: about -0.25 rad.
  const want = -0.25;
  for (let i = 0; i < 6; i++) {
    const { pitch } = await playerState(page);
    if (Math.abs(pitch - want) < 0.03) break;
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
  expect(Math.abs((await playerState(page)).pitch - want)).toBeLessThan(0.06);
}

test('AC-4: learns Ember, aims at the loose crate with the reticle, casts it and the crate catches fire', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = await start(page);
  const reticle = page.getByTestId('reticle');
  await expect(reticle).toHaveAttribute('hidden', ''); // no spell yet
  await aimAtCrate(page);
  await expect(reticle.locator('.vb-reticle-cross')).toBeVisible();
  await expect(reticle).toHaveAttribute('data-spell', 'Ember');
  await expect(reticle).toHaveAttribute('data-state', /ready|far/);
  const before = await spells(page);
  expect(before.mana).toBe(20); // the knight's start pool
  expect(before.casts).toBe(0);

  // V casts: the 0.3 s wind-up, then the bolt flies.
  await holdKey(page, { code: 'KeyV', key: 'v' }, 2, 0);
  await expect.poll(async () => (await spells(page)).casts, { timeout: 20_000 }).toBe(1);
  await expect
    .poll(async () => (await spells(page)).hits.some((hit) => hit.spawn === 'loose-crate'), {
      timeout: 20_000,
    })
    .toBe(true);
  await expect
    .poll(
      async () =>
        (await spells(page)).hits.some((hit) => hit.spawn === 'loose-crate' && hit.burning),
      { timeout: 20_000 },
    )
    .toBe(true);
  const after = await spells(page);
  expect(after.mana).toBeLessThan(20);
  expect(after.fizzles).toEqual([]);
  expect(problems).toEqual([]);
});

test('the reticle and an Ember in flight are drawn (screenshot)', async ({ page }) => {
  test.skip(process.env['E2E_SPELL_SHOT'] === undefined, 'set E2E_SPELL_SHOT to a file path');
  test.setTimeout(180_000);
  await start(page);
  await aimAtCrate(page);
  // Slow the sim so the bolt is on screen for seconds of wall time.
  await runConsole(page, 'timescale 0.04');
  await holdKey(page, { code: 'KeyV', key: 'v' }, 1, 0);
  await expect.poll(async () => (await spells(page)).casts, { timeout: 60_000 }).toBe(1);
  await page.waitForTimeout(4200); // a few sim ticks of flight at this speed
  await page.screenshot({ path: process.env['E2E_SPELL_SHOT'] ?? '' });
});
