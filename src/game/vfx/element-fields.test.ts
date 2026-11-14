import { describe, expect, it } from 'vitest';
import { compileElementFeedback, loadGameContent } from '@content/index';
import { ElementField, type Vec3 } from '@sim/index';
import { GAS_RANGE, GAS_SAMPLE_SECONDS, GasFieldPresenter } from './element-fields.ts';
import type { VfxSpawnOptions } from './system.ts';

const rules = compileElementFeedback(
  loadGameContent().get('element-feedback', 'element-feedback'),
).fields;
const CAMERA: Vec3 = { x: 0, y: 0, z: 0 };

function setup(field: ElementField | undefined, reduced = false) {
  const spawns: { effect: string; options: VfxSpawnOptions }[] = [];
  const stopped: number[] = [];
  const live = new Set<number>();
  let next = 1;
  const presenter = new GasFieldPresenter({
    rules,
    vfx: {
      spawn: (effect, options) => {
        spawns.push({ effect, options });
        live.add(next);
        return next++;
      },
      stop: (h) => {
        stopped.push(h);
        live.delete(h);
      },
      alive: (h) => live.has(h),
    },
    field: () => field,
    reducedMotion: () => reduced,
  });
  const tick = (camera = CAMERA) => {
    presenter.update(GAS_SAMPLE_SECONDS, camera);
  };
  return { presenter, spawns, stopped, live, tick };
}

describe('gas field visualisation (mw-e03.28)', () => {
  it('draws a cloud on each dense smoke cell, fuller where thicker, and releases it as it thins', () => {
    const field = new ElementField();
    field.set('gas:smoke', { x: 4, y: 1, z: 0 }, 0.9);
    field.set('gas:smoke', { x: 5, y: 1, z: 0 }, 0.2);
    field.set('gas:smoke', { x: 6, y: 1, z: 0 }, 0.01); // below the threshold
    const s = setup(field);
    s.tick();
    expect(s.spawns.map((x) => x.effect)).toEqual([
      'vfx-element-smoke-cloud',
      'vfx-element-smoke-cloud',
    ]);
    const [thick, thin] = s.spawns.map((x) => x.options.params?.intensity ?? 0);
    expect(thick).toBeGreaterThan(thin ?? 0);
    expect(s.spawns[0]?.options.scale).toBe(1);
    expect(s.presenter.clouds).toBe(2);
    s.tick();
    expect(s.spawns).toHaveLength(2); // unchanged: nothing respawns
    field.set('gas:smoke', { x: 4, y: 1, z: 0 }, 0);
    s.tick();
    expect(s.stopped).toHaveLength(1);
    expect(s.presenter.clouds).toBe(1);
  });

  it('a cloud respawns when its band changes; steam uses its own effect; reduced motion halves it', () => {
    const field = new ElementField();
    field.set('gas:steam', { x: 2, y: 1, z: 0 }, 0.2);
    const s = setup(field, true);
    s.tick();
    expect(s.spawns[0]?.effect).toBe('vfx-element-steam-cloud');
    const first = s.spawns[0]?.options.params?.intensity ?? 0;
    field.set('gas:steam', { x: 2, y: 1, z: 0 }, 0.95);
    s.tick();
    expect(s.spawns).toHaveLength(2);
    expect(s.stopped).toHaveLength(1);
    expect(s.spawns[1]?.options.params?.intensity ?? 0).toBeGreaterThan(first);
    expect(s.spawns[1]?.options.params?.intensity).toBeCloseTo(0.5);
  });

  it('keeps only the densest cells up to the cap, ignores far ones and samples a few times a second', () => {
    const field = new ElementField();
    const cap = rules.find((r) => r.gas === 'smoke')?.cap ?? 0;
    for (let i = 0; i < cap + 10; i++) {
      field.set('gas:smoke', { x: 2 + i, y: 1, z: 0 }, 0.3 + i * 0.001);
    }
    field.set('gas:smoke', { x: 2 * GAS_RANGE + 40, y: 1, z: 0 }, 1); // out of range
    const s = setup(field);
    s.presenter.update(GAS_SAMPLE_SECONDS, CAMERA);
    expect(s.spawns).toHaveLength(cap);
    // The 10 thinnest (the lowest x here) are the ones left out.
    const xs = s.spawns.map((x) => x.options.position?.x ?? 0);
    expect(Math.min(...xs)).toBeGreaterThan(2 * 0.5 + 10 * 0.5);
    // Half a sample interval later the field is not read again.
    field.set('gas:smoke', { x: 2, y: 1, z: 5 }, 1);
    s.presenter.update(GAS_SAMPLE_SECONDS / 2, CAMERA);
    expect(s.spawns).toHaveLength(cap);
  });

  it('ties in density are broken by distance, then by position, so the choice never wobbles', () => {
    const field = new ElementField();
    const cap = rules.find((r) => r.gas === 'smoke')?.cap ?? 0;
    // cap + 2 cells of equal density: two pairs are equidistant (x = ±k) and the rest differ.
    for (let i = 0; i < cap / 2 + 1; i++) {
      field.set('gas:smoke', { x: 4 + i, y: 1, z: 0 }, 0.5);
      field.set('gas:smoke', { x: -5 - i, y: 1, z: 0 }, 0.5);
    }
    const run = () => {
      const s = setup(field);
      s.tick();
      return s.spawns.map((x) => String(x.options.position?.x));
    };
    expect(run()).toEqual(run());
    expect(run()).toHaveLength(cap);
  });

  it('without a field there is nothing to draw, and refused spawns hold nothing', () => {
    const s = setup(undefined);
    s.tick();
    expect(s.presenter.clouds).toBe(0);
    const field = new ElementField();
    field.set('gas:smoke', { x: 2, y: 1, z: 0 }, 0.9);
    const refusing = new GasFieldPresenter({
      rules,
      vfx: { spawn: () => null, stop: () => undefined, alive: () => false },
      field: () => field,
      reducedMotion: () => false,
    });
    refusing.update(1, CAMERA);
    expect(refusing.clouds).toBe(0);
  });
});
