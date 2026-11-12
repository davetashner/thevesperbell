import { expect, test, type Page } from '@playwright/test';
import { playerState, runConsole, stubPointerLock } from './helpers/player';
import { collectProblems, data, SLICE_URL } from './helpers/slice';

// mw-e24.21: one journey from a new game. The slice's vestibule opens on a short passage; its
// mountain-road volume leads to valley-01, whose south gate leads back, and the valley's own gates
// lead on to valley-02, valley-03 and Briar Glen Lane. The player teleports inside a scene (one page
// evaluation each, see e2e/transitions.spec.ts) and crosses by the transition volumes alone. Built
// for a ~1 fps CI runner: state polls with 30 s timeouts, no wall-clock assertions.

async function ready(page: Page, scene: string): Promise<void> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', scene, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
}

/** Runs `line` (a teleport into a transition volume) and waits for the page to reload into `scene`. */
async function crossBy(page: Page, line: string, scene: string): Promise<void> {
  await runConsole(page, line).catch((error: unknown) => {
    // The reload tears the page down under the console line's own evaluation: expected.
    if (!/Execution context was destroyed|navigation|closed/i.test(String(error))) throw error;
  });
  await page.waitForURL(new RegExp(`scene=${scene}(&|$)`), { timeout: 90_000 });
  await ready(page, scene);
}

test('AC-3: slice vestibule, valley-01, back, then valley-02, valley-03 and the lane by transitions alone', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto(SLICE_URL);
  await ready(page, 'slice');
  const app = page.locator('#app');

  // Into the vestibule (the pass), then the card's Continue hands the knight back.
  // The card opens a frame after the pass and refuses the pointer lock runConsole waits for, so
  // this one line goes through the console key by key and is not waited on to close.
  await expect(app).toHaveAttribute('data-debug-console', 'closed', { timeout: 30_000 });
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-console-input')).toBeFocused();
  await page.keyboard.insertText('tp 0 0 38.75');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await data<Record<string, unknown>>(page, 'facts'))['slice.complete'], {
      timeout: 30_000,
    })
    .toBe(true);
  const card = page.getByTestId('slice-complete');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('slice-complete-continue').click();
  await expect(card).toHaveCount(0, { timeout: 30_000 });
  if ((await app.getAttribute('data-debug-console')) !== 'closed')
    await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-debug-console', 'closed', { timeout: 30_000 });

  // AC-1: past the vestibule, the mountain road: valley-01 at its arrival spawn.
  await crossBy(page, 'tp 0 0 45', 'valley-01');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"valley-01".*"spawn":"arrive-from-slice"/,
  );
  const arrived = await playerState(page);
  expect(arrived.position.x).toBeCloseTo(0, 0);
  expect(arrived.position.z).toBeGreaterThan(3);
  expect(arrived.position.z).toBeLessThan(5);
  await expect(app).toHaveAttribute('data-autosave', /"kind":"area-transition"/, {
    timeout: 60_000,
  });

  // AC-2: back through valley-01's start to the vestibule passage, the pass still counted.
  await crossBy(page, 'tp 0 0 1', 'slice');
  const back = await playerState(page);
  expect(back.position.z).toBeGreaterThan(41);
  expect(back.position.z).toBeLessThan(43);
  expect((await data<Record<string, unknown>>(page, 'facts'))['slice.complete']).toBe(true);
  await expect(page.getByTestId('slice-complete')).toHaveCount(0);

  // And on again: valley-01 north gate, valley-02 north gate, valley-03 bridge gate.
  await crossBy(page, 'tp 0 0 45', 'valley-01');
  await crossBy(page, 'tp 6 0 52.5', 'valley-02');
  await crossBy(page, 'tp 0 0 46', 'valley-03');
  await crossBy(page, 'tp 0 0 56', 'briar-glen-lane');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"briar-glen-lane".*"spawn":"arrive-from-valley-03"/,
  );
  expect(problems).toEqual([]);
});
