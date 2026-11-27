import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';
import { collectProblems } from './helpers/slice';

// mw-e25.15: ride Mags Oakum's barge down from Briar Glen Quay to the Wendmouth Stone Wharf and back.
// The clock is set with the console (day 2, 08:00) and the player teleported beside Mags; the fare, the
// day that passes and the arrival all happen through her dialogue and the in-place area swap. The time
// advance is instant, so nothing waits on sim time. Built for a ~1 fps CI runner: every wait polls
// published state with a 30 s timeout.

const POLL = { timeout: 30_000 };
const ARRIVAL_BUDGET_MS = 3000;

interface Dialogue {
  open: boolean;
  npc: string | null;
  kind: 'line' | 'choice' | null;
  text: string;
  choices: { id?: string; text: string }[];
}

interface Arrival {
  kind: string;
  to: string;
  spawn: string;
  ms: number;
}

const dialogue = (page: Page): Promise<Dialogue> =>
  page.evaluate(
    () =>
      JSON.parse(
        document.querySelector<HTMLElement>('#app')?.dataset['dialogue'] ?? '{}',
      ) as Dialogue,
  );

const readout = <T>(page: Page, key: string): Promise<T> =>
  page.evaluate(
    (name) =>
      JSON.parse(document.querySelector<HTMLElement>('#app')?.dataset[name] ?? '{}') as unknown,
    key,
  ) as Promise<T>;

/** Presses Interact until Mags's dialogue is open, then continues her lines to the next choice. */
async function talkTo(page: Page, at: { x: number; z: number }): Promise<void> {
  await expect.poll(async () => Math.abs((await turnTo(page, at)).error), POLL).toBeLessThan(0.1);
  await expect
    .poll(async () => {
      const state = await dialogue(page);
      if (state.open && state.kind === 'choice') return true;
      if (!state.open) await page.keyboard.press('KeyE');
      else if (state.kind === 'line') await page.keyboard.press('Enter');
      return false;
    }, POLL)
    .toBe(true);
}

/** Continues her lines until the option starting with `prefix` is offered. */
async function continueTo(page: Page, prefix: string): Promise<void> {
  await expect
    .poll(async () => {
      const state = await dialogue(page);
      if (state.kind === 'choice' && state.choices.some((c) => c.text.startsWith(prefix)))
        return true;
      if (state.kind === 'line') await page.keyboard.press('Enter');
      return false;
    }, POLL)
    .toBe(true);
}

async function choose(page: Page, prefix: string): Promise<void> {
  const { choices } = await dialogue(page);
  const index = choices.findIndex((c) => c.text.startsWith(prefix));
  expect(index, `option "${prefix}" offered`).toBeGreaterThanOrEqual(0);
  await page.keyboard.press(`Digit${String(index + 1)}`);
}

async function arrived(page: Page, scene: string, spawn: string): Promise<Arrival> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', scene, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
  const arrival = await readout<Arrival>(page, 'transit');
  expect(arrival).toMatchObject({ kind: 'arrived', to: scene, spawn });
  return arrival;
}

/** The ride card opens on arrival; skip it. */
async function skipCard(page: Page, ride: string): Promise<void> {
  await expect(page.locator('#app')).toHaveAttribute(
    'data-barge-ride',
    new RegExp(`"ride":"${ride}"`),
    POLL,
  );
  await page.getByTestId('epilogue-slideshow').locator('[data-action="skip"]').click();
  await expect(page.locator('#app')).toHaveAttribute('data-barge-ride', /"open":false/, POLL);
}

test('AC-5: ride Mags’s barge from the quay down to the Stone Wharf and back, both arrivals quick and clean', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=briar-glen-river&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'briar-glen-river', { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-dialogue', /"open":false/, { timeout: 30_000 });
  await takeControl(page);
  await runConsole(page, 'time set 2 08:00');
  await runConsole(page, 'gold 20');

  // On the quay, a metre west of Mags by the gangplank.
  await runConsole(page, 'tp 66.5 0 -2.5');
  await talkTo(page, { x: 68, z: -2.5 });
  await choose(page, 'Can I book a ride');
  await continueTo(page, 'Four coins, down');
  await choose(page, 'Four coins, down');

  // Down the Wend: the Stone Wharf's barge berth, the ride card, a day later and four crowns lighter.
  const down = await arrived(page, 'wendmouth-harbour', 'barge-berth');
  await skipCard(page, 'downriver');
  await expect(app).toHaveAttribute('data-facts', /"time\.day":3/, POLL);
  await expect(app).toHaveAttribute('data-facts', /"barge\.ride":"none"/, POLL);

  // The way back: beside Mags at the foot of the Great Stair, upriver, two days, towed.
  await takeControl(page);
  await runConsole(page, 'tp -11.5 -2 106');
  await talkTo(page, { x: -9.5, z: 106 });
  await choose(page, 'Can I book a ride');
  await continueTo(page, 'Four coins, up');
  await choose(page, 'Four coins, up');
  const up = await arrived(page, 'briar-glen-river', 'barge-arrival');
  await skipCard(page, 'upriver');
  await expect(app).toHaveAttribute('data-facts', /"time\.day":5/, POLL);

  // AC-5: both arrivals reach their first playable frame within the warm budget.
  expect(down.ms).toBeLessThanOrEqual(ARRIVAL_BUDGET_MS);
  expect(up.ms).toBeLessThanOrEqual(ARRIVAL_BUDGET_MS);
  expect(problems).toEqual([]);
});
