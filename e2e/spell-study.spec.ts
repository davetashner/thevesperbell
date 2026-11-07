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

// mw-55i (mw-e07.2 AC-6): the book-study path in the running game, against the production build.
// The test gives the knight the Ember primer from the debug console, opens the pack, chooses Study, closes it
// waits out the 20-minute session (four 30-tick slices of sim time), then casts the spell it taught
// at the loose crate. Everything is read from #app data readouts and the inventory status line.

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
}

async function spells(page: Page): Promise<SpellData> {
  const json = await page.locator('#app').getAttribute('data-spells');
  return JSON.parse(json ?? 'null') as SpellData;
}

test('mw-e07.2 AC-6: study a spellbook in the pack, then cast its spell', async ({ page }) => {
  test.setTimeout(120_000);
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

  // Nothing learned yet; the book goes into the pack.
  expect((await spells(page)).learned).toEqual([]);
  await runConsole(page, 'item.give ember');
  await runConsole(page, 'timescale 8');

  const book = page.locator('[data-screen="inventory"] [data-item][aria-label^="Ember"]');
  const status = page.getByTestId('inventory-status');
  await page.keyboard.press('KeyI');
  await expect(app).toHaveAttribute('data-inventory', 'open');
  await book.click();
  await page.locator('[data-action="study"]').click();
  await expect(status).toHaveText('You settle down to study Ember: A First Flame.');

  // The open pack pauses the sim, so the session runs once the pack is closed (the player stays
  // seated, or the study would be interrupted) and ends in the spell learned.
  await page.keyboard.press('KeyI');
  await expect(app).toHaveAttribute('data-inventory', 'closed');
  await takeControl(page);
  await expect
    .poll(async () => (await spells(page)).learned, { timeout: 60_000 })
    .toContain('ember');
  await runConsole(page, 'timescale 1');

  // Stand 3.5 m south of the crate, tip the view onto it, and cast.
  await expect.poll(async () => (await spells(page)).selected, { timeout: 15_000 }).toBe('ember');
  await runConsole(page, `tp ${String(CRATE.x)} 0 1.5`);
  await turnTo(page, { x: CRATE.x, z: CRATE.z });
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
  await holdKey(page, { code: 'KeyV', key: 'v' }, 2, 0);
  await expect.poll(async () => (await spells(page)).casts, { timeout: 20_000 }).toBe(1);
  await expect
    .poll(
      async () =>
        (await spells(page)).hits.some((hit) => hit.spawn === 'loose-crate' && hit.burning),
      { timeout: 20_000 },
    )
    .toBe(true);
  expect((await spells(page)).fizzles).toEqual([]);
  expect(problems).toEqual([]);
});
