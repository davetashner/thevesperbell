// Wall-clock load flows for the perf suite's reference mode (mw-e41.8). Each used to be an assertion
// in a PR e2e spec (restart, death reload, Continue, front door, first frame); the e2e keeps the
// functional checks and these time the same moments with the same in-page hooks (a MutationObserver
// stamps the first sim step, so Playwright round trips never add to the measurement). The budgets are
// in perf/perf-budgets.json; they mean something only on the reference machine.
import { expect, type Page } from '@playwright/test';
import { collectProblems, data, run, SLICE_URL } from '../helpers/slice';
import { runConsole, stubPointerLock } from '../helpers/player';
import { throttled } from './harness';

export { collectProblems };

interface FlowWindow {
  /** When the sim first stepped on from a loaded save (Date.now()). */
  __flowLoadedPlayableAt?: number;
  /** When the sim first stepped in a world booted after the click on Restart area (Date.now()). */
  __flowRestartPlayableAt?: number;
}

/** On every page: stamps the first sim step after a loaded save and after a Restart area click. */
export async function installFlowHooks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as FlowWindow;
    new MutationObserver(() => {
      const app = document.querySelector<HTMLElement>('#app');
      const player = app?.dataset['player'];
      if (player === undefined) return;
      const tick = (JSON.parse(player) as { tick: number }).tick;
      const loaded = app?.dataset['loadedSave'];
      if (loaded !== undefined && w.__flowLoadedPlayableAt === undefined) {
        if (tick > (JSON.parse(loaded) as { tick: number }).tick) {
          w.__flowLoadedPlayableAt = Date.now();
        }
      }
      let stamp: string | null = null;
      try {
        stamp = sessionStorage.getItem('restartClickedAt');
      } catch {
        // No session storage: nothing to time.
      }
      if (stamp !== null && tick > 0 && w.__flowRestartPlayableAt === undefined) {
        w.__flowRestartPlayableAt = Date.now();
      }
    }).observe(document, { attributes: true, subtree: true });
  });
}

/** Waits for `scene` with the player standing in a running sim. */
export async function sceneReady(page: Page, scene: string): Promise<void> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', scene, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
}

/** Types `line` into the debug console and leaves it open (the death screen opens over it). */
async function typeLine(page: Page, line: string): Promise<void> {
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-console-input')).toBeFocused();
  await page.keyboard.insertText(line);
  await page.keyboard.press('Enter');
}

/** Saves in manual-1, kills the player and waits for the death screen (after the 90-tick beat). */
async function saveAndDie(page: Page, withSave: boolean): Promise<void> {
  if (withSave) {
    await run(page, 'save manual-1');
    await expect(page.locator('#app')).toHaveAttribute('data-saved-game', /"slot":"manual-1"/, {
      timeout: 60_000,
    });
  }
  await typeLine(page, 'kill');
  await expect(page.locator('[data-screen="death"]')).toBeVisible({ timeout: 120_000 });
}

async function loadedPlayableAt(page: Page): Promise<number> {
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as FlowWindow).__flowLoadedPlayableAt ?? null),
      { timeout: 60_000 },
    )
    .not.toBeNull();
  return page.evaluate(
    () => (window as unknown as FlowWindow).__flowLoadedPlayableAt ?? Number.NaN,
  );
}

/** Death → Load last save, warm: ms from the click (stamped in the hand-off) to the first sim step. */
export async function measureSaveLoad(page: Page, url: string, scene: string): Promise<number> {
  await installFlowHooks(page);
  await page.goto(url);
  await sceneReady(page, scene);
  await page.waitForLoadState('networkidle'); // warm the cache the reload will use
  await saveAndDie(page, true);
  await page
    .locator('[data-screen="death"]')
    .getByRole('button', { name: 'Load last save' })
    .click();
  await sceneReady(page, scene);
  await expect(page.locator('#app')).toHaveAttribute('data-loaded-save', /"hash"/, {
    timeout: 60_000,
  });
  const loaded = await data<{ requestedAt?: number | null }>(page, 'loaded-save');
  return (await loadedPlayableAt(page)) - (loaded.requestedAt ?? Number.NaN);
}

/** Save, reload through the front door, Continue, warm: ms from the press to the first sim step. */
export async function measureContinue(page: Page): Promise<number> {
  await installFlowHooks(page);
  await page.goto(SLICE_URL);
  await sceneReady(page, 'slice');
  await page.waitForLoadState('networkidle');
  await run(page, 'save manual-1');
  await expect(page.locator('#app')).toHaveAttribute('data-saved-game', /"slot":"manual-1"/, {
    timeout: 60_000,
  });
  await page.goto('/');
  const title = page.locator('[data-screen="title"]');
  await expect(title).toBeVisible({ timeout: 60_000 });
  await expect(title.getByRole('button', { name: 'Continue' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-loaded-save', /"hash"/, {
    timeout: 60_000,
  });
  const loaded = await data<{ requestedAt?: number | null }>(page, 'loaded-save');
  return (await loadedPlayableAt(page)) - (loaded.requestedAt ?? Number.NaN);
}

/** Death with no save → Restart area, warm: ms from the click to the first sim step of the new world. */
export async function measureRestart(page: Page): Promise<number> {
  await installFlowHooks(page);
  await page.goto(SLICE_URL);
  await sceneReady(page, 'slice');
  await page.waitForLoadState('networkidle');
  await saveAndDie(page, false);
  const reloaded = page.waitForEvent('load');
  await page.evaluate(() => {
    sessionStorage.setItem('restartClickedAt', String(Date.now()));
  });
  await page.locator('[data-screen="death"]').getByRole('button', { name: 'Restart area' }).click();
  await reloaded;
  await sceneReady(page, 'slice');
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as FlowWindow).__flowRestartPlayableAt ?? null),
      {
        timeout: 60_000,
      },
    )
    .not.toBeNull();
  return page.evaluate(
    () =>
      ((window as unknown as FlowWindow).__flowRestartPlayableAt ?? Number.NaN) -
      Number(sessionStorage.getItem('restartClickedAt')),
  );
}

/** Cold at 50 Mbps: title, New Game → Knight → Confirm, playable; ms leaving out the reading time. */
export async function measureFrontDoor(page: Page): Promise<number> {
  await stubPointerLock(page);
  await throttled(page, true);
  await page.goto('/');
  await page.locator('[data-screen="title"] button[data-action="new-game"]').click();
  await page.locator('[data-screen="class-select"] [role="radio"][data-class="knight"]').click();
  await page.locator('[data-screen="class-select"] [data-testid="class-confirm"]').click();
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-player-class', 'knight', { timeout: 60_000 });
  // The class arrival narration (mw-aw1y) opens after the class is applied; skip it.
  await expect(page.locator('[data-screen="class-beat"]')).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen]')).toHaveCount(0, { timeout: 60_000 });
  const frontDoor = await data<{ titleMs?: number; newGameMs?: number; playableMs?: number }>(
    page,
    'front-door',
  );
  const { titleMs, newGameMs, playableMs } = frontDoor;
  if (titleMs === undefined || newGameMs === undefined || playableMs === undefined) {
    throw new Error(`front door timings missing: ${JSON.stringify(frontDoor)}`);
  }
  return titleMs + (playableMs - newGameMs);
}

/** Warm reload of the front door: the page's own first-frame time, ms. */
export async function measureFirstFrameWarm(page: Page): Promise<number> {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-first-frame-ms', /^\d+$/, {
    timeout: 60_000,
  });
  await page.waitForLoadState('networkidle');
  await page.reload();
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-first-frame-ms', /^\d+$/, { timeout: 60_000 });
  return Number(await app.getAttribute('data-first-frame-ms'));
}

/**
 * Area transition, warm (mw-e01.11 AC-4): teleports into valley-01's north gate and reads
 * #app[data-transit].ms of the page that arrives in valley-02: wall-clock milliseconds from the
 * crossing on the old page to the new page's first playable frame.
 */
export async function measureTransition(page: Page): Promise<number> {
  await stubPointerLock(page);
  await page.goto('/?scene=valley-01&debug=1');
  await sceneReady(page, 'valley-01');
  await page.waitForLoadState('networkidle'); // warm the cache the next page uses
  await runConsole(page, 'tp 6 0 52.5');
  await sceneReady(page, 'valley-02');
  const arrived = await data<{ kind: string; ms: number }>(page, 'transit');
  if (arrived.kind !== 'arrived') throw new Error(`no arrival timing: ${JSON.stringify(arrived)}`);
  return arrived.ms;
}
