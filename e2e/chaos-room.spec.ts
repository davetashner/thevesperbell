import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl } from './helpers/player';

// mw-e03.54: the chaos room (?scene=chaos-room) boots clean and its six identification crates (the
// mw-e03.28 AC-5 playtest line, 3 m apart along the south wall) can each be put into a state. The
// stations' stimuli are covered by tests/integration/chaos-room.test.ts; this only checks the room
// in the browser. `?elements` publishes the feedback counters on #app[data-elements].

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface Probe {
  perState: Record<string, number>;
  objects: { id: number; x: number; y: number; z: number }[];
}

async function probe(page: Page): Promise<Probe> {
  const json = await page.locator('#app').getAttribute('data-elements');
  return JSON.parse(json ?? 'null') as Probe;
}

test.use({ viewport: { width: 1280, height: 720 } });

test('AC-6: the six identification crates take their states in the chaos room with no console errors', async ({
  page,
}, testInfo) => {
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

  // The identification line: crates at x = -7.5, -4.5 ... 7.5 on z = -6, left to right.
  const line = (await probe(page)).objects
    .filter((o) => Math.abs(o.z + 6) < 0.4)
    .sort((a, b) => a.x - b.x);
  expect(line).toHaveLength(6);

  const [burning, wet, frozen, charged] = line.map((o) => String(o.id));
  await runConsole(page, `prop ${String(burning)} temperature 600`);
  await runConsole(page, `prop ${String(wet)} wetness 1`);
  await runConsole(page, `prop ${String(frozen)} wetness 1`);
  await runConsole(page, `prop ${String(frozen)} frozen true`);
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
  expect((await probe(page)).perState).toMatchObject({ burning: 1, frozen: 1 });
  await testInfo.attach('chaos-room-identification-line', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(problems).toEqual([]);
});
