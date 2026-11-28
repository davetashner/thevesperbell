import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl } from './helpers/player';

// mw-e03.27 AC-5: the rope and chandelier combo of the emergence catalogue (rope-burns-chandelier-falls
// in tests/scenarios), run in the browser. The full outcome (the plate under the chandelier, the golden
// state hash) is the integration test's; this checks the game boots the combo clean and plays its
// first beats: heat the rope, it burns, it lets go, the chandelier comes down. The fuel is cut to two
// seconds of sim time so it finishes within a few dozen frames (the frame loop runs at most five sim
// ticks a frame). `?elements` publishes the props on #app[data-elements], and the scene's ropes on
// #app[data-mechanisms].

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface Probe {
  perState: Record<string, number>;
  objects: { id: number; x: number; y: number; z: number }[];
}

async function probe(page: Page): Promise<Probe> {
  const json = await page.locator('#app').getAttribute('data-elements');
  return JSON.parse(json ?? 'null') as Probe;
}

async function ropeState(page: Page): Promise<string | undefined> {
  const json = await page.locator('#app').getAttribute('data-mechanisms');
  return (JSON.parse(json ?? 'null') as { ropes: Record<string, string> } | null)?.ropes[
    'combo-rope'
  ];
}

test.use({ viewport: { width: 1280, height: 720 } });

test('AC-5: heating the chaos room rope burns it through and the chandelier falls, with no console errors', async ({
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
  await page.goto('/?scene=chaos-room&elements&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'chaos-room', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-elements', /"objects":\[\{/, { timeout: 10_000 });
  await takeControl(page);
  await expect.poll(() => ropeState(page)).toBe('holding');

  // The chandelier is the only prop hanging high in the room's middle; its rope is the spawn just
  // before it in the scene (tests/integration/emergence-scenarios.test.ts checks that order).
  const hanging = (await probe(page)).objects.filter((o) => o.y > 5);
  expect(hanging).toHaveLength(1);
  const chandelier = hanging[0];
  if (chandelier === undefined) throw new Error('no chandelier');
  const rope = String(chandelier.id - 1);

  await runConsole(page, `prop ${rope} fuel 2`);
  await runConsole(page, `prop ${rope} temperature 600`);
  // The immediate effect: the rope burns while the chandelier still hangs.
  await expect
    .poll(async () => (await probe(page)).perState['burning'] ?? 0)
    .toBeGreaterThanOrEqual(1);
  // Then it lets go and the chandelier falls to the floor.
  await expect.poll(() => ropeState(page), { timeout: 60_000 }).toBe('gone');
  await expect
    .poll(async () => (await probe(page)).objects.find((o) => o.id === chandelier.id)?.y ?? 99, {
      timeout: 60_000,
    })
    .toBeLessThan(1.5);
  expect(problems).toEqual([]);
});
