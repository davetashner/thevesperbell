// The perf budget suite's reference mode (mw-e32.1 AC-1): `pnpm perf:ref`, run by hand on the
// reference machine (contract §1: MacBook Pro M1 Pro, 16 GB, Chrome current). Headed Chrome, uncapped
// (vsync and the frame-rate limit off) so the frame interval is real CPU + GPU throughput, a
// 1280×720 viewport at DPR 2 (a 2560×1440 drawing buffer: High, 1440p-equivalent), 1,800 frames
// after a 3 s warm-up. Enforces the absolute frame-time budgets and writes
// perf/results/<date>-<sha>.json (e2e/perf/reporter.ts) to be committed. The numbers mean nothing
// on another machine.
import { test } from '@playwright/test';
import {
  measureContinue,
  measureFirstFrameWarm,
  measureFrontDoor,
  measureRestart,
  measureSaveLoad,
  measureTransition,
} from './flows';
import { SLICE_URL } from '../helpers/slice';
import {
  browserName,
  describeLongTasks,
  enforce,
  frameMeasurements,
  instrument,
  playableMs,
  SAMPLE_FRAMES,
  sampleFrames,
  throttled,
} from './harness';

/** Most seconds of sampling; enough for 1,800 frames at 10 fps, so a slow run fails on budget. */
const FRAME_CAP_S = Number(process.env['PERF_FRAME_CAP_S'] ?? '180');

test('AC-1: perf-baseline at High, 1440p-equivalent: frame time p95 ≤ 16.7 ms over 1,800 frames', async ({
  page,
}, testInfo) => {
  test.setTimeout((FRAME_CAP_S + 120) * 1_000);
  await instrument(page);
  const sample = await sampleFrames(page, {
    scene: 'perf-baseline',
    capS: FRAME_CAP_S,
    minSamples: SAMPLE_FRAMES,
    viewport: '1280×720 @2x',
  });
  console.log(describeLongTasks('perf-baseline sampling', sample.longTasks));
  await enforce(testInfo, 'reference', {
    browser: browserName(page),
    frames: sample.run,
    measurements: [
      ...frameMeasurements(sample),
      // A real GPU renders a frame in milliseconds: any task ≥ 200 ms here is a hitch.
      { metric: 'longTasksOver200ms', value: sample.longTasks.over200, scene: 'perf-baseline' },
    ],
  });
});

// The valley scenes (mw-ju8.2: the open-air levels with a backdrop card, the heaviest scenes in the
// game today) at both presets. High is the baseline's 1280×720 viewport at DPR 2 (2560×1440 buffer).
// Low is a 1920×1080 buffer at DPR 1 with `?quality=low`. That is the contract's Low resolution only:
// this machine is not the integrated GPU class Low targets (Iris Xe, base M1 8 GB), so a pass here
// says nothing about that class. The production build has no backdrop card (it loads only in dev
// until the images are approved), so these frames do not include it.
const VALLEYS = ['valley-01', 'valley-02', 'valley-03'] as const;
const PRESETS = {
  high: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, label: '1280×720 @2x' },
  low: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, label: '1920×1080 @1x' },
} as const;

for (const preset of ['high', 'low'] as const) {
  test.describe(`valleys at ${preset}`, () => {
    test.use({
      viewport: PRESETS[preset].viewport,
      deviceScaleFactor: PRESETS[preset].deviceScaleFactor,
    });
    for (const scene of VALLEYS) {
      test(`AC-1: ${scene} at ${preset}: frame time p95 ≤ 16.7 ms over 1,800 frames`, async ({
        page,
      }, testInfo) => {
        test.setTimeout((FRAME_CAP_S + 120) * 1_000);
        await instrument(page);
        const sample = await sampleFrames(page, {
          scene,
          preset,
          capS: FRAME_CAP_S,
          minSamples: SAMPLE_FRAMES,
          viewport: PRESETS[preset].label,
        });
        console.log(describeLongTasks(`${scene} ${preset} sampling`, sample.longTasks));
        await enforce(testInfo, 'reference', {
          browser: browserName(page),
          frames: sample.run,
          measurements: [
            ...frameMeasurements(sample),
            {
              metric: 'longTasksOver200ms',
              value: sample.longTasks.over200,
              scene,
              preset,
            },
          ],
        });
      });
    }
  });
}

// The Briarwood greybox (mw-e25.1 AC-4: 300 × 250 m of placeholder trunks and bramble gates) at the High
// preset, the same sampling as the valleys. Reference machine only.
test.describe('briarwood at high', () => {
  test.use({
    viewport: PRESETS.high.viewport,
    deviceScaleFactor: PRESETS.high.deviceScaleFactor,
  });
  test('AC-4: briarwood at high: frame time p95 ≤ 16.7 ms over 1,800 frames', async ({
    page,
  }, testInfo) => {
    test.setTimeout((FRAME_CAP_S + 120) * 1_000);
    await instrument(page);
    const sample = await sampleFrames(page, {
      scene: 'briarwood',
      preset: 'high',
      capS: FRAME_CAP_S,
      minSamples: SAMPLE_FRAMES,
      viewport: PRESETS.high.label,
    });
    console.log(describeLongTasks('briarwood high sampling', sample.longTasks));
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      frames: sample.run,
      measurements: [
        ...frameMeasurements(sample),
        {
          metric: 'longTasksOver200ms',
          value: sample.longTasks.over200,
          scene: 'briarwood',
          preset: 'high',
        },
      ],
    });
  });
});

// The Briar Glen grey-box town (mw-e24.2 AC-4: 180 × 140 m, viewed from Market Green) at the High
// preset, the same sampling as the Briarwood. Reference machine only.
test.describe('briar-glen-green at high', () => {
  test.use({
    viewport: PRESETS.high.viewport,
    deviceScaleFactor: PRESETS.high.deviceScaleFactor,
  });
  test('AC-4: the town from Market Green at high: frame time p95 ≤ 16.7 ms over 1,800 frames', async ({
    page,
  }, testInfo) => {
    test.setTimeout((FRAME_CAP_S + 120) * 1_000);
    await instrument(page);
    const sample = await sampleFrames(page, {
      scene: 'briar-glen-green',
      preset: 'high',
      capS: FRAME_CAP_S,
      minSamples: SAMPLE_FRAMES,
      viewport: PRESETS.high.label,
    });
    console.log(describeLongTasks('briar-glen-green high sampling', sample.longTasks));
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      frames: sample.run,
      measurements: [
        ...frameMeasurements(sample),
        {
          metric: 'longTasksOver200ms',
          value: sample.longTasks.over200,
          scene: 'briar-glen-green',
          preset: 'high',
        },
      ],
    });
  });
});

// Mooring's Watch (mw-e25.6 AC-3: 180 × 100 m, viewed from the tower roof over the valley) at the High
// preset, the same sampling as the Briarwood. Reference machine only.
test.describe('moorings-watch at high', () => {
  test.use({
    viewport: PRESETS.high.viewport,
    deviceScaleFactor: PRESETS.high.deviceScaleFactor,
  });
  test('AC-3: the roof view over the valley at high: frame time p95 ≤ 16.7 ms over 1,800 frames', async ({
    page,
  }, testInfo) => {
    test.setTimeout((FRAME_CAP_S + 120) * 1_000);
    await instrument(page);
    const sample = await sampleFrames(page, {
      scene: 'moorings-watch',
      spawn: 'roof-view',
      preset: 'high',
      capS: FRAME_CAP_S,
      minSamples: SAMPLE_FRAMES,
      viewport: PRESETS.high.label,
    });
    console.log(describeLongTasks('moorings-watch high sampling', sample.longTasks));
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      frames: sample.run,
      measurements: [
        ...frameMeasurements(sample),
        {
          metric: 'longTasksOver200ms',
          value: sample.longTasks.over200,
          scene: 'moorings-watch',
          preset: 'high',
        },
      ],
    });
  });
});

// Bellwater Priory (mw-e26.5 AC-3: 120 × 130 m, viewed from the belfry deck over the nave) at the High
// preset, the same sampling as Mooring's Watch. Reference machine only.
test.describe('bellwater-priory at high', () => {
  test.use({
    viewport: PRESETS.high.viewport,
    deviceScaleFactor: PRESETS.high.deviceScaleFactor,
  });
  test('AC-3: the belfry view over the nave at high: frame time p95 ≤ 16.7 ms over 1,800 frames', async ({
    page,
  }, testInfo) => {
    test.setTimeout((FRAME_CAP_S + 120) * 1_000);
    await instrument(page);
    const sample = await sampleFrames(page, {
      scene: 'bellwater-priory',
      spawn: 'belfry-view',
      preset: 'high',
      capS: FRAME_CAP_S,
      minSamples: SAMPLE_FRAMES,
      viewport: PRESETS.high.label,
    });
    console.log(describeLongTasks('bellwater-priory high sampling', sample.longTasks));
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      frames: sample.run,
      measurements: [
        ...frameMeasurements(sample),
        {
          metric: 'longTasksOver200ms',
          value: sample.longTasks.over200,
          scene: 'bellwater-priory',
          preset: 'high',
        },
      ],
    });
  });
});

// The Deepworks (mw-e26.2 AC-3: about 220 × 335 m over three levels, viewed from the south end of the cutting hall) at the High
// preset, the same sampling as Mooring's Watch. Reference machine only.
test.describe('deepworks at high', () => {
  test.use({
    viewport: PRESETS.high.viewport,
    deviceScaleFactor: PRESETS.high.deviceScaleFactor,
  });
  test('AC-3: the cutting hall view at high: frame time p95 ≤ 16.7 ms over 1,800 frames', async ({
    page,
  }, testInfo) => {
    test.setTimeout((FRAME_CAP_S + 120) * 1_000);
    await instrument(page);
    const sample = await sampleFrames(page, {
      scene: 'deepworks',
      spawn: 'cutting-hall-view',
      preset: 'high',
      capS: FRAME_CAP_S,
      minSamples: SAMPLE_FRAMES,
      viewport: PRESETS.high.label,
    });
    console.log(describeLongTasks('deepworks high sampling', sample.longTasks));
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      frames: sample.run,
      measurements: [
        ...frameMeasurements(sample),
        {
          metric: 'longTasksOver200ms',
          value: sample.longTasks.over200,
          scene: 'deepworks',
          preset: 'high',
        },
      ],
    });
  });
});

// The wall-clock load budgets that used to be PR e2e assertions (mw-e41.8): same moments, measured
// in the page, enforced here against the reference machine. Budgets: perf/perf-budgets.json.
test.describe('load budgets', () => {
  test.setTimeout(240_000);

  test('slice: cold load to playable at 50 Mbps ≤ 10 s', async ({ page }, testInfo) => {
    await instrument(page);
    await throttled(page, true);
    await page.goto(SLICE_URL);
    const value = await playableMs(page, 60_000);
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [{ metric: 'loadToPlayableMs', value, scene: 'slice' }],
    });
  });

  test('front door: New Game → Knight → Confirm playable ≤ 10 s of page load at 50 Mbps', async ({
    page,
  }, testInfo) => {
    const value = await measureFrontDoor(page);
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [{ metric: 'frontDoorLoadMs', value, scene: 'slice' }],
    });
  });

  test('front door: first frame on a warm reload ≤ 3 s', async ({ page }, testInfo) => {
    const value = await measureFirstFrameWarm(page);
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [{ metric: 'firstFrameMs', value, scene: 'front-door' }],
    });
  });

  test('testbed: death → Load last save playable ≤ 3 s warm', async ({ page }, testInfo) => {
    const value = await measureSaveLoad(page, '/?scene=testbed&debug=1', 'testbed');
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [{ metric: 'saveLoadToPlayableMs', value, scene: 'testbed' }],
    });
  });

  test('slice: death → Load last save playable ≤ 3 s warm', async ({ page }, testInfo) => {
    const value = await measureSaveLoad(page, '/?scene=slice&debug=1', 'slice');
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [{ metric: 'saveLoadToPlayableMs', value, scene: 'slice' }],
    });
  });

  test('slice: title Continue playable ≤ 3 s warm', async ({ page }, testInfo) => {
    const value = await measureContinue(page);
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [{ metric: 'continueToPlayableMs', value, scene: 'slice' }],
    });
  });

  test('slice: Restart area playable ≤ 3 s warm', async ({ page }, testInfo) => {
    const value = await measureRestart(page);
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [{ metric: 'restartToPlayableMs', value, scene: 'slice' }],
    });
  });

  test('valley-01 → valley-02: area transition playable ≤ 3 s warm', async ({ page }, testInfo) => {
    const value = await measureTransition(page);
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [{ metric: 'transitionToPlayableMs', value, scene: 'valley-02' }],
    });
  });
});

// Wendmouth Harbour (mw-e40.1 AC-4: 200 × 160 m, viewed from the Stone Wharf along the quay) at the High
// preset, the same sampling as the priory. Reference machine only.
test.describe('wendmouth-harbour at high', () => {
  test.use({
    viewport: PRESETS.high.viewport,
    deviceScaleFactor: PRESETS.high.deviceScaleFactor,
  });
  test('AC-4: the Stone Wharf view at high: frame time p95 ≤ 16.7 ms over 1,800 frames', async ({
    page,
  }, testInfo) => {
    test.setTimeout((FRAME_CAP_S + 120) * 1_000);
    await instrument(page);
    const sample = await sampleFrames(page, {
      scene: 'wendmouth-harbour',
      spawn: 'wharf-view',
      preset: 'high',
      capS: FRAME_CAP_S,
      minSamples: SAMPLE_FRAMES,
      viewport: PRESETS.high.label,
    });
    console.log(describeLongTasks('wendmouth-harbour high sampling', sample.longTasks));
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      frames: sample.run,
      measurements: [
        ...frameMeasurements(sample),
        {
          metric: 'longTasksOver200ms',
          value: sample.longTasks.over200,
          scene: 'wendmouth-harbour',
          preset: 'high',
        },
      ],
    });
  });
});
