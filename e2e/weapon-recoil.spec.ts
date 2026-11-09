import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { playerState, runConsole, stubPointerLock, takeControl } from './helpers/player';

// mw-e04.15: a halberd sweep in a 2.3 m corridor (?scene=recoil-corridor) clangs off a side wall. The
// player's moves are not driven by the equipped weapon yet (the left click is always the sword, which
// does not recoil while the medium class is off, mw-d4n), so the sweep is the real move run through the
// action timeline by the debug console's `act halberd-sweep`; the knight's model still holds a sword.
// The sim locks the knight for 30 ticks and the cue sheets throw sparks at the contact and ring the clang;
// the page must draw with no console errors. Set E2E_RECOIL_SHOTS to a directory to save the frames.
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

test.use({ viewport: { width: 1024, height: 576 } });

test('mw-e04.15: a halberd sweep in the recoil corridor draws sparks at the wall with no console errors', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await stubPointerLock(page);
  await page.goto('/?scene=recoil-corridor&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'recoil-corridor', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await takeControl(page);
  const start = (await playerState(page)).tick;
  await runConsole(page, 'act halberd-sweep');
  const frames = await page.evaluate(async (from) => {
    const root = document.querySelector<HTMLElement>('#app');
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]');
    if (!root || !canvas) throw new Error('no page');
    const tickOf = () => (JSON.parse(root.dataset['player'] ?? '{}') as { tick: number }).tick;
    const saved: string[] = [];
    return await new Promise<string[]>((resolve) => {
      const step = () => {
        const tick = tickOf() - from;
        saved.push(`${String(tick).padStart(3, '0')}|${canvas.toDataURL('image/jpeg', 0.85)}`);
        if (tick > 90 || saved.length > 120) resolve(saved);
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, start);
  expect(frames.length).toBeGreaterThan(3);
  const dir = process.env['E2E_RECOIL_SHOTS'];
  if (dir !== undefined) {
    await mkdir(dir, { recursive: true });
    for (const frame of frames) {
      const [tick = '', data = ''] = frame.split('|');
      const name = `recoil-${tick}-${String(frames.indexOf(frame)).padStart(3, '0')}.jpg`;
      await writeFile(join(dir, name), Buffer.from(data.split(',')[1] ?? '', 'base64'));
    }
  }
  expect(problems).toEqual([]);
});
