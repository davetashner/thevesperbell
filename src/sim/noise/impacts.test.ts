// Impact noise (mw-e03.25): loudness from energy × material through the stealth table's curve.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import { BlameComponent } from '../combat/environment/environment';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { log } from '../math';
import { WorldItemComponent } from '../items/world-items';
import { liquidEntered } from '../liquids/volumes';
import {
  addPhysicsObject,
  installPhysicsObjects,
  kineticEnergyOf,
  physicsImpact,
  setPhysicsObjectVelocity,
} from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { addProperties, registerWorldProperties } from '../properties/components';
import { installStimuli } from '../stimulus/stimulus';
import { noiseEmitted, type NoiseEvent } from './events';
import {
  impactLoudness,
  installImpactNoise,
  ITEM_IMPACT_NOISE,
  OBJECT_IMPACT_NOISE,
  SPLASH_NOISE,
} from './impacts';
import { DEFAULT_NOISE_TUNING } from './propagation';

const v = (x: number, y: number, z: number) => ({ x, y, z });
const CURVE = DEFAULT_NOISE_TUNING.impact;
const OFFSETS = new Map([
  ['stone', 0],
  ['wood', 2],
  ['glass', 12],
  ['cloth', -8],
  ['water', 6],
]);

function setup() {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(registerWorldProperties(new World<never>({ seed: 4, physics })));
  installPhysicsObjects(world);
  physics.add(box(v(-20, -1, -20), v(20, 0, 20)));
  const noises: NoiseEvent[] = [];
  world.events.on(noiseEmitted, (n) => noises.push(n));
  const off = installImpactNoise(world, { curve: CURVE, offsetOf: (m) => OFFSETS.get(m) });
  return { world, physics, noises, off };
}

const impact = (entity: EntityId, energy: number, materials: readonly [string, string]) => ({
  entity,
  other: null,
  materials,
  energy,
  impulse: 1,
  speed: 2,
  normal: v(0, 1, 0),
  position: v(1, 0, 2),
});

describe('impact loudness curve (mw-e03.25)', () => {
  it('rises by dbPerDecade for ten times the energy and adds the louder surface', () => {
    expect(impactLoudness(CURVE, 10)).toBeCloseTo(60, 9);
    expect(impactLoudness(CURVE, 100)).toBeCloseTo(70, 9);
    expect(impactLoudness(CURVE, 100, 0, 12)).toBeCloseTo(82, 9);
    expect(impactLoudness(CURVE, 100, -8, 6)).toBeCloseTo(76, 9);
  });

  it('is capped at maxDb, never negative, and silent below the minimum energy or for no energy', () => {
    expect(impactLoudness(CURVE, 1e12, 12)).toBe(CURVE.maxDb);
    expect(impactLoudness(CURVE, 1, -60, -60)).toBe(0);
    expect(impactLoudness(CURVE, CURVE.minEnergy / 2)).toBeNull();
    expect(impactLoudness(CURVE, Number.NaN)).toBeNull();
    expect(impactLoudness(CURVE, CURVE.minEnergy)).not.toBeNull();
  });
});

describe('world impacts make noise (mw-e03.25)', () => {
  it('AC-1: a 200 J crate impact on stone is a noise on the documented curve, blamed on its thrower', () => {
    const { world, noises } = setup();
    const thrower = world.spawn();
    const crate = world.spawn();
    world.register(BlameComponent);
    world.add(crate, BlameComponent, { instigator: thrower });
    world.events.emit(physicsImpact, impact(crate, 200, ['wood', 'stone']));
    world.events.flush();
    expect(noises).toHaveLength(1);
    const expected = 60 + 10 * (log(20) / Math.LN10) + 2; // wood rings 2 dB over stone
    expect(noises[0]).toMatchObject({ kind: OBJECT_IMPACT_NOISE, entity: crate, source: thrower });
    expect(noises[0]?.loudness).toBeCloseTo(expected, 6);
    expect(noises[0]?.position).toEqual(v(1, 0, 2));
  });

  it('material loudness shows: the same energy is louder on glass than on cloth', () => {
    const { world, noises } = setup();
    const a = world.spawn();
    world.events.emit(physicsImpact, impact(a, 50, ['glass', 'stone']));
    world.events.emit(physicsImpact, impact(a, 50, ['cloth', 'cloth']));
    world.events.flush();
    expect(noises).toHaveLength(2);
    expect((noises[0]?.loudness ?? 0) - (noises[1]?.loudness ?? 0)).toBeCloseTo(20, 9);
  });

  it('AC-3: 50 micro-impacts a second from a settling pile make no noise', () => {
    const { world, noises } = setup();
    const pile = world.spawn();
    for (let i = 0; i < 50; i++)
      world.events.emit(physicsImpact, impact(pile, 0.4, ['wood', 'wood']));
    world.events.flush();
    expect(noises).toEqual([]);
  });

  it('an impact with no blame has no source, and an unknown material rings like stone', () => {
    const { world, noises } = setup();
    const rock = world.spawn();
    world.events.emit(physicsImpact, impact(rock, 10, ['unobtainium', 'stone']));
    world.events.flush();
    expect(noises[0]).toMatchObject({ source: null, loudness: 60 });
  });

  it('with blame and items in the world, an impact of something with neither has no source', () => {
    const { world, noises } = setup();
    world.register(BlameComponent, WorldItemComponent);
    world.events.emit(physicsImpact, impact(world.spawn(), 30, ['stone', 'stone']));
    world.events.flush();
    expect(noises[0]).toMatchObject({ kind: OBJECT_IMPACT_NOISE, source: null });
  });

  it('a world item reports as an item impact, blamed on whoever dropped it', () => {
    const { world, noises } = setup();
    const owner = world.spawn();
    const key = world.spawn();
    world.register(WorldItemComponent);
    world.add(key, WorldItemComponent, { defId: 'key', count: 1, flags: {}, by: owner });
    world.events.emit(physicsImpact, impact(key, 20, ['iron', 'stone']));
    world.events.flush();
    expect(noises[0]).toMatchObject({ kind: ITEM_IMPACT_NOISE, entity: key, source: owner });
  });

  it('a crate that really falls onto a floor makes one noise, a heavy one louder', () => {
    const { world, noises } = setup();
    const drop = (weight: number, x: number): EntityId => {
      const e = world.spawn();
      addProperties(world, e, { weight });
      addPhysicsObject(world, e, {
        shape: { kind: 'box', halfExtents: v(0.2, 0.2, 0.2) },
        position: v(x, 3, 0),
      });
      return e;
    };
    const light = drop(1, -5);
    const heavy = drop(100, 5);
    for (let i = 0; i < 120; i++) world.step();
    const of = (e: EntityId) => noises.find((n) => n.entity === e);
    expect(of(light)).toBeDefined();
    expect(of(heavy)).toBeDefined();
    expect(of(heavy)?.loudness ?? 0).toBeGreaterThan(of(light)?.loudness ?? 99);
    expect(of(heavy)?.loudness ?? 0).toBeLessThanOrEqual(CURVE.maxDb);
  });

  it('a body that goes into liquid fast splashes; one that is already still does not', () => {
    const { world, noises } = setup();
    const volume = world.spawn();
    const flask = world.spawn();
    addProperties(world, flask, { weight: 2 });
    addPhysicsObject(world, flask, {
      shape: { kind: 'box', halfExtents: v(0.1, 0.1, 0.1) },
      position: v(0, 5, 0),
    });
    setPhysicsObjectVelocity(world, flask, v(0, -8, 0));
    expect(kineticEnergyOf(world, flask)).toBeCloseTo(64, 3); // ½·2·8²
    world.events.emit(liquidEntered, { entity: flask, volume });
    world.events.flush();
    expect(noises).toHaveLength(1);
    expect(noises[0]).toMatchObject({ kind: SPLASH_NOISE, entity: flask, source: null });
    expect(noises[0]?.loudness).toBeCloseTo(60 + 10 * (log(6.4) / Math.LN10), 3);
    const rested = world.spawn();
    addProperties(world, rested, { weight: 2 });
    addPhysicsObject(world, rested, {
      shape: { kind: 'box', halfExtents: v(0.1, 0.1, 0.1) },
      position: v(3, 5, 0),
    });
    world.events.emit(liquidEntered, { entity: rested, volume });
    world.events.emit(liquidEntered, { entity: world.spawn(), volume }); // no placement: nothing to place
    world.events.flush();
    expect(noises).toHaveLength(1);
    expect(kineticEnergyOf(world, world.spawn())).toBe(0);
  });

  it('stops when uninstalled', () => {
    const { world, noises, off } = setup();
    off();
    world.events.emit(physicsImpact, impact(world.spawn(), 500, ['wood', 'stone']));
    world.events.emit(liquidEntered, { entity: world.spawn(), volume: world.spawn() });
    world.events.flush();
    expect(noises).toEqual([]);
  });

  it('works without material offsets', () => {
    const world = new World<never>({ seed: 1 });
    const noises: NoiseEvent[] = [];
    world.events.on(noiseEmitted, (n) => noises.push(n));
    installImpactNoise(world, { curve: CURVE });
    world.events.emit(physicsImpact, impact(world.spawn(), 10, ['glass', 'glass']));
    world.events.flush();
    expect(noises[0]?.loudness).toBe(60);
  });
});
