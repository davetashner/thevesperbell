import { readdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { attachFrame, captureFrame, distinct } from './canvas';

// Shared by the scenes*.spec.ts files (mw-e00.21: greybox scenes, the ?scene= picker and the debug
// fly camera, against the production build).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

/**
 * Every scene id in the content (one JSON file per scene): the game's, plus the dev-only scenes a
 * debug build adds (mw-e12.4; the e2e build has the debug console built in).
 */
export const SCENES = ['src/content/data/scene', 'src/content/fixtures/dev/scene']
  .flatMap((dir) => readdirSync(dir))
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length))
  .sort();

/** Console errors/warnings and uncaught exceptions raised by our own code. */
export function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

/** Resolves after the page has rendered two more animation frames. */
export async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

export interface CameraData {
  position: number[];
  quaternion: number[];
}

/**
 * q and -q are the same rotation: flip the sign so the first non-zero of w, x, y, z is positive, so
 * equal rotations compare equal.
 */
export function canonical(q: number[]): number[] {
  const [x = 0, y = 0, z = 0, w = 0] = q;
  const lead = [w, x, y, z].find((n) => n !== 0) ?? 0;
  return lead < 0 ? q.map((n) => (n === 0 ? 0 : -n)) : q;
}

export async function cameraData(page: Page): Promise<CameraData> {
  const json = await page.locator('#app').getAttribute('data-camera');
  return JSON.parse(json ?? 'null') as CameraData;
}

/** Number of distinct colours on a coarse grid of the canvas; the frame is attached as `name`. */
export async function distinctColours(page: Page, name: string): Promise<number> {
  const frame = await captureFrame(page, { png: true });
  await attachFrame(test.info(), name, frame);
  return distinct(frame);
}
