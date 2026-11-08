import { describe, expect, it } from 'vitest';
import { loadGameContent, vfxCueSheetSchema } from '@content/index';
import { addProperties, fireIgnited, registerWorldProperties, World } from '@sim/index';
import type { VfxSpawnOptions } from '../vfx/index.ts';
import { attachGameVfx } from './game-vfx.ts';

const content = loadGameContent();
const fireSheet = vfxCueSheetSchema.parse({
  id: 'fire-loop-test',
  notes: 'A looping flame, for the wiring test (the burning loop itself is the element bridge’s).',
  rules: [{ event: 'fireIgnited', layer: 'fire', effect: 'vfx-fire-burn-loop' }],
});

describe('game VFX wiring (mw-e29.3)', () => {
  it('spawns the shipped sheets’ effects for world events until detached', () => {
    const world = registerWorldProperties(new World({ seed: 1 }));
    const spawned: { effect: string; options: VfxSpawnOptions }[] = [];
    const off = attachGameVfx({
      world,
      vfx: {
        spawn: (effect, options) => spawned.push({ effect, options }),
        stop: () => undefined,
        alive: () => true,
        has: () => true,
      },
      sheets: [...content.all('vfx-cue-sheet'), fireSheet],
      materials: content.all('material'),
      arrows: content.all('arrow'),
      locate: () => ({ position: { x: 0, y: 0, z: 0 } }),
      now: () => world.tick * 1000,
      dev: false,
    });
    const crate = world.spawn();
    addProperties(world, crate, { material: 'dry-wood' });
    world.events.emit(fireIgnited, { entity: crate });
    world.events.flush();
    expect(spawned).toEqual([{ effect: 'vfx-fire-burn-loop', options: { entity: crate } }]);
    off();
    world.events.emit(fireIgnited, { entity: crate });
    world.events.flush();
    expect(spawned).toHaveLength(1);
    // Without optional sources it still attaches.
    attachGameVfx({
      world,
      vfx: { spawn: () => null, stop: () => undefined, alive: () => false, has: () => false },
      sheets: [],
      materials: [],
      locate: () => undefined,
      now: () => 0,
    })();
  });
});
