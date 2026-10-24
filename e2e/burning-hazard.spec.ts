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

// mw-b1a AC-2 (and mw-akb): in the testbed the player sets the loose crate alight with Ember (the
// crate has no temperature of its own in scene data: its wood material gives it one), walks up to
// the fire and stands in it. The frame-data HUD (?frames) shows the hazard damage: the knight's
// world column reads "hazard N" and its health drops. Set E2E_FIRE_SHOT to a file path to also save
// a screenshot of the burning crate.

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

/** The loose crate (src/content/data/scene/testbed.json). */
const CRATE = { x: -1, z: -2 };

interface Fighter {
  role: 'player' | 'attacker' | 'dummy';
  health: { current: number; max: number } | null;
  environment: { kind: string; amount: number; tick: number } | null;
}

async function knight(page: Page): Promise<Fighter | undefined> {
  const json = await page.locator('#app').getAttribute('data-frame-data');
  const data = JSON.parse(json ?? 'null') as { fighters: Fighter[] } | null;
  return data?.fighters.find((f) => f.role === 'player');
}

async function burningHits(page: Page): Promise<boolean> {
  const json = await page.locator('#app').getAttribute('data-spells');
  const data = JSON.parse(json ?? 'null') as { hits: { spawn: string | null; burning: boolean }[] };
  return data.hits.some((hit) => hit.spawn === 'loose-crate' && hit.burning);
}

test('AC-2: standing in a fire shows hazard damage on the frame-data HUD', async ({ page }) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await stubPointerLock(page);
  await page.goto('/?scene=testbed&frames&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-frame-data', /"role":"player"/);
  await expect(app).toHaveAttribute('data-debug-console', 'closed');
  await takeControl(page);
  const before = await knight(page);
  expect(before?.environment).toBeNull();

  // Learn Ember, stand 3.5 m south of the crate, tip the view down onto it and cast.
  await runConsole(page, 'spell learn ember');
  await expect
    .poll(
      async () =>
        (
          JSON.parse((await app.getAttribute('data-spells')) ?? 'null') as {
            selected: string | null;
          }
        ).selected,
      {
        timeout: 15_000,
      },
    )
    .toBe('ember');
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
  await expect.poll(() => burningHits(page), { timeout: 30_000 }).toBe(true);

  // Walk into the fire.
  await runConsole(page, `tp ${String(CRATE.x)} 0 ${String(CRATE.z + 1.2)}`);
  await expect
    .poll(async () => (await knight(page))?.environment?.kind, { timeout: 30_000 })
    .toBe('hazard');
  const after = await knight(page);
  expect(after?.health?.current).toBeLessThan(after?.health?.max ?? 0);
  await expect(page.getByTestId('frame-data').locator('td[data-col="world"]').first()).toHaveText(
    /^hazard \d/,
  );
  const shot = process.env['E2E_FIRE_SHOT'];
  if (shot !== undefined) await page.screenshot({ path: shot });
  expect(problems).toEqual([]);
});
