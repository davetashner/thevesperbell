import { describe, expect, it } from 'vitest';
import {
  installLatencyProbe,
  LatencyProbe,
  MOTION_EPSILON,
  PROBE_GLOBAL,
  type LatencyHost,
  type LatencyReport,
} from './latency-probe';

/** Frames every 16 ms from `from`, the player standing at x = 0 until `moveAt`, then walking. */
function walk(probe: LatencyProbe, from: number, until: number, moveAt: number): void {
  for (let t = from; t <= until; t += 16)
    probe.frame(t, t >= moveAt ? (t - moveAt) * 0.001 : 0, 0, 0);
}

describe('latency probe (mw-e02.8)', () => {
  it('AC-1: latency is keydown to the end of the first frame where the drawn position changed', () => {
    const probe = new LatencyProbe();
    walk(probe, 0, 96, Infinity); // standing still
    probe.keyDown(100);
    probe.frame(112, 0, 0, 0); // a frame that shows nothing yet
    probe.frame(128, 0.02, 0, 0); // the frame that does
    probe.frame(144, 0.04, 0, 0); // later motion adds nothing
    const { latency } = probe.report();
    expect(latency.samples).toEqual([28]);
    expect(latency.count).toBe(1);
    expect(latency.p95).toBe(28);
  });

  it('measures y and z motion too, and ignores a change below the epsilon', () => {
    const probe = new LatencyProbe();
    probe.frame(0, 0, 0, 0);
    probe.keyDown(1);
    probe.frame(10, MOTION_EPSILON / 2, 0, 0);
    expect(probe.report().latency.count).toBe(0);
    probe.frame(20, 0, MOTION_EPSILON * 2, 0);
    expect(probe.report().latency.samples).toEqual([19]);
    probe.frame(30, 0, MOTION_EPSILON * 2, 0); // stopped
    probe.keyDown(31);
    probe.frame(40, 0, MOTION_EPSILON * 2, 1);
    expect(probe.report().latency.samples).toEqual([19, 9]);
  });

  it('discards a press that lands while the player is still moving, and counts it', () => {
    const probe = new LatencyProbe();
    walk(probe, 0, 200, 100); // moving from 100 on
    probe.keyDown(200);
    walk(probe, 216, 300, 100);
    const report = probe.report();
    expect(report.discarded).toBe(1);
    expect(report.latency.count).toBe(0);
  });

  it('a press with no frame before it is measured against the first moving frame', () => {
    const probe = new LatencyProbe();
    probe.keyDown(5);
    probe.frame(10, 0, 0, 0);
    probe.frame(26, 1, 0, 0);
    expect(probe.report().latency.samples).toEqual([21]);
  });

  it('collects controller and camera costs, and resetCosts drops them but keeps latency', () => {
    const probe = new LatencyProbe();
    for (const ms of [0.1, 0.2, 0.3]) probe.controllerTick(ms);
    for (const ms of [0.05, 0.06]) probe.cameraFrame(ms);
    probe.frame(0, 0, 0, 0);
    probe.keyDown(1);
    probe.frame(5, 1, 0, 0);
    const before = probe.report();
    expect(before.controller).toMatchObject({ count: 3, max: 0.3 });
    expect(before.camera).toMatchObject({ count: 2, max: 0.06 });
    probe.resetCosts();
    const after = probe.report();
    expect(after.controller.count).toBe(0);
    expect(after.camera.count).toBe(0);
    expect(after.latency.samples).toEqual([4]);
  });

  it('install: move keys arm the probe on keydown, others and repeats do not, report is on the host', () => {
    const listeners: { type: string; fn: (event: Event) => void; capture: boolean }[] = [];
    const host: LatencyHost & Record<string, unknown> = {
      addEventListener: (type, fn, capture) => {
        listeners.push({ type, fn, capture });
      },
    };
    const probe = installLatencyProbe(host);
    expect(listeners).toHaveLength(1);
    expect(listeners[0]).toMatchObject({ type: 'keydown', capture: true });
    const press = (code: string, timeStamp: number, repeat = false) =>
      listeners[0]?.fn({ code, timeStamp, repeat } as unknown as Event);
    probe.frame(0, 0, 0, 0);
    press('KeyE', 10);
    press('KeyW', 20, true);
    probe.frame(30, 1, 0, 0);
    expect(probe.report().latency.count).toBe(0);
    probe.frame(40, 1, 0, 0);
    press('KeyW', 50);
    probe.frame(60, 2, 0, 0);
    const published = host[PROBE_GLOBAL] as {
      report(): LatencyReport;
      resetCosts(): void;
    };
    expect(published.report().latency.samples).toEqual([10]);
    probe.controllerTick(1);
    published.resetCosts();
    expect(published.report().controller.count).toBe(0);
  });
});
