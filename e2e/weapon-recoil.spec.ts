import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { playerState, stubPointerLock, takeControl } from './helpers/player';

// mw-e04.15: a sword swing in a 2 m corridor (?scene=recoil-corridor) clangs off a side wall. The sim
// locks the knight for 30 ticks and the cue sheets throw sparks at the contact and ring the clang;
// the page must draw with no console errors. Set E2E_RECOIL_SHOTS to a directory to save the frames.
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

test.use({ viewport: { width: 1024, height: 576 } });

test('mw-e04.15: a sword swing in the recoil corridor draws sparks at the wall with no console errors', async ({
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
  await page.goto('/?scene=recoil-corridor');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'recoil-corridor', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await takeControl(page);
  const start = (await playerState(page)).tick;
  const frames = await page.evaluate(async (from) => {
    const root = document.querySelector<HTMLElement>('#app');
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]');
    if (!root || !canvas) throw new Error('no page');
    const tickOf = () => (JSON.parse(root.dataset['player'] ?? '{}') as { tick: number }).tick;
    const down = () => window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    const up = () => window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    down();
    const saved: string[] = [];
    let released = false;
    return await new Promise<string[]>((resolve) => {
      const step = () => {
        const tick = tickOf() - from;
        if (!released) {
          up();
          released = true;
        }
        saved.push(`${String(tick).padStart(3, '0')}|${canvas.toDataURL('image/jpeg', 0.85)}`);
        if (tick > 40 || saved.length > 120) resolve(saved);
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
