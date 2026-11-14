import { expect, test, type Page } from '@playwright/test';
import { navigate, openScreen, openUiPage, seriousAxeViolations } from './helpers/ui';
import { stubPointerLock, takeControl } from './helpers/player';

// mw-e31.10: difficulty presets and assists, against the production build (Chromium). The pause
// menu's Settings > Gameplay changes the preset with the keyboard; the sim's multipliers are read from
// #app[data-difficulty] ({choice, config, tick}); a change mid-game is applied by the sim and logged
// once as a local telemetry line; the choice survives a reload. Every wait is a poll on state.

interface Readout {
  choice: string;
  config: Record<string, number>;
  tick: number;
}

const POLL = { timeout: 30_000 };
const setting = (page: Page, key: string) => page.locator(`[data-setting="${key}"]`);

async function readout(page: Page): Promise<Readout> {
  const json = await page.locator('#app').getAttribute('data-difficulty');
  return JSON.parse(json ?? 'null') as Readout;
}

async function playSlice(page: Page): Promise<void> {
  await stubPointerLock(page);
  await page.goto('/?scene=slice&class=knight');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'slice', { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-pause', 'closed');
  await takeControl(page);
}

async function openGameplay(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-pause', 'open');
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('[data-screen="options"]')).toBeVisible();
  await page.locator('[role="tab"]', { hasText: 'Gameplay' }).click();
  await expect(setting(page, 'gameplay.difficulty')).toBeVisible();
}

async function resume(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-pause', 'closed');
  await takeControl(page);
}

/** Steps the Difficulty select with the keyboard until it reads `label`. */
async function choose(page: Page, label: string): Promise<void> {
  const control = setting(page, 'gameplay.difficulty');
  await control.focus();
  for (let i = 0; i < 4 && (await control.getAttribute('aria-valuetext')) !== label; i++) {
    await navigate(page, ['right']);
  }
  await expect(control).toHaveAttribute('aria-valuetext', label);
}

test('AC-1, AC-4: a preset picked in the pause menu reaches the sim, an assist makes it Custom, and it survives a reload', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const telemetry: string[] = [];
  page.on('console', (msg) => {
    if (msg.text().startsWith('telemetry ')) telemetry.push(msg.text());
  });
  await page.setViewportSize({ width: 390, height: 780 });
  await playSlice(page);

  // The default is Adventurer: the game as authored, every multiplier 1.
  const start = await readout(page);
  expect(start.choice).toBe('adventurer');
  expect(Object.values(start.config).every((value) => value === 1)).toBe(true);

  await openGameplay(page);
  await expect(setting(page, 'gameplay.difficulty')).toHaveAttribute(
    'aria-valuetext',
    'Adventurer',
  );
  await choose(page, 'Story');
  // Picking a preset fills the assists with its numbers.
  await expect(setting(page, 'gameplay.customDamageTaken')).toHaveAttribute(
    'aria-valuetext',
    '×0.5',
  );
  await expect(setting(page, 'gameplay.customParryWindow')).toHaveAttribute(
    'aria-valuetext',
    '×1.5',
  );
  // The panel fits the phone and the focus stays visible.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await resume(page);
  await expect.poll(async () => (await readout(page)).config['damageTaken'], POLL).toBe(0.5);
  const story = await readout(page);
  expect(story).toMatchObject({
    choice: 'story',
    config: { damageTaken: 0.5, parryWindow: 1.5, detectionSpeed: 0.6 },
  });
  // Each step of the select is one change, logged once, each from where the last one ended: the
  // keyboard passed Veteran on its way to Story.
  const events = telemetry.map(
    (line) => JSON.parse(line.slice('telemetry '.length)) as { from: string; to: string },
  );
  expect(events.length).toBeGreaterThanOrEqual(1);
  expect(events[0]?.from).toBe('adventurer');
  expect(events.at(-1)?.to).toBe('story');
  events.slice(1).forEach((event, i) => {
    expect(event.from).toBe(events[i]?.to);
  });
  const logged = events.length;

  // Mid-game: turning fall damage off is Custom, applied by the sim, logged once more.
  await openGameplay(page);
  const fall = setting(page, 'gameplay.customFallDamage');
  await fall.focus();
  await navigate(page, ['confirm']);
  await expect(fall).toHaveAttribute('aria-checked', 'false');
  await expect(setting(page, 'gameplay.difficulty')).toHaveAttribute('aria-valuetext', 'Custom');
  await resume(page);
  await expect.poll(async () => (await readout(page)).config['fallDamage'], POLL).toBe(0);
  expect((await readout(page)).choice).toBe('custom');
  expect((await readout(page)).config['damageTaken']).toBe(0.5);
  expect(telemetry).toHaveLength(logged + 1);

  // The choice is a per-browser setting: a fresh boot starts on it.
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-scene', 'slice', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-pause', 'closed');
  await expect.poll(async () => (await readout(page)).config['fallDamage'], POLL).toBe(0);
  expect(await readout(page)).toMatchObject({ choice: 'custom', config: { damageTaken: 0.5 } });
});

test('AC-1: at 390 px and 200% text the Gameplay options fit, with no serious accessibility violations', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openUiPage(page, '/testbed/ui.html?scale=2');
  await openScreen(page, 'options');
  await page.locator('[role="tab"]', { hasText: 'Gameplay' }).click();
  const rows = page.locator(
    '[data-screen="options"] [role="tabpanel"]:not([hidden]) [data-setting-row]',
  );
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(7);
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 390).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await seriousAxeViolations(page)).toEqual([]);
});
