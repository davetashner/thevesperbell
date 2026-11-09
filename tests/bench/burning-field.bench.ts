// mw-e03.52: the element field with many things burning. Two cases, each one iteration = the fire's
// hold of flame and smoke cells plus one `stepField`, the field's whole per-tick cost:
//
// - 40 burning crates standing in a room (the e2e's AC-4 scene): a few hundred awake chunks.
// - 24 burning props falling out of the world (the e2e once measured this by accident: crates
//   spawned past the room's edge fell for ever): each drops a column of held flames and trails a
//   heat tail behind it, about 1,250 awake chunks (1 M cell-channels) at the steady state.
//
// The field is run to its steady state first. Thresholds are per tick. On an M1 Pro, Node's speed
// varies from one run to the next (the process lands on fast or slow cores, and other jobs share
// the machine): over 6 runs the crates tick took 2.2 to 6.4 ms and the trail tick 14 to 38 ms, the
// fast end being what the kernel costs. The limits (15 and 60 ms) are about 6× and 4× the fast
// end and 1.6× the worst run seen, so a slow CI runner does not trip them and only a structural
// regression (a full scan, a rebuild, an allocation per chunk per tick) does. The chunk count is
// asserted to keep the scene honest.
import { describe, expect, test } from 'vitest';
import { ElementField, stepField } from '@sim/index';

// Bound once: the bench loop would otherwise hit the module's export getter on every call.
const step = stepField;
const FLAME = 600;

/** Holds a 3×3×3 block of flame cells (a crate's) with its corner at `at`, and puts smoke in it. */
function burn(field: ElementField, x: number, y: number, z: number): void {
  for (let dx = 0; dx < 3; dx++) {
    for (let dy = 0; dy < 3; dy++) {
      for (let dz = 0; dz < 3; dz++) {
        const cell = { x: x + dx, y: y + dy, z: z + dz };
        if (field.read('temperature', cell) < FLAME) field.set('temperature', cell, FLAME);
      }
    }
  }
  field.add('gas:smoke', { x: x + 1, y: y + 1, z: z + 1 }, 0.5);
}

describe('burning field', () => {
  test('40 burning crates in a room: a tick averages ≤ 15 ms', async ({ bench }) => {
    const field = new ElementField();
    // Five rows of eight crates, a metre apart (two cells), on the floor.
    const tick = (): void => {
      for (let i = 0; i < 40; i++) burn(field, (i % 8) * 2, 0, Math.floor(i / 8) * 2);
      step(field);
    };
    for (let i = 0; i < 300; i++) tick();
    const result = await bench('40 burning crates', tick).run();
    expect(field.chunkCount).toBeGreaterThan(50);
    expect(result.latency.mean).toBeLessThanOrEqual(15); // milliseconds
  });

  test('24 burning props falling out of the world: a tick averages ≤ 60 ms', async ({ bench }) => {
    const field = new ElementField();
    let fallen = 0;
    const tick = (): void => {
      for (let i = 0; i < 24; i++) burn(field, (i % 6) * 4, -fallen, Math.floor(i / 6) * 4);
      fallen++;
      step(field);
    };
    for (let i = 0; i < 450; i++) tick();
    const result = await bench('24 falling burning props', tick).run();
    expect(field.chunkCount).toBeGreaterThan(1000);
    expect(result.latency.mean).toBeLessThanOrEqual(60); // milliseconds
  });
});
