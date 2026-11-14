import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { registerWorldProperties } from '../properties/components';
import { hashWorld } from '../snapshot';
import { applyStimulus, installStimuli, stimulusSystem } from '../stimulus/stimulus';
import type { FieldStepReport } from './diffusion';
import {
  ElementFieldComponent,
  elementFieldOf,
  elementFieldSystem,
  installElementField,
} from './install';

const v = (x: number, y = 0, z = 0) => ({ x, y, z });

function world(reports?: FieldStepReport[]) {
  const w = installElementField(
    installStimuli(registerWorldProperties(new World<never>({ seed: 7 }))),
    {
      maxChunks: 64,
    },
  );
  w.addSystem(stimulusSystem()).addSystem(elementFieldSystem((report) => reports?.push(report)));
  return w;
}

/** A small scene inside one chunk: a sealed room, a lingering fire, a gas leak and a splash. */
function scene(w: World<never>) {
  const field = elementFieldOf(w);
  for (const axis of ['x', 'y', 'z'] as const) {
    for (const side of [0.75, 3.25]) {
      field.setConductivity(
        {
          min: { ...v(0.75, 0.75, 0.75), [axis]: side },
          max: { ...v(3.25, 3.25, 3.25), [axis]: side },
        },
        0,
      );
    }
  }
  applyStimulus(w, {
    shape: { kind: 'sphere', center: v(2, 2, 2), radius: 0.8 },
    element: 'heat',
    intensity: 400,
    duration: 2,
  });
  applyStimulus(w, {
    shape: { kind: 'point', at: v(1.3, 1.3, 1.3) },
    element: 'gas',
    gas: 'smoke',
    intensity: 1,
    duration: 1,
  });
  applyStimulus(w, {
    shape: { kind: 'box', center: v(2.75, 1.25, 1.25), halfExtents: v(0.3, 0.3, 0.3) },
    element: 'water',
    intensity: 0.8,
  });
}

function steps(w: World<never>, n: number) {
  for (let i = 0; i < n; i++) w.step();
}

describe('installElementField', () => {
  it('applies resolved stimuli to the field and steps it once per tick', () => {
    const reports: FieldStepReport[] = [];
    const w = world(reports);
    scene(w);
    w.step();
    const field = elementFieldOf(w);
    expect(field.readAt('temperature', v(2, 2, 2))).toBeGreaterThan(20);
    expect(field.readAt('gas:smoke', v(1.3, 1.3, 1.3))).toBeGreaterThan(0);
    expect(field.readAt('moisture', v(2.75, 1.25, 1.25))).toBeGreaterThan(0);
    expect(field.chunkCount).toBe(1);
    expect(reports).toHaveLength(1);
    expect(w.snapshot().components[ElementFieldComponent.name]).toHaveLength(1);
  });

  // The AC fixes the length: 2,000 world ticks take ~1 s alone, several under a loaded coverage run.
  it(
    'AC-4: the same initial field stepped 1,000 ticks twice gives identical hashes',
    { timeout: 20_000 },
    () => {
      const a = world();
      const b = world();
      scene(a);
      scene(b);
      steps(a, 1000);
      steps(b, 1000);
      expect(hashWorld(a)).toBe(hashWorld(b));
      expect(elementFieldOf(a).chunkCount).toBe(1);
      expect(elementFieldOf(a).readAt('gas:smoke', v(2.75, 2.75, 2.75))).toBeGreaterThan(0);
    },
  );

  it('AC-4: a snapshot restored mid-run continues to the same hash', () => {
    const a = world();
    scene(a);
    steps(a, 30);
    const saved = structuredClone(a.snapshot());
    steps(a, 70);
    const b = world();
    b.restore(saved);
    steps(b, 70);
    expect(hashWorld(b)).toBe(hashWorld(a));
  });

  it('AC-5: a stimulus 1 km away allocates one new chunk and leaves the others untouched', () => {
    const w = installElementField(
      installStimuli(registerWorldProperties(new World<never>({ seed: 1 }))),
      {
        maxChunks: 2,
      },
    );
    w.addSystem(stimulusSystem());
    const field = elementFieldOf(w);
    field.addAt('temperature', v(0), 50);
    const near = field.serialize().chunks;
    applyStimulus(w, {
      shape: { kind: 'point', at: v(1000, 3, -2) },
      element: 'heat',
      intensity: 10,
    });
    w.step();
    expect(field.chunkCount).toBe(2);
    expect(field.readAt('temperature', v(1000, 3, -2))).toBe(30);
    expect(field.serialize().chunks.filter((c) => c.at[0] === 0)).toEqual(near);
    applyStimulus(w, { shape: { kind: 'point', at: v(-1000) }, element: 'heat', intensity: 10 });
    w.step();
    expect(field.chunkCount).toBe(2); // the cap bounds memory: the write is dropped
    expect(field.readAt('temperature', v(-1000))).toBe(20);
  });

  it('throws when no field is installed', () => {
    const w = new World<never>({ seed: 1 }).register(ElementFieldComponent);
    expect(() => elementFieldOf(w)).toThrow(/no element field/);
  });

  it('steps without a report callback', () => {
    const w = installElementField(new World<never>({ seed: 1 }));
    w.addSystem(elementFieldSystem());
    elementFieldOf(w).addAt('charge', v(0), 1);
    w.step();
    expect(elementFieldOf(w).total('charge')).toBeLessThan(1); // charge decays by default
  });

  it('mw-e03.30: with a focus, far chunks step on every 4th tick only (and any tick without one)', () => {
    const run = (focus?: () => { x: number; y: number; z: number } | undefined) => {
      const w = installElementField(new World<never>({ seed: 1 }), { maxChunks: 1 });
      w.addSystem(elementFieldSystem(undefined, focus));
      elementFieldOf(w).add('moisture', { x: 120, y: 0, z: 0 }, 1);
      const seen: number[] = [];
      for (let i = 0; i < 8; i++) {
        w.step();
        seen.push(elementFieldOf(w).read('moisture', { x: 120, y: 0, z: 0 }));
      }
      return seen.filter((value, i) => value !== (seen[i - 1] ?? 1)).length;
    };
    expect(run()).toBe(8);
    expect(run(() => undefined)).toBe(8);
    expect(run(() => ({ x: 0, y: 0, z: 0 }))).toBe(2);
  });
});
