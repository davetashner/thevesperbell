import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// mw-e29.10: the spell VFX slots in the greybox testbed against the production build (Chromium).
// `?spells=<slot>` (or `demo` for every slot of both demo blocks in turn) shows the slots on stand-ins
// in front of the player and publishes what is drawn on #app[data-spell-vfx] (JSON). The page must draw
// with no console errors or warnings. Set E2E_SPELL_SHOTS to a directory to also save screenshots.

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface SpellProbe {
  step: number;
  block: string;
  slot: string;
  steps: number;
  started: number;
  casterHand: { x: number; y: number; z: number };
  areaRadius: number;
  dissolve: number;
  rings: number;
  beams: number;
}

test.use({ viewport: { width: 1024, height: 576 } });

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

async function probe(page: Page): Promise<SpellProbe> {
  const json = await page.locator('#app').getAttribute('data-spell-vfx');
  return JSON.parse(json ?? '{}') as SpellProbe;
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['E2E_SPELL_SHOTS'];
  if (dir === undefined) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

async function open(page: Page, spells: string): Promise<void> {
  await page.goto(`/?scene=testbed&spells=${spells}`);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 5_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-spell-vfx', /"started":/, { timeout: 10_000 });
}

test.describe('spell VFX testbed (mw-e29.10)', () => {
  test('AC-2: an area spell of radius 4 m draws a ring (the first block, then the tinted one)', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await open(page, 'area');
    await expect.poll(async () => (await probe(page)).rings).toBe(1);
    expect((await probe(page)).areaRadius).toBe(4);
    await page.waitForTimeout(1500); // the ring has grown out to its full radius
    await shot(page, 'area-arcane');
    expect(problems).toEqual([]);
  });

  test('AC-3: a beam is drawn and its start follows the strafing caster', async ({ page }) => {
    const problems = collectProblems(page);
    await open(page, 'beam');
    await expect.poll(async () => (await probe(page)).beams).toBe(1);
    const first = (await probe(page)).casterHand;
    await expect
      .poll(async () => {
        const hand = (await probe(page)).casterHand;
        return Math.hypot(hand.x - first.x, hand.y - first.y, hand.z - first.z);
      })
      .toBeGreaterThan(0.3);
    await shot(page, 'beam-arcane');
    expect(problems).toEqual([]);
  });

  test('the summon slot dissolves its body in and out', async ({ page }) => {
    const problems = collectProblems(page);
    await open(page, 'summon');
    await expect.poll(async () => (await probe(page)).dissolve).toBeLessThan(0.5);
    await shot(page, 'summon-arcane');
    expect(problems).toEqual([]);
  });

  test('the demo steps through the slots in cast order', async ({ page }) => {
    const problems = collectProblems(page);
    await open(page, 'demo');
    await expect
      .poll(async () => (await probe(page)).step, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);
    const now = await probe(page);
    const order = [
      'castWindup',
      'castRelease',
      'projectile',
      'impact',
      'area',
      'beam',
      'sustainOnTarget',
      'summon',
    ];
    expect(now.steps).toBe(16);
    expect(now.slot).toBe(order[now.step % order.length]);
    expect(problems).toEqual([]);
  });
});
