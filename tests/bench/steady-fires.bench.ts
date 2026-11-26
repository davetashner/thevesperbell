// mw-e32.20: steady decorative fires (lanterns, braziers) must stay cheap. Ten fires, each holding
// its flame cells at 600 °C and puffing smoke every tick as the fire rule does, run to a steady
// state; the bench then times one tick (hold + stepField). Measured 2026-11-26 (laptop, noisy): ~3.1 ms
// for ten fires before the convergence hysteresis, 14-25% less with it (302 of 385 chunks stepped
// per tick): each held flame spreads heat over ~38 chunks that never go exactly stationary. The
// assertion is a regression guard, not the AC-1 target.
import { describe, expect, test } from 'vitest';
import { ElementField, cellsInSphere, holdAtLeast, stepField } from '@sim/index';

const step = stepField;
const FIRES = 10;

function fireTick(field: ElementField, centers: readonly { x: number; y: number; z: number }[]) {
  for (const at of centers) {
    holdAtLeast(field, 'temperature', cellsInSphere(field, at, 0.5 + 0.75), 600);
    field.addAt('gas:smoke', at, 1 / 60);
  }
  return step(field);
}

describe('steady fires', () => {
  test(`${String(FIRES)} steady fires: one tick averages ≤ 15 ms`, async ({ bench }) => {
    const field = new ElementField();
    const centers = Array.from({ length: FIRES }, (_, i) => ({
      x: i * 6 + 1,
      y: 1,
      z: (i % 3) * 7,
    }));
    for (let i = 0; i < 600; i++) fireTick(field, centers);
    const result = await bench('steady fires tick', () => {
      fireTick(field, centers);
    }).run();
    expect(result.latency.mean).toBeLessThanOrEqual(15); // milliseconds
  });
});
