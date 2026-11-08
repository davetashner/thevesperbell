// Mage Hand's use and let-go inputs (mw-e08.25): the cast controller's commands while a tether is held.
import { describe, expect, it } from 'vitest';
import {
  actionButton,
  actionFrame,
  actionVector,
  installSpellHotbar,
  KnownSpellsComponent,
  World,
  type ActionFrame,
  type ButtonAction,
} from '@sim/index';
import { SpellCaster } from './caster';
import type { AimRay } from './aim';

const frameOf = (pressed: ButtonAction[] = [], held: ButtonAction[] = []): ActionFrame =>
  actionFrame({
    move: actionVector(0, 0),
    look: actionVector(0, 0),
    buttons: (a) =>
      actionButton(pressed.includes(a), held.includes(a) || pressed.includes(a), false),
  });

const ray = (): AimRay => ({
  origin: { x: 0, y: 2, z: 0 },
  direction: { x: 0, y: 0, z: -1 },
});

function rig(tethering: boolean | undefined) {
  const world = new World<never>({ seed: 1 });
  world.register(KnownSpellsComponent);
  installSpellHotbar(world);
  const hero = world.spawn();
  world.add(hero, KnownSpellsComponent, { spells: [] });
  const caster = new SpellCaster({
    world,
    caster: hero,
    spells: () => undefined,
    collision: {} as never,
    ...(tethering !== undefined && { tethering: () => tethering }),
  });
  return { caster, hero };
}

describe('Mage Hand inputs', () => {
  it('interact while tethering issues tether-use and is taken out of the frame', () => {
    const { caster, hero } = rig(true);
    const f = frameOf(['interact']);
    expect(caster.commands(f, ray)).toEqual([{ type: 'tether-use', caster: hero }]);
    expect(caster.shape(f).interact).toEqual({ pressed: false, held: false, released: false });
    expect(caster.shape(f).cast).toBe(f.cast);
  });

  it('AC-2: the cancel input while tethering issues tether-release after cancel-cast', () => {
    const { caster, hero } = rig(true);
    expect(caster.commands(frameOf(['cancelCast']), ray)).toEqual([
      { type: 'cancel-cast', caster: hero },
      { type: 'tether-release', caster: hero },
    ]);
  });

  it('without a tether interact is left alone and cancel only cancels the cast', () => {
    for (const tethering of [false, undefined]) {
      const { caster, hero } = rig(tethering);
      const f = frameOf(['interact']);
      expect(caster.commands(f, ray)).toEqual([]);
      expect(caster.shape(f)).toBe(f);
      expect(caster.commands(frameOf(['cancelCast']), ray)).toEqual([
        { type: 'cancel-cast', caster: hero },
      ]);
    }
  });
});
