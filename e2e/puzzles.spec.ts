import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl } from './helpers/player';

// mw-e15.3: the puzzle runtime against the production build (Chromium), on the brazier hall, the
// demo scene (src/content/data/scene/brazier-hall.json) that exists only for it. The puzzle is data:
// three unlit braziers, a goal "all three burn for a second", a portcullis its outputs open. The
// page publishes the puzzles on #app[data-puzzles] (state, attribution, the entity ids they bind),
// the doors on #app[data-mechanisms] and the facts on #app[data-facts]; the specs read them and
// pace themselves by that state, never by the clock (CI draws about a frame a second). The player
// walks in (the debug console's `tp`), heats the braziers the way the console can (`prop <id>
// temperature 600`: the fire rules light them, and the puzzle reads what burns, not what lit it),
// and the vault opens. Set E2E_EVIDENCE
// to a directory to also keep the screenshots taken on the way.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
// A starved software-GL frame drops sim steps and says so; that is the runner, not the game.
const FRAME_LOOP_NOTICE = 'frame loop: ';
const BRAZIERS = ['brazier-west', 'brazier-north', 'brazier-east'] as const;

interface PuzzleData {
  id: string;
  state: string;
  attribution: string | null;
  met: boolean;
  entities: Record<string, number>;
}
interface Mechanisms {
  doors: Record<string, { status: string; openness: number }>;
}

test.use({ viewport: { width: 1280, height: 720 } });

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text()) || msg.text().startsWith(FRAME_LOOP_NOTICE)) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

async function data<T>(page: Page, key: string): Promise<T | null> {
  const json = await page.locator('#app').getAttribute(`data-${key}`);
  return JSON.parse(json ?? 'null') as T | null;
}

const puzzle = async (page: Page) =>
  (await data<PuzzleData[]>(page, 'puzzles'))?.find((p) => p.id === 'brazier-hall');
const vault = async (page: Page) =>
  (await data<Mechanisms>(page, 'mechanisms'))?.doors['vault-gate']?.status;

async function openHall(page: Page): Promise<void> {
  await page.goto('/?scene=brazier-hall&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'brazier-hall', { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-puzzles', /brazier-hall/, { timeout: 30_000 });
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['E2E_EVIDENCE'];
  if (dir === undefined) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}.png` });
}

/** Heats every brazier past its ignition point, as the debug console can; the fire rules light it. */
async function lightAll(page: Page): Promise<void> {
  const entities = (await puzzle(page))?.entities ?? {};
  for (const name of BRAZIERS) {
    await runConsole(page, `prop ${String(entities[name])} temperature 600`);
  }
}

test('AC-1, AC-2: walking in discovers the puzzle; lighting all three braziers solves it and raises the portcullis', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await openHall(page);
  await takeControl(page);

  // Dormant: nobody has found it, the portcullis is down and nothing burns.
  expect(await puzzle(page)).toMatchObject({ state: 'dormant', attribution: null, met: false });
  expect(Object.keys((await puzzle(page))?.entities ?? {})).toEqual(
    expect.arrayContaining([...BRAZIERS, 'torch-barrel', 'vault-gate']),
  );
  expect(await vault(page)).toBe('closed');
  await shot(page, 'puzzle-1-unsolved');

  // Walking into the northern half is the discovery volume.
  await runConsole(page, 'tp 0 0 1');
  await expect
    .poll(async () => (await puzzle(page))?.state, { timeout: 30_000 })
    .toBe('discovered');

  // Lit by any means counts: the goal reads the burning braziers, so the puzzle is solved once all
  // three have burned together for a second, and the vault latch it drives raises the portcullis.
  await lightAll(page);
  await expect.poll(async () => (await puzzle(page))?.state, { timeout: 30_000 }).toBe('solved');
  expect(await puzzle(page)).toMatchObject({ attribution: 'carry-flame', met: true });
  await expect
    .poll(
      async () => (await data<Record<string, unknown>>(page, 'facts'))?.['brazier-hall.vault-open'],
      {
        timeout: 30_000,
      },
    )
    .toBe(true);
  await expect.poll(() => vault(page), { timeout: 30_000 }).toBe('open');
  await shot(page, 'puzzle-2-solved');
  expect(problems).toEqual([]);
});

test('AC-5: a solved puzzle that is saved and loaded is still solved, with its vault open', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await openHall(page);
  await takeControl(page);
  await lightAll(page);
  await expect.poll(async () => (await puzzle(page))?.state, { timeout: 30_000 }).toBe('solved');
  await expect.poll(() => vault(page), { timeout: 30_000 }).toBe('open');
  await runConsole(page, 'save manual-1');
  await expect(page.locator('#app')).toHaveAttribute('data-saved-game', /"slot":"manual-1"/, {
    timeout: 30_000,
  });

  // Die and load the last save from the death screen: the page boots again and applies it.
  await runConsole(page, 'kill');
  const screen = page.locator('[data-screen="death"]');
  await expect(screen).toBeVisible({ timeout: 60_000 });
  await screen.getByRole('button', { name: 'Load last save' }).click();
  await openHall(page);
  await expect(page.locator('#app')).toHaveAttribute('data-loaded-save', /"slot":"manual-1"/, {
    timeout: 30_000,
  });
  await expect.poll(async () => (await puzzle(page))?.state, { timeout: 30_000 }).toBe('solved');
  expect(await puzzle(page)).toMatchObject({ attribution: 'carry-flame' });
  await expect.poll(() => vault(page), { timeout: 30_000 }).toBe('open');
  expect(problems).toEqual([]);
});

test('is safe on a scene that does not exist: no puzzle starts and nothing errors', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?scene=does-not-exist&debug=1');
  await expect(page.locator('#app')).toContainText('does-not-exist');
  expect(await page.locator('#app').getAttribute('data-puzzles')).toBeNull();
  await page.goto('/?scene=testbed');
  await expect(page.locator('#app')).toHaveAttribute('data-scene', 'testbed', { timeout: 30_000 });
  // The testbed's own example puzzle sleeps; the hall's puzzle is not here.
  const published = (await data<PuzzleData[]>(page, 'puzzles')) ?? [];
  expect(published.map((p) => [p.id, p.state])).toEqual([['testbed-room-lever', 'dormant']]);
  expect(problems.filter((p) => !/404|Failed to load resource/.test(p))).toEqual([]);
});
