import { expect, test, type Page } from '@playwright/test';
import { holdKey, stubPointerLock, takeControl } from './helpers/player';

// mw-a6t: the knight carries its sword at the low-ready, not hanging straight down. The page publishes
// where the blade points (angle from straight down, tip height, gap to the right leg) on
// #app[data-sword], in the body's own space, after every frame; the test only reads it. Against the
// production build (Chromium). SWORD_SHOTS=<dir> also saves a screenshot per state there.

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface Blade {
  offVertical: number;
  tipY: number;
  legGap: number;
}

const KEY_W = { code: 'KeyW', key: 'w' };
const KEY_SHIFT = { code: 'ShiftLeft', key: 'Shift' };
const KEY_C = { code: 'KeyC', key: 'c' };
const shots = process.env['SWORD_SHOTS'];

async function play(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await stubPointerLock(page);
  await page.goto('/?scene=testbed');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-sword', /offVertical/, { timeout: 20_000 });
  await takeControl(page);
  if (shots !== undefined) {
    // Close behind the knight, as the owner's playtest framing: the wheel zooms the orbit camera in.
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -400);
  }
  return problems;
}

/** Holds `keys` for `ticks` sim ticks, sampling the blade each frame; returns the samples. */
async function sample(
  page: Page,
  keys: { code: string; key: string }[],
  ticks: number,
  shot?: string,
) {
  const samples = await page.evaluate(
    ([list, hold, name]) =>
      new Promise<Blade[]>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const tick = () =>
          (JSON.parse(app?.dataset['player'] ?? '{"tick":0}') as { tick: number }).tick;
        const send = (type: string) => {
          for (const k of list)
            window.dispatchEvent(new KeyboardEvent(type, { code: k.code, key: k.key }));
        };
        const start = tick();
        const out: Blade[] = [];
        send('keydown');
        const watch = () => {
          const t = tick() - start;
          if (t > 16) out.push(JSON.parse(app?.dataset['sword'] ?? 'null') as Blade);
          if (t >= hold) {
            if (name) document.title = name;
            resolve(out);
            return;
          }
          requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      }),
    [keys, ticks, shot ?? ''] as const,
  );
  if (shots !== undefined && shot !== undefined)
    await page.screenshot({ path: `${shots}/${shot}.png` });
  for (const k of keys) {
    await page.evaluate(
      ([code, key]) => window.dispatchEvent(new KeyboardEvent('keyup', { code, key })),
      [k.code, k.key] as const,
    );
  }
  return samples;
}

test('AC-1: in idle, walk, run and crouch the blade is off vertical and clear of the leg and the ground', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = await play(page);
  const states: [string, { code: string; key: string }[]][] = [
    ['idle', []],
    ['crouch', [KEY_C]],
    ['walk', [KEY_W]],
    ['run', [KEY_W, KEY_SHIFT]],
  ];
  for (const [name, keys] of states) {
    const readings = await sample(page, keys, 34, name);
    expect(readings.length, name).toBeGreaterThan(3);
    const least = (f: (b: Blade) => number) => Math.min(...readings.map(f));
    const note = `offVertical min ${least((b) => b.offVertical).toFixed(1)} legGap min ${least((b) => b.legGap).toFixed(2)} tipY min ${least((b) => b.tipY).toFixed(2)} max ${Math.max(...readings.map((b) => b.offVertical)).toFixed(1)}`;
    test.info().annotations.push({ type: name, description: note });
    console.log(`SWORD ${name}: ${note}`);
    expect(
      least((b) => b.offVertical),
      `${name} off vertical`,
    ).toBeGreaterThan(30);
    expect(
      least((b) => b.legGap),
      `${name} leg gap`,
    ).toBeGreaterThan(0.15);
    expect(
      least((b) => b.tipY),
      `${name} tip above the ground`,
    ).toBeGreaterThan(0.05);
    // Let go of everything and stand again before the next state.
    await holdKey(page, { code: 'KeyZ', key: 'z' }, 30);
  }
  expect(problems).toEqual([]);
});

interface Probe {
  layers: Record<string, string>;
}

/** The player's animation probe, as the page publishes it. */
async function layers(page: Page): Promise<Record<string, string>> {
  const json = await page.locator('#app').getAttribute('data-player-animation');
  return (JSON.parse(json ?? '{"layers":{}}') as Probe).layers;
}

/** Reads the blade now. */
async function bladeNow(page: Page): Promise<Blade> {
  const json = await page.locator('#app').getAttribute('data-sword');
  return JSON.parse(json ?? 'null') as Blade;
}

test('AC-3: an attack and a dodge played from the carry run their own clips and the carry returns after', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = await play(page);
  const rest = await bladeNow(page);
  expect(rest.offVertical).toBeGreaterThan(30);
  expect(await layers(page)).toMatchObject({ carry: 'idle', action: 'none' });

  // A swing: the action layer takes the arm for the move, and the carry layer stays on beneath.
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await layers(page))['action'], { timeout: 15_000 }).toBe('attack');
  if (shots !== undefined) await page.screenshot({ path: `${shots}/attack-mid.png` });
  await expect.poll(async () => (await layers(page))['action'], { timeout: 30_000 }).toBe('none');
  await holdKey(page, { code: 'KeyZ', key: 'z' }, 40);
  expect(await layers(page)).toMatchObject({ carry: 'idle' });
  expect(Math.abs((await bladeNow(page)).offVertical - rest.offVertical)).toBeLessThan(5);

  // A dodge (R with a direction held): the same.
  const seen = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const send = (type: string, code: string, key: string) =>
          window.dispatchEvent(new KeyboardEvent(type, { code, key }));
        const states: string[] = [];
        const start = Date.now();
        send('keydown', 'KeyW', 'w');
        send('keydown', 'KeyR', 'r');
        send('keyup', 'KeyR', 'r');
        const watch = () => {
          const probe = JSON.parse(app?.dataset['playerAnimation'] ?? '{"layers":{}}') as {
            layers: Record<string, string>;
          };
          const base = probe.layers['base'] ?? '';
          if (states[states.length - 1] !== base) states.push(base);
          if (base === 'dodge') send('keyup', 'KeyW', 'w');
          if (states.includes('dodge') && base !== 'dodge') resolve(states);
          else if (Date.now() - start > 30_000) resolve(states);
          else requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      }),
  );
  expect(seen).toContain('dodge');
  await holdKey(page, { code: 'KeyZ', key: 'z' }, 60);
  expect((await layers(page))['carry']).toBe('idle');
  expect((await bladeNow(page)).offVertical).toBeGreaterThan(30);
  expect(problems).toEqual([]);
});
