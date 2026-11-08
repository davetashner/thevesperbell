// The tether delivery (mw-e08.10): grabbing, carrying, using and letting go, on the real deterministic
// Rapier build with a fake sight world for line of sight. No real spell id is used.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { DAMAGE_COMPONENTS } from '../combat/damage';
import {
  addInteractable,
  addInteractor,
  INTERACTION_COMPONENTS,
  interacted,
  type Interaction,
} from '../interaction/system';
import { hypot } from '../math';
import {
  addPhysicsObject,
  installPhysicsObjects,
  PhysicsObjectComponent,
} from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { PlayerLook } from '../player/player';
import { addProperties, registerWorldProperties } from '../properties/components';
import { FakeSightWorld } from '../sight/fake-sight-world';
import { PlacementComponent, placeEntity, placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import { installCasting, type CancelCastCommand } from './casting';
import { learnSpell } from './components';
import { giveMana, installMana } from './mana';
import { installSpells, type CastCommand } from './pipeline';
import { SpellFizzled } from './events';
import { makeSpell } from './testing';
import {
  ForceResisted,
  installSpellTether,
  TetherGrabbed,
  TetherReleased,
  TetherUsed,
  type SpellTetherOptions,
  type TetherReleaseCommand,
  type TetherUseCommand,
} from './tether';
import type { SpellEntry } from '@content/index';

type Input = CastCommand | CancelCastCommand | TetherUseCommand | TetherReleaseCommand;

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const HALF = 0.25;

const tetherSpell = (
  overrides: Partial<Extract<SpellEntry['delivery'], { kind: 'tether' }>> = {},
) =>
  makeSpell('grip', {
    delivery: {
      kind: 'tether',
      range: 15,
      maxWeight: 25,
      speed: 12,
      lineOfSightGrace: 0.5,
      maxHold: 60,
      pickRadius: 0.75,
      ...overrides,
    },
  });

interface RigOptions extends SpellTetherOptions {
  readonly noSight?: boolean;
  readonly spell?: SpellEntry;
  readonly withCasting?: boolean;
  readonly walls?: boolean;
}

function rig(options: RigOptions = {}) {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(
    registerWorldProperties(new World<Input>({ seed: 5, hz: 60, physics })),
  );
  world.register(...INTERACTION_COMPONENTS, ...DAMAGE_COMPONENTS, PlayerLook);
  installPhysicsObjects(world);
  physics.add(box(v(-60, -1, -60), v(60, 0, 60)));
  const spell = options.spell ?? tetherSpell();
  const pipeline = installSpells(world, { spells: (id) => (id === spell.id ? spell : undefined) });
  let casting: ReturnType<typeof installCasting> | undefined;
  if (options.withCasting === true) {
    installMana(world, pipeline);
    casting = installCasting(world, pipeline);
  }
  const sight = new FakeSightWorld();
  const tether = installSpellTether(world, pipeline, {
    ...(options.noSight !== true && { sight }),
    ...(casting !== undefined && { casting }),
    ...(options.aim !== undefined && { aim: options.aim }),
    ...(options.eye !== undefined && { eye: options.eye }),
  });
  world.addSystem(stimulusSystem());
  const caster = world.spawn();
  placeEntity(world, caster, v(0, 0, 0), 0.5);
  addInteractor(world, caster);
  if (casting !== undefined) {
    giveMana(world, caster);
    learnSpell(world, caster, spell.id);
  }
  const log: string[] = [];
  const released: string[] = [];
  const fizzled: string[] = [];
  const resisted: number[] = [];
  const used: string[] = [];
  const interactions: Interaction[] = [];
  world.events.on(TetherGrabbed, (e) => log.push(`grab:${String(e.target)}:${String(e.movable)}`));
  world.events.on(TetherReleased, (e) => released.push(e.reason));
  world.events.on(SpellFizzled, (e) => fizzled.push(e.reason));
  world.events.on(ForceResisted, (e) => resisted.push(e.weight));
  world.events.on(TetherUsed, (e) => used.push(e.verb));
  world.events.on(interacted, (e) => interactions.push(e));
  const crate = (at: Vec3, weight = 10): EntityId => {
    const entity = world.spawn();
    addProperties(world, entity, { weight, material: 'wood' });
    addPhysicsObject(world, entity, {
      shape: { kind: 'box', halfExtents: v(HALF, HALF, HALF) },
      position: at,
    });
    return entity;
  };
  const lever = (at: Vec3): EntityId => {
    const entity = world.spawn();
    addInteractable(world, entity, { affordances: [{ verb: 'pull' }] }, at);
    return entity;
  };
  const steps = (n: number, inputs: readonly Input[] = []): void => {
    for (let i = 0; i < n; i++) world.step(i === 0 ? inputs : []);
  };
  const grab = (target?: EntityId, aim?: Vec3) => {
    const result = pipeline.cast(world, {
      caster,
      spell: spell.id,
      source: 'free',
      ...(target !== undefined && { target }),
      ...(aim !== undefined && { aim }),
    });
    world.events.flush(); // between steps nothing delivers events, so do it here
    return result;
  };
  const use = (): boolean => {
    const done = tether.use(caster);
    world.events.flush();
    return done;
  };
  return {
    world,
    physics,
    pipeline,
    tether,
    sight,
    caster,
    crate,
    lever,
    steps,
    grab,
    use,
    log,
    released,
    fizzled,
    resisted,
    used,
    interactions,
    casting,
  };
}

const at = (world: World<never>, entity: EntityId): Vec3 => {
  const p = placementOf(world, entity);
  if (p === undefined) throw new Error('no placement');
  return { x: p.x, y: p.y, z: p.z };
};

describe('tether delivery: grabbing', () => {
  it('grabs the chosen object and holds it', () => {
    const r = rig();
    const crate = r.crate(v(0, 1, -4));
    expect(r.grab(crate).status).toBe('cast');
    expect(r.tether.heldBy(r.caster)).toBe(crate);
    expect(r.log).toEqual([`grab:${String(crate)}:true`]);
  });

  it('picks the object nearest the aim point within the pick radius', () => {
    const r = rig();
    const near = r.crate(v(0, 1, -4));
    r.crate(v(3, 1, -4));
    expect(r.grab(undefined, v(0.4, 1, -4)).status).toBe('cast');
    expect(r.tether.heldBy(r.caster)).toBe(near);
  });

  it('can pick a lever by the aim point too', () => {
    const r = rig();
    const lever = r.lever(v(0, 1, -5));
    expect(r.grab(undefined, v(0.2, 2, -5)).status).toBe('cast');
    expect(r.tether.heldBy(r.caster)).toBe(lever);
  });

  it('fizzles with no-target when nothing is chosen, near the aim, alive, or other than the caster', () => {
    const r = rig();
    const far = r.crate(v(0, 1, -4));
    expect(r.grab().status).toBe('fizzled');
    expect(r.grab(undefined, v(9, 1, -4)).status).toBe('fizzled');
    expect(r.grab(r.caster).status).toBe('fizzled');
    r.world.destroy(far);
    r.steps(1);
    expect(r.grab(far).status).toBe('fizzled');
    expect(r.fizzled).toEqual(['no-target', 'no-target', 'no-target', 'no-target']);
  });

  it('fizzles without a position, on something it cannot use or move, beyond range, or behind a wall', () => {
    const r = rig();
    const bare = r.world.spawn();
    placeEntity(r.world, bare, v(0, 1, -3), 0.3);
    r.steps(1);
    expect(r.grab(bare).status).toBe('fizzled');
    expect(r.grab(undefined, v(0, 1, -3)).status).toBe('fizzled'); // near it, but it is no handle
    const nowhere = r.world.spawn();
    expect(r.grab(nowhere).status).toBe('fizzled');
    const far = r.crate(v(0, 1, -30));
    expect(r.grab(far).status).toBe('fizzled');
    const hidden = r.crate(v(0, 1, -6));
    r.sight.add(box(v(-1, 0, -4), v(1, 3, -3.5)));
    expect(r.grab(hidden).status).toBe('fizzled');
    expect(r.fizzled).toEqual([
      'not-tetherable',
      'no-target',
      'no-position',
      'out-of-reach',
      'blocked',
    ]);
  });

  it('fizzles for want of an eye when the caster has no placement', () => {
    const r = rig();
    const crate = r.crate(v(0, 1, -4));
    r.world.remove(r.caster, PlacementComponent);
    r.steps(1);
    expect(r.grab(crate).status).toBe('fizzled');
    expect(r.fizzled).toEqual(['no-position']);
  });

  it('AC-4: refuses what is above the weight limit and says so with ForceResisted', () => {
    const r = rig();
    const boulder = r.crate(v(0, 1, -4), 80);
    expect(r.grab(boulder).status).toBe('fizzled');
    expect(r.resisted).toEqual([80]);
    expect(r.fizzled).toEqual(['too-heavy']);
    expect(r.tether.heldBy(r.caster)).toBeNull();
    r.steps(30);
    expect(at(r.world, boulder).y).toBeLessThan(0.3); // never lifted: it rests on the floor
  });

  it('a later cast on the same object keeps the tether; on another it replaces it', () => {
    const r = rig();
    const a = r.crate(v(0, 1, -4));
    const b = r.crate(v(2, 1, -4));
    r.grab(a);
    expect(r.grab(a).status).toBe('cast');
    expect(r.grab().status).toBe('cast');
    expect(r.log).toHaveLength(1);
    r.grab(b);
    expect(r.tether.heldBy(r.caster)).toBe(b);
    expect(r.released).toEqual(['replaced']);
  });

  it('holds anything with an affordance in place, and a lever is not lifted', () => {
    const r = rig();
    const lever = r.lever(v(0, 1, -5));
    expect(r.grab(lever).status).toBe('cast');
    expect(r.log).toEqual([`grab:${String(lever)}:false`]);
    r.steps(5);
    expect(r.tether.heldBy(r.caster)).toBe(lever);
  });
});

describe('tether: sight edge cases', () => {
  it('with no sight world nothing blocks', () => {
    const r = rig({ noSight: true });
    const crate = r.crate(v(0, 1.5, -4));
    r.sight.add(box(v(-2, 0, -2.5), v(2, 4, -2)));
    expect(r.grab(crate).status).toBe('cast');
    r.steps(60);
    expect(r.tether.heldBy(r.caster)).toBe(crate);
  });

  it('an object exactly at the eye is in sight', () => {
    const r = rig();
    const here = r.lever(v(0, 0.5, 0)); // anchored at the eye height: the eye is on it
    expect(r.grab(here).status).toBe('cast');
  });
});

describe('tether: carrying', () => {
  it('AC-3: follows the aim point and sets the object down when released', () => {
    let aim = v(0, 1.5, -4);
    const r = rig({ aim: () => aim });
    const crate = r.crate(v(0, 1.5, -4));
    r.grab(crate);
    for (let i = 0; i < 120; i++) {
      aim = v(i * 0.05, 1.5, -4); // 3 m/s sideways
      r.steps(1);
      expect(hypot(at(r.world, crate).x - aim.x, at(r.world, crate).z - aim.z)).toBeLessThanOrEqual(
        0.3,
      );
    }
    expect(at(r.world, crate).y).toBeCloseTo(1.5, 1); // hovering: gravity does not win
    expect(r.tether.release(r.caster)).toBe(true);
    expect(r.tether.release(r.caster)).toBe(false);
    r.steps(90);
    expect(at(r.world, crate).y).toBeLessThan(0.3);
    expect(r.released).toEqual(['player']);
  });

  it('moves at most `speed` per second and clamps the aim to range', () => {
    let aim = v(0, 1.5, -40);
    const r = rig({ aim: () => aim, spell: tetherSpell({ speed: 6 }) });
    const crate = r.crate(v(0, 1.5, -4));
    r.grab(crate);
    r.steps(60);
    expect(at(r.world, crate).z).toBeCloseTo(-10, 0); // 6 m in a second
    r.steps(120);
    const z = at(r.world, crate).z;
    expect(z).toBeGreaterThan(-15.1);
    expect(z).toBeLessThan(-14);
    aim = v(0, 1.5, -2);
    r.steps(1);
    expect(at(r.world, crate).z).toBeGreaterThan(z);
  });

  it('stops at a wall instead of passing through it', () => {
    let aim = v(0, 1.5, -4);
    const r = rig({ aim: () => aim });
    const crate = r.crate(v(0, 1.5, -4));
    r.grab(crate);
    r.sight.add(box(v(2, 0, -6), v(2.5, 3, -2)));
    aim = v(5, 1.5, -4);
    r.steps(60);
    expect(at(r.world, crate).x).toBeLessThan(2);
    expect(r.tether.heldBy(r.caster)).toBe(crate);
  });

  it('uses the look as the default aim, and holds still with no look or no aim', () => {
    const r = rig();
    const crate = r.crate(v(0, 1.5, -4));
    r.grab(crate);
    r.steps(5);
    expect(at(r.world, crate).z).toBeCloseTo(-4, 1); // no look: it holds where it is
    r.world.add(r.caster, PlayerLook, { yaw: Math.PI / 2, pitch: 0 });
    r.steps(1);
    r.steps(60);
    const p = at(r.world, crate);
    expect(p.x).toBeLessThan(-3); // yaw a quarter turn left looks along −x
    expect(p.z).toBeCloseTo(0, 0);
    expect(hypot(p.x, p.z)).toBeGreaterThan(3.9);
  });

  it('a held object nudging a creature at low speed deals it no damage', () => {
    let aim = v(0, 0.5, -4);
    const r = rig({ aim: () => aim });
    const crate = r.crate(v(0, 0.5, -4));
    r.grab(crate);
    aim = v(0, 0.5, -8);
    r.steps(90);
    expect(at(r.world, crate).z).toBeLessThan(-7);
  });
});

describe('tether: letting go', () => {
  it('lets go when the hold runs out', () => {
    const r = rig({ spell: tetherSpell({ maxHold: 1 }) });
    const crate = r.crate(v(0, 1, -4));
    r.grab(crate);
    r.steps(60);
    expect(r.tether.heldBy(r.caster)).toBe(crate);
    r.steps(1);
    expect(r.tether.heldBy(r.caster)).toBeNull();
    expect(r.released).toEqual(['expired']);
  });

  it('lets go when the object is destroyed, loses its body, or the caster is gone', () => {
    const r = rig();
    const a = r.crate(v(0, 1, -4));
    r.grab(a);
    r.world.destroy(a);
    r.steps(1);
    const b = r.crate(v(0, 1, -4));
    r.grab(b);
    r.world.remove(b, PhysicsObjectComponent);
    r.steps(1);
    const c = r.crate(v(0, 1, -4));
    r.grab(c);
    r.world.remove(r.caster, PlacementComponent);
    r.steps(1);
    expect(r.released).toEqual(['lost', 'lost', 'lost']);
  });

  it('lets go when the object ends up beyond range', () => {
    const r = rig();
    const crate = r.crate(v(0, 1, -14));
    r.grab(crate);
    r.world.set(r.caster, PlacementComponent, { x: 0, y: 0, z: 8, radius: 0.5 });
    r.steps(1);
    expect(r.released).toEqual(['out-of-range']);
  });

  it('AC-6: drops after line of sight has been broken for more than 0.5 s, not before', () => {
    const r = rig();
    const crate = r.crate(v(0, 1.5, -4));
    r.grab(crate);
    r.sight.add(box(v(-2, 0, -2.5), v(2, 4, -2)));
    r.steps(31);
    expect(r.tether.heldBy(r.caster)).toBe(crate); // 30 ticks (0.5 s) of lost sight: still held
    r.steps(1);
    expect(r.tether.heldBy(r.caster)).toBeNull();
    expect(r.released).toEqual(['line-of-sight']);
  });

  it('a blink of lost sight is forgiven, and the clock starts again next time', () => {
    const r = rig();
    const crate = r.crate(v(0, 1.5, -4));
    r.grab(crate);
    const wall = r.sight.add(box(v(-2, 0, -2.5), v(2, 4, -2)));
    r.steps(20);
    r.sight.remove(wall);
    r.steps(20);
    const again = r.sight.add(box(v(-2, 0, -2.5), v(2, 4, -2)));
    r.steps(25);
    expect(r.tether.heldBy(r.caster)).toBe(crate);
    r.sight.remove(again);
    r.steps(1);
    expect(r.released).toEqual([]);
  });

  it('keeps the tethers of different casters apart', () => {
    const r = rig();
    const a = r.crate(v(0, 1.5, -4));
    const b = r.crate(v(5, 1.5, -4));
    const second = r.world.spawn();
    placeEntity(r.world, second, v(5, 0, 0), 0.5);
    r.grab(a);
    r.pipeline.cast(r.world, { caster: second, spell: 'grip', source: 'free', target: b });
    r.sight.add(box(v(-2, 0, -2.5), v(2, 4, -2)));
    r.steps(10);
    r.sight.remove(1);
    r.steps(1);
    expect(r.tether.tetherOf(second)?.target).toBe(b);
    expect(r.tether.tetherOf(r.caster)?.blockedSince).toBeNull();
  });

  it('takes tether-release commands', () => {
    const r = rig();
    const crate = r.crate(v(0, 1, -4));
    r.grab(crate);
    r.steps(1, [{ type: 'tether-release', caster: r.caster }]);
    expect(r.released).toEqual(['player']);
  });
});

describe('tether: using', () => {
  it('AC-2: use performs the primary affordance as a direct interaction would', () => {
    const r = rig();
    const lever = r.lever(v(0, 0, -10));
    r.grab(lever);
    expect(r.use()).toBe(true);
    expect(r.interactions).toEqual([
      { actor: r.caster, target: lever, verb: 'pull', affordance: 0 },
    ]);
    expect(r.used).toEqual(['pull']);
  });

  it('takes tether-use commands', () => {
    const r = rig();
    const lever = r.lever(v(0, 0, -10));
    r.grab(lever);
    r.steps(1, [{ type: 'tether-use', caster: r.caster }]);
    expect(r.interactions).toHaveLength(1);
  });

  it('canUse says whether use would work, without using', () => {
    const r = rig();
    expect(r.tether.canUse(r.caster)).toBe(false);
    r.grab(r.crate(v(0, 1, -4)));
    expect(r.tether.canUse(r.caster)).toBe(false); // a plain crate has no verb
    const lever = r.lever(v(0, 0, -10));
    r.grab(lever);
    expect(r.tether.canUse(r.caster)).toBe(true);
    r.sight.add(box(v(-2, 0, -6), v(2, 4, -5)));
    expect(r.tether.canUse(r.caster)).toBe(false);
    expect(r.interactions).toEqual([]);
  });

  it('does nothing with nothing held, nothing usable, out of reach, or without sight', () => {
    const r = rig();
    expect(r.use()).toBe(false);
    const crate = r.crate(v(0, 1, -4));
    r.grab(crate);
    expect(r.use()).toBe(false); // a plain crate has no verb
    const lever = r.lever(v(0, 0, -10));
    r.grab(lever);
    r.sight.add(box(v(-2, 0, -6), v(2, 4, -5)));
    expect(r.use()).toBe(false);
    r.world.set(r.caster, PlacementComponent, { x: 0, y: 0, z: 10, radius: 0.5 });
    expect(r.use()).toBe(false);
    r.world.remove(r.caster, PlacementComponent);
    r.steps(1);
    expect(r.use()).toBe(false);
    const other = rig();
    const gone = other.lever(v(0, 0, -10));
    other.grab(gone);
    other.world.remove(gone, PlacementComponent);
    expect(other.use()).toBe(false);
    expect(r.used).toEqual([]);
  });
});

describe('tether: with the cast phase', () => {
  const channelled = makeSpell('grip', {
    delivery: {
      kind: 'tether',
      range: 15,
      maxWeight: 25,
      speed: 12,
      lineOfSightGrace: 0.5,
      maxHold: 60,
      pickRadius: 0.75,
    },
    channel: { interval: 0.1, manaPerSecond: 1, maxDuration: 60 },
    flags: { tooUseful: true, castWhileMoving: true, allowOvercast: false },
  });

  it('a channelled cast holds until it is called off, then lets go', () => {
    const r = rig({ spell: channelled, withCasting: true });
    const crate = r.crate(v(0, 1, -4));
    r.steps(1, [{ type: 'cast', caster: r.caster, spell: 'grip', target: crate }]);
    r.steps(10);
    expect(r.tether.heldBy(r.caster)).toBe(crate);
    expect(r.log).toHaveLength(1); // the channel's later ticks do not grab again
    r.steps(1, [{ type: 'cancel-cast', caster: r.caster }]);
    expect(r.tether.heldBy(r.caster)).toBeNull();
    expect(r.released).toEqual(['channel-ended']);
  });

  it('letting go (or losing sight) ends the channel too', () => {
    const r = rig({ spell: channelled, withCasting: true });
    const crate = r.crate(v(0, 1, -4));
    r.steps(1, [{ type: 'cast', caster: r.caster, spell: 'grip', target: crate }]);
    r.steps(10);
    expect(r.tether.release(r.caster)).toBe(true);
    expect(r.casting?.cancel(r.caster)).toBe(false); // already ended
    const again = r.crate(v(0, 1, -5));
    r.steps(100); // the cooldown is nil: cast again
    r.steps(1, [{ type: 'cast', caster: r.caster, spell: 'grip', target: again }]);
    r.steps(10);
    r.sight.add(box(v(-2, 0, -2.5), v(2, 4, -2)));
    r.steps(40);
    expect(r.released).toEqual(['player', 'line-of-sight']);
    expect(r.casting?.cancel(r.caster)).toBe(false);
  });

  it('a free cast elsewhere is not ended by letting go of a tether', () => {
    const r = rig({ spell: channelled, withCasting: true });
    const crate = r.crate(v(0, 1, -4));
    r.grab(crate); // a scroll: no channel runs
    expect(r.tether.release(r.caster)).toBe(true);
  });
});
