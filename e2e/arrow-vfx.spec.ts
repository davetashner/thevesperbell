import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// mw-e29.11: the arrow effects in the greybox testbed against the production build (Chromium).
// `?arrows=<id>` looses one arrow type at the back wall every 2.5 s through the real arrow system (so
// the trail, the impact cue sheets, the wet decal, the noise ring, the rope unfurl, the wobble and the
// broken shaft all run as they do for a player's shot) and publishes what the effects are doing on
// #app[data-arrow-fx] (JSON). The page must draw with no console errors or warnings.
//
// Set E2E_ARROW_SHOTS to a directory to also save frames (the game canvas, around each impact).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface ArrowFxProbe {
  shots: number;
  impacts: { arrow: string; outcome: string }[];
  decals: number[];
  rings: number;
  ropes: number;
  broken: number;
  wobbling: number;
  wobbles: number;
  particles: number;
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

/** Everything the page has published for the arrow effects at some frame while it ran. */
interface Seen {
  max: ArrowFxProbe;
  last: ArrowFxProbe | null;
}

// Software WebGL renders every pixel on the CPU, so a small viewport keeps frames fast under load.
test.use({ viewport: { width: 1024, height: 576 } });

/**
 * Loads the testbed with one arrow type loosed repeatedly, turned to face the back wall, and watches
 * the probe each frame for `seconds`, keeping the largest value of each counter (effects are brief).
 * With E2E_ARROW_SHOTS set it also saves the canvas on the frames around each shot.
 */
async function watch(page: Page, arrow: string, shots: number): Promise<Seen> {
  await page.addInitScript(() => {
    const lock: { element: Element | null } = { element: null };
    const change = () => document.dispatchEvent(new Event('pointerlockchange'));
    Object.defineProperty(Document.prototype, 'pointerLockElement', {
      configurable: true,
      get: () => lock.element,
    });
    Element.prototype.requestPointerLock = function requestPointerLock(this: Element) {
      lock.element = this;
      change();
      return Promise.resolve();
    };
    Document.prototype.exitPointerLock = function exitPointerLock() {
      lock.element = null;
      change();
    };
  });
  await page.goto(`/?scene=testbed&arrows=${arrow}`);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 5_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  // Face the back wall: yaw 0 looks along -z. Moving the mouse right turns right (yaw falls).
  await page.getByTestId('game-canvas').click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
  const yawOf = async (): Promise<number> =>
    (JSON.parse((await app.getAttribute('data-player')) ?? '{}') as { yaw: number }).yaw;
  const wrap = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  const counts = Math.round(-wrap(0 - (await yawOf())) / 0.003);
  await page.evaluate((movementX) => {
    window.dispatchEvent(new MouseEvent('mousemove', { movementX, movementY: 0 }));
  }, counts);
  await expect.poll(async () => Math.abs(wrap(await yawOf()))).toBeLessThan(0.02);
  // Walk up to the wall (hold forward) so the impacts are close enough to read.
  await page.keyboard.down('KeyW');
  await expect
    .poll(
      async () =>
        (JSON.parse((await app.getAttribute('data-player')) ?? '{}') as { position: { z: number } })
          .position.z,
    )
    .toBeLessThan(-3);
  await page.keyboard.up('KeyW');
  const dir = process.env['E2E_ARROW_SHOTS'];
  const frames = await page.evaluate(
    async ({ wanted, save }) => {
      const root = document.querySelector<HTMLElement>('#app');
      if (!root) throw new Error('no #app');
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]');
      const zero = {
        shots: 0,
        impacts: [] as { arrow: string; outcome: string }[],
        decals: [] as number[],
        rings: 0,
        ropes: 0,
        broken: 0,
        wobbling: 0,
        wobbles: 0,
        particles: 0,
      };
      const max = { ...zero };
      let last: typeof zero | null = null;
      const saved: string[] = [];
      let sinceShot = -1;
      let seenShots = 0;
      const deadline = performance.now() + 60_000;
      return await new Promise<{ max: typeof zero; last: typeof zero | null; saved: string[] }>(
        (resolve) => {
          const tick = () => {
            const json = root.dataset['arrowFx'];
            if (json !== undefined) {
              const p = JSON.parse(json) as typeof zero;
              last = p;
              max.shots = Math.max(max.shots, p.shots);
              max.rings = Math.max(max.rings, p.rings);
              max.ropes = Math.max(max.ropes, p.ropes);
              max.broken = Math.max(max.broken, p.broken);
              max.wobbling = Math.max(max.wobbling, p.wobbling);
              max.wobbles = Math.max(max.wobbles, p.wobbles);
              max.particles = Math.max(max.particles, p.particles);
              if (p.decals.length > max.decals.length) max.decals = p.decals;
              if (p.impacts.length > max.impacts.length) max.impacts = p.impacts;
              if (p.shots > seenShots) {
                seenShots = p.shots;
                sinceShot = 0;
              }
              if (save && canvas && sinceShot >= 0 && sinceShot < 40) {
                saved.push(
                  `${String(p.shots)}-${String(sinceShot).padStart(2, '0')}|${canvas.toDataURL('image/jpeg', 0.8)}`,
                );
              }
              if (sinceShot >= 0) sinceShot++;
              if (p.shots >= wanted && sinceShot > 60) {
                resolve({ max, last, saved });
                return;
              }
            }
            if (performance.now() > deadline) {
              resolve({ max, last, saved });
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        },
      );
    },
    { wanted: shots, save: dir !== undefined },
  );
  if (dir !== undefined) {
    await mkdir(dir, { recursive: true });
    for (const frame of frames.saved) {
      const [name, url] = frame.split('|') as [string, string];
      await writeFile(
        join(dir, `${arrow}-${name}.jpg`),
        Buffer.from(url.split(',')[1] ?? '', 'base64'),
      );
    }
  }
  return { max: frames.max, last: frames.last };
}

test.describe('arrow effects in the testbed', () => {
  test.setTimeout(120_000);

  test('AC-1: a water arrow bursts and leaves a wet decal at the 1.5 m radius', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    const seen = await watch(page, 'water', 2);
    expect(seen.max.impacts[0]).toMatchObject({ arrow: 'water', outcome: 'shatter' });
    expect(seen.max.decals.length).toBeGreaterThan(0);
    expect(seen.max.decals.every((radius) => radius === 1.5)).toBe(true);
    expect(seen.max.broken).toBeGreaterThan(0);
    expect(seen.max.particles).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });

  test('AC-3: a blunt arrow glances off the wall with sparks and heavy dust', async ({ page }) => {
    const problems = collectProblems(page);
    const seen = await watch(page, 'blunt', 2);
    expect(seen.max.impacts[0]).toMatchObject({ arrow: 'blunt', outcome: 'ricochet' });
    expect(seen.max.particles).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });

  test('a noise arrow pulses a ring where it lands', async ({ page }) => {
    const problems = collectProblems(page);
    const seen = await watch(page, 'noise', 2);
    expect(seen.max.rings).toBeGreaterThan(0);
    // Never more than two rings alive at once: the pulse stays under 2 Hz.
    expect(seen.max.rings).toBeLessThanOrEqual(2);
    expect(problems).toEqual([]);
  });

  test('a rope arrow that sticks unfurls its ribbon', async ({ page }) => {
    const problems = collectProblems(page);
    const seen = await watch(page, 'rope', 2);
    const outcome = seen.max.impacts[0]?.outcome;
    expect(outcome).toBeDefined();
    if (outcome === 'stick') expect(seen.max.ropes).toBeGreaterThan(0);
    else expect(seen.max.ropes).toBe(0);
    expect(problems).toEqual([]);
  });

  test('AC-2: an intact arrow that sticks in the target board wobbles', async ({ page }) => {
    const problems = collectProblems(page);
    const seen = await watch(page, 'standard', 2);
    expect(seen.max.impacts[0]).toMatchObject({ arrow: 'standard', outcome: 'stick' });
    expect(seen.max.wobbles).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test('a fire arrow burns with flames along its flight', async ({ page }) => {
    const problems = collectProblems(page);
    const seen = await watch(page, 'fire', 2);
    expect(seen.max.impacts.length).toBeGreaterThan(0);
    expect(seen.max.particles).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });
});
