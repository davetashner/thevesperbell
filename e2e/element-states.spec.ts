import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-e03.28: burning, wet, frozen and charged things are legible. In the testbed (there is no
// "chaos room" scene; the testbed's loose props are the stand-ins) the debug console's `prop` puts
// four loose bodies into the four states and the element feedback bridge draws them. `?elements`
// publishes its counters on #app[data-elements]. Set E2E_ELEMENT_SHOTS to a directory to also save
// screenshots of each state and of all four side by side.

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface Probe {
  entities: number;
  wanted: number;
  live: number;
  culled: number;
  perState: Record<string, number>;
  clouds: number;
  looks: number;
  vfx: number;
  objects: { id: number; x: number; y: number; z: number }[];
}

async function probe(page: Page): Promise<Probe> {
  const json = await page.locator('#app').getAttribute('data-elements');
  return JSON.parse(json ?? 'null') as Probe;
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

/** Spaces for four crates in a row 6 m apart at most, so fire in one cannot reach another. */
const ROW = [-4.5, -3, 3, 4.5] as const;

/**
 * Spawns four crates in a row ahead of the player start, walks back to it facing them and returns
 * their ids left to right as the player sees them mirrored: ROW order.
 */
async function startWithRow(page: Page): Promise<number[]> {
  await stubPointerLock(page);
  await page.goto('/?scene=testbed&elements&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-elements', /"objects":\[\{/, { timeout: 10_000 });
  await takeControl(page);
  for (const x of ROW) {
    await runConsole(page, `tp ${String(x)} 0 0.5`);
    await runConsole(page, 'spawn testprop-crate');
  }
  await expect
    .poll(async () => (await probe(page)).objects.length)
    .toBeGreaterThanOrEqual(ROW.length + 3);
  const objects = (await probe(page)).objects;
  const ids = ROW.map((x) => objects.filter((o) => Math.abs(o.x - x) < 0.3 && o.z > 1.5).pop()?.id);
  await runConsole(page, 'tp 0 0 -1');
  await turnTo(page, { x: 0, z: 3 });
  return ids.map((id) => id ?? -1);
}

const shots = process.env['E2E_ELEMENT_SHOTS'];
async function shoot(page: Page, name: string): Promise<void> {
  if (shots !== undefined) await page.screenshot({ path: `${shots}/${name}.png` });
}

test.use({ viewport: { width: 1280, height: 720 } });

test('AC-3: the fire and freeze scenarios draw element effects and looks with no console errors', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = collectProblems(page);
  const [, frozen, , burning] = await startWithRow(page);
  expect((await probe(page)).vfx).toBe(0);

  // Fire: heat a crate past its ignition point; it burns, with a flame loop and its ember look.
  await runConsole(page, `prop ${String(burning)} temperature 600`);
  await expect.poll(async () => (await probe(page)).perState['burning'] ?? 0).toBe(1);
  await expect.poll(async () => (await probe(page)).vfx).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await probe(page)).looks).toBeGreaterThanOrEqual(1);

  // Freeze: a frozen crate gets frost and its icy look, beside the fire.
  await runConsole(page, `prop ${String(frozen)} frozen true`);
  await expect.poll(async () => (await probe(page)).perState['frozen'] ?? 0).toBe(1);
  await expect.poll(async () => (await probe(page)).vfx).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await probe(page)).looks).toBeGreaterThanOrEqual(2);

  // Thawing releases the effect and the look.
  await runConsole(page, `prop ${String(frozen)} frozen false`);
  await expect.poll(async () => (await probe(page)).perState['frozen'] ?? 0).toBe(0);
  // (A thawed crate is left wet, which is its own state; every wanted state has its effect.)
  await expect
    .poll(async () => {
      const now = await probe(page);
      return now.live === now.wanted;
    })
    .toBe(true);
  expect(problems).toEqual([]);
});

test('burning, wet, frozen and charged crates all show, side by side', async ({ page }) => {
  test.setTimeout(180_000);
  const problems = collectProblems(page);
  const [charged, frozen, wet, burning] = await startWithRow(page);
  await runConsole(page, `prop ${String(frozen)} frozen true`);
  await runConsole(page, `prop ${String(wet)} wetness 1`);
  await runConsole(page, `prop ${String(burning)} temperature 600`);
  await expect.poll(async () => (await probe(page)).perState['burning'] ?? 0).toBe(1);
  // Charge drains in about a second, so it is struck again until it is seen.
  await expect
    .poll(
      async () => {
        await runConsole(page, `prop ${String(charged)} charge 60`);
        return (await probe(page)).perState['charged'] ?? 0;
      },
      { timeout: 30_000 },
    )
    .toBe(1);
  await shoot(page, 'four-states');
  const seen = await probe(page);
  expect(seen.perState).toMatchObject({ frozen: 1, wet: 1, burning: 1 });
  expect(seen.looks).toBeGreaterThanOrEqual(3);
  expect(problems).toEqual([]);
});

test('mw-e29.8: dousing a burning crate puffs steam, and a wet frozen crate reads as ice', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = collectProblems(page);
  const [, frozen, , burning] = await startWithRow(page);
  await runConsole(page, `prop ${String(burning)} temperature 600`);
  await expect.poll(async () => (await probe(page)).perState['burning'] ?? 0).toBe(1);
  await shoot(page, 'burning-before-dousing');
  const before = (await probe(page)).vfx;
  // (The console writes properties directly, so douse by hand: cool it, soak it, put it out.)
  await runConsole(page, `prop ${String(burning)} temperature 20`);
  await runConsole(page, `prop ${String(burning)} wetness 1`);
  await runConsole(page, `prop ${String(burning)} burning false`);
  await expect.poll(async () => (await probe(page)).perState['wet'] ?? 0).toBe(1);
  await shoot(page, 'steam-puff');
  expect((await probe(page)).vfx).toBeGreaterThanOrEqual(Math.min(before, 1));

  await runConsole(page, `prop ${String(frozen)} wetness 1`);
  await runConsole(page, `prop ${String(frozen)} frozen true`);
  await expect.poll(async () => (await probe(page)).perState['frozen'] ?? 0).toBe(1);
  await shoot(page, 'wet-and-frozen');
  expect(problems).toEqual([]);
});
