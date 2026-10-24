import { expect, test, type Page } from '@playwright/test';
import {
  holdKey,
  playerState,
  stubPointerLock,
  takeControl,
  turnTo,
  type PlayerState,
} from './helpers/player';

// mw-e01.4: the vertical slice's grey-box level (?scene=slice) against the production build
// (Chromium). The required route is a straight line north along x = 0 (docs/design/vertical-slice.md
// §4): the bot walks up against the spawn-room door and opens it with Interact (E), walks the
// corridor through CP-1 and CP-2, crosses the arena between the pillars and walks into the locked
// iron exit door without the key. The arena's Forgotten miner (mw-e01.5) would fight the bot on the
// way; the fight is not this test's, so the debug console (?debug=1) kills it while the bot is
// still in the spawn room (it drops the key at its post, off the route, and the bot never takes it).
// The page publishes the doors on #app[data-mechanisms], the checkpoints entered on
// #app[data-checkpoints], the world facts on #app[data-facts], the creatures' AI on #app[data-ai]
// and the player on #app[data-player]; the test only reads them.
//
// Walking is paced by sim ticks and checked against the published position, never by wall time:
// CI renders a few frames a second and the frame loop runs at most five ticks a frame, so a slow
// runner only costs frames (see e2e/helpers/player.ts, mw-e00.32).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

const W = { code: 'KeyW', key: 'w' };
const E = { code: 'KeyE', key: 'e' };

/** Sim ticks per metre of walking: 5 m/s at 60 Hz. */
const TICKS_PER_METRE = 12;

interface Mechanisms {
  doors: Record<string, { status: string; openness: number }>;
}

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

async function data<T>(page: Page, key: string): Promise<T> {
  const json = await page.locator('#app').getAttribute(`data-${key}`);
  return JSON.parse(json ?? 'null') as T;
}

/**
 * Walks north along x = 0 until the player's z reaches `target`, or until a leg makes no headway
 * (something solid in the way). Each leg aims at (0, target), holds W for the ticks the remaining
 * distance needs and lets the player come to rest, then reads where it got to. Returns the state
 * where it stopped.
 */
async function walkNorth(page: Page, target: number, maxLegs = 12): Promise<PlayerState> {
  let state = await playerState(page);
  for (let leg = 0; leg < maxLegs && state.position.z < target; leg++) {
    await turnTo(page, { x: 0, z: target + 2 }, { tolerance: 0.03 });
    const ticks = Math.max(5, Math.ceil((target - state.position.z) * TICKS_PER_METRE));
    const before = state.position.z;
    state = await holdKey(page, W, ticks, 8);
    if (state.position.z - before < 0.05) break;
  }
  return state;
}

interface AiReadout {
  agents: { entity: number; state: string; at: [number, number, number] }[];
}

/** The slice's one creature, the Forgotten miner, as #app[data-ai] lists it once it thinks. */
async function skeleton(page: Page): Promise<AiReadout['agents'][number]> {
  await expect
    .poll(async () => (await data<AiReadout | null>(page, 'ai'))?.agents.length ?? 0, {
      timeout: 15_000,
    })
    .toBe(1);
  const agent = (await data<AiReadout>(page, 'ai')).agents[0];
  if (agent === undefined) throw new Error('the slice has no skeleton');
  return agent;
}

/** Kills the Forgotten miner with the debug console and waits for its slain fact (mw-e01.7). */
async function killSkeleton(page: Page): Promise<void> {
  const { entity } = await skeleton(page);
  await run(page, `kill ${String(entity)}`);
  await expect
    .poll(
      async () =>
        (await data<Record<string, unknown>>(page, 'facts'))['entity:slice/skeleton.slain'],
      { timeout: 30_000 },
    )
    .toBe(true);
}

/** Presses Interact for one tick (the frame loop may hold it a few more). */
async function interact(page: Page): Promise<void> {
  await holdKey(page, E, 1, 5);
}

test('mw-e01.4 AC-3: walking the route into the exit without the key, it stays locked with a "Locked." prompt and the slice is not complete', async ({
  page,
}) => {
  // About 650 sim ticks of walking, doors and coasting: at most five ticks a frame, ~45 s on a ~3 fps
  // runner, and up to twice that when frames come slower still, plus a round trip (~1 s there) per
  // leg and turn.
  test.setTimeout(240_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await openSlice(page);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-mechanisms', /"exit-door":\{"status":"locked"/);
  // The game clock's own time.* facts are set from the first game minute; no other fact is set yet.
  await expect
    .poll(async () =>
      Object.keys(JSON.parse((await app.getAttribute('data-facts')) ?? '{}') as object).filter(
        (key) => !key.startsWith('time.'),
      ),
    )
    .toEqual([]);
  // The miner rests at its post, Unaware of the bot in the spawn room; it falls before the walk.
  expect(await skeleton(page)).toMatchObject({ state: 'unaware', at: [2.5, 0, 32.5] });
  await killSkeleton(page);
  await takeControl(page);

  // Spawn room: up against the wooden door (it stops the player short of z = 5) and open it.
  const atDoor = await walkNorth(page, 4.5);
  expect(atDoor.position.z).toBeGreaterThan(4);
  expect(atDoor.position.z).toBeLessThan(5);
  const prompt = page.getByTestId('interact-prompt');
  await expect(prompt).toContainText('Open', { timeout: 10_000 });
  await interact(page);
  await expect
    .poll(async () => (await data<Mechanisms>(page, 'mechanisms')).doors['spawn-door'], {
      timeout: 30_000,
    })
    .toEqual({ status: 'open', openness: 1 });

  // The corridor: CP-1 just past the door, CP-2 at its end before the arena.
  const corridorEnd = await walkNorth(page, 24.2);
  expect(corridorEnd.position.z).toBeGreaterThan(23.5);
  await expect
    .poll(async () => data<string[]>(page, 'checkpoints'), { timeout: 10_000 })
    .toEqual(['cp-1', 'cp-2']);

  // Across the arena and into the iron door: it holds the player in the arena, locked, with the
  // lock's hint.
  const atExit = await walkNorth(page, 36.5);
  expect(atExit.position.z).toBeGreaterThan(35.5);
  expect(atExit.position.z).toBeLessThan(37);
  await expect(prompt).toContainText('Locked.', { timeout: 10_000 });
  await interact(page);
  // Push on into it for half a second of sim time: still nowhere.
  const pushed = await holdKey(page, W, 30, 8);
  expect(pushed.position.z).toBeLessThan(37);
  expect((await data<Mechanisms>(page, 'mechanisms')).doors['exit-door']).toEqual({
    status: 'locked',
    openness: 0,
  });
  await expect(prompt).toContainText('Locked.');
  // No slice complete: the fact was never written (only the miner's slain fact is).
  const facts = await data<Record<string, unknown>>(page, 'facts');
  expect(
    Object.fromEntries(Object.entries(facts).filter(([key]) => !key.startsWith('time.'))),
  ).toEqual({
    'entity:slice/skeleton.slain': true,
  });
  expect(problems).toEqual([]);
});

// mw-e01.6: the slice's loot. The Forgotten miner rests at its post by pillar B (2.5, 0, 32.5),
// carrying the rusted gallery key, and drops it at its body when it dies (mw-e01.5); the alcove chest
// stands at (8, 1.4, 36.5), 1.4 m up off the arena. These tests kill the miner and reach the key and
// the chest with the debug console's `kill` and `tp` (the fight and the walk there are mw-e01.9's):
// the pack is on #app[data-items], what each container holds on #app[data-containers] and whether
// the inventory screen is open on #app[data-inventory].

interface Stack {
  item: string;
  count: number;
}

interface Containers {
  'alcove-chest'?: { opened: boolean; items: Stack[]; gold: number };
}

const pack = async (page: Page) =>
  (await data<{ pack: Stack[] } | null>(page, 'items'))?.pack ?? [];
const alcoveChest = async (page: Page) =>
  (await data<Containers | null>(page, 'containers'))?.['alcove-chest'];

/** Opens the slice with the debug console and waits for the player to stand in a running sim. */
async function openSlice(page: Page): Promise<void> {
  await page.goto('/?scene=slice&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'slice', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
}

/** Types `line` into the debug console, leaving it open. */
async function type(page: Page, line: string): Promise<void> {
  await page.keyboard.press('Backquote');
  const input = page.getByTestId('debug-console-input');
  await expect(input).toBeFocused();
  await page.keyboard.insertText(line);
  await page.keyboard.press('Enter');
}

/** Types `line` into the debug console and closes it again. */
async function run(page: Page, line: string): Promise<void> {
  await type(page, line);
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed');
}

/** Teleports the player to (x, y, z), lets it land and turns it to look at `look`. */
async function standAt(
  page: Page,
  [x, y, z]: [number, number, number],
  look: { x: number; z: number },
): Promise<void> {
  await run(page, `tp ${String(x)} ${String(y)} ${String(z)}`);
  await expect(page.locator('#app')).toHaveAttribute('data-player', /"grounded":true/);
  await takeControl(page);
  await turnTo(page, look, { tolerance: 0.03 });
}

test('mw-e01.6 AC-2: holding the gallery key, Interact on the exit door unlocks and opens it without opening the inventory', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  // Count every time the inventory screen opens, from the first frame on.
  await page.addInitScript(() => {
    const w = window as unknown as { inventoryOpens: number };
    w.inventoryOpens = 0;
    new MutationObserver(() => {
      const app = document.querySelector<HTMLElement>('#app');
      if (app?.dataset['inventory'] === 'open') w.inventoryOpens += 1;
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-inventory'] });
  });
  await openSlice(page);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-mechanisms', /"exit-door":\{"status":"locked"/);
  await takeControl(page);

  // The miner dies at its post and drops the key it carries, with its tier 1 loot (crowns and maybe
  // scrap, mw-ju8.19): Interact by the body takes things up one at a time until the key is on the
  // keyring.
  await killSkeleton(page);
  await standAt(page, [2.5, 0, 31.3], { x: 2.5, z: 32.5 });
  const prompt = page.getByTestId('interact-prompt');
  for (let taken = 0; taken < 5; taken++) {
    await expect(prompt).toContainText(/^E?(Take|Pick up)/, { timeout: 10_000 });
    const key = ((await prompt.textContent()) ?? '').includes('Rusted gallery key');
    await interact(page);
    if (key) break;
  }
  await expect
    .poll(async () => (await pack(page)).map((stack) => stack.item), { timeout: 30_000 })
    .toContain('rusted-gallery-key');

  // A step in front of the iron door: one Interact unlocks and opens it.
  await standAt(page, [0, 0, 35.5], { x: 0, z: 37 });
  await expect(prompt).not.toContainText('Locked.', { timeout: 10_000 });
  await interact(page);
  await expect
    .poll(async () => (await data<Mechanisms>(page, 'mechanisms')).doors['exit-door'], {
      timeout: 30_000,
    })
    .toEqual({ status: 'open', openness: 1 });
  await expect(app).toHaveAttribute('data-inventory', 'closed');
  expect(
    await page.evaluate(() => (window as unknown as { inventoryOpens: number }).inventoryOpens),
  ).toBe(0);
  // The quest key stays on the ring.
  expect((await pack(page)).map((stack) => stack.item)).toContain('rusted-gallery-key');

  // Through into the vestibule: the slice is complete.
  const through = await walkNorth(page, 38.5);
  expect(through.position.z).toBeGreaterThan(37.5);
  await expect
    .poll(async () => (await data<Record<string, unknown>>(page, 'facts'))['slice.complete'], {
      timeout: 10_000,
    })
    .toBe(true);

  // mw-e01.18 AC-1: the next frame shows the slice-complete card with Return to title focused, and
  // the knight stops: walking on changes nothing.
  const card = page.getByTestId('slice-complete');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText('Slice complete');
  await expect(page.getByTestId('slice-complete-return')).toBeFocused();
  // The completion autosave (mw-e01.7) lands before Return to title leaves, and the card says so.
  await expect(page.getByTestId('slice-complete-save')).toHaveText('Progress saved.', {
    timeout: 30_000,
  });
  const completion = await data<{ type: string; kind: string; slot: string }>(page, 'autosave');
  expect(completion).toMatchObject({ type: 'saved', kind: 'quest' });
  const stopped = await playerState(page);
  await holdKey(page, W, 30);
  expect((await playerState(page)).position.z).toBeCloseTo(stopped.position.z, 1);

  // mw-e01.18 AC-3: Return to title shows the title with no console errors, and Continue loads the
  // completion save.
  await page.keyboard.press('Enter');
  const title = page.locator('[data-screen="title"]');
  await expect(title).toBeVisible({ timeout: 30_000 });
  await expect(title.getByRole('button', { name: 'Continue' })).toBeFocused();
  await expect(title).toContainText('Last save:');
  await page.keyboard.press('Enter');
  await expect(app).toHaveAttribute('data-loaded-save', /"hash"/, { timeout: 30_000 });
  expect((await data<{ slot: string; status: string }>(page, 'loaded-save')).slot).toBe(
    completion.slot,
  );
  // Back in the vestibule behind the open door, with no card: the fact was loaded, not flipped.
  await expect
    .poll(async () => (await playerState(page)).position.z, { timeout: 30_000 })
    .toBeGreaterThan(37.5);
  await expect(page.getByTestId('slice-complete')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('mw-e01.6 AC-3: loot the alcove chest, save, close the tab, load the save: the chest is empty', async ({
  context,
}) => {
  test.setTimeout(180_000);
  const first = await context.newPage();
  const problems = collectProblems(first);
  await stubPointerLock(first);
  await openSlice(first);
  expect(await alcoveChest(first)).toEqual({ opened: false, items: [], gold: 0 });
  // The miner below the alcove is not this test's: it falls first.
  await killSkeleton(first);
  await takeControl(first);

  // Up in the alcove, facing the chest: Interact opens it (rolling its table), Enter takes all.
  await standAt(first, [8, 1.4, 35.3], { x: 8, z: 36.5 });
  const prompt = first.getByTestId('interact-prompt');
  await expect(prompt).toContainText('Search', { timeout: 10_000 });
  await first.keyboard.press('KeyE');
  await expect(first.locator('#app')).toHaveAttribute('data-container-window', 'open');
  await first.keyboard.press('Enter');
  await expect.poll(() => alcoveChest(first)).toEqual({ opened: true, items: [], gold: 0 });
  // Always a healing draught and the miner's tally stick (the coins go to the gold counter).
  await expect
    .poll(async () => (await pack(first)).map((stack) => stack.item).sort())
    .toEqual(['healing-draught', 'miners-tally-stick']);
  await expect(prompt).toContainText('Empty');

  await run(first, 'save manual-1');
  await expect(first.locator('#app')).toHaveAttribute('data-saved-game', /"slot":"manual-1"/);
  expect(problems).toEqual([]);
  await first.close();

  // A new tab: the chest as built, then the save.
  const second = await context.newPage();
  const later = collectProblems(second);
  await stubPointerLock(second);
  await openSlice(second);
  expect(await alcoveChest(second)).toEqual({ opened: false, items: [], gold: 0 });
  await type(second, 'kill');
  const screen = second.locator('[data-screen="death"]');
  // The death beat (mw-e01.8, 90 sim ticks) runs first: seconds of wall time on a slow runner.
  await expect(screen).toBeVisible({ timeout: 45_000 });
  await screen.getByRole('button', { name: 'Load last save' }).click();
  await openSlice(second);
  await expect(second.locator('#app')).toHaveAttribute('data-loaded-save', /"slot":"manual-1"/);
  await expect.poll(() => alcoveChest(second)).toEqual({ opened: true, items: [], gold: 0 });

  // Open it again: empty, and nothing more comes out.
  await takeControl(second);
  await standAt(second, [8, 1.4, 35.3], { x: 8, z: 36.5 });
  const again = second.getByTestId('interact-prompt');
  await expect(again).toContainText('Empty', { timeout: 10_000 });
  await second.keyboard.press('KeyE');
  await expect(again).toContainText('Empty');
  expect(await alcoveChest(second)).toEqual({ opened: true, items: [], gold: 0 });
  expect(later).toEqual([]);
});

// mw-546, mw-va0: the slice's set pieces wear their art. The two door fronts are painted on the leaves, the
// torch, brazier and chest models replace their stand-ins, and the crate, pillars and ivy ledge wear
// paintings, and the walls, floors and ledges wear the glenstone (mw-7w0); each is requested and loads with no console errors (the models and textures are
// placeholders, see assets/prompts).
test('mw-546, mw-va0: the slice loads its door fronts, models and surface paintings with no console errors', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (/^\[\.WebGL-[^\]]+\]GL Driver Message/.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  const assets = [
    'door-wood-01.webp',
    'door-iron-01.webp',
    'model-prop-wall-torch-01.glb',
    'model-prop-brazier-floor-01.glb',
    'model-prop-chest-wooden-01.glb',
    'crate-01.webp',
    'pillar-glenstone-01.webp',
    'ivy-stone-01.webp',
    'tex-glenstone-quay-wendmouth-probe-01.webp',
  ];
  const loaded = assets.map((name) =>
    page.waitForResponse((response) => response.url().endsWith(name) && response.ok()),
  );
  await page.goto('/?scene=slice');
  await expect(page.locator('#app')).toHaveAttribute('data-scene', 'slice', { timeout: 10_000 });
  await Promise.all(loaded);
  // A few frames, so a texture or model that failed to build would raise its error here.
  await page.waitForTimeout(1_500);
  expect(problems).toEqual([]);
});
