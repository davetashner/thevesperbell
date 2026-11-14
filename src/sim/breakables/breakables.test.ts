// Breakables (mw-e03.11): hits through the stimulus API, physics impacts, frozen shatter, break
// results (colliders, passage, noise, debris, contents) and the debris budget, on the real
// deterministic Rapier build where bodies matter.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import { blame, BlameComponent } from '../combat/environment/environment';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { noiseEmitted, type NoiseEvent } from '../noise/events';
import {
  addPhysicsObject,
  installPhysicsObjects,
  physicsImpact,
  PhysicsColliderComponent,
  PhysicsObjectComponent,
} from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import type { ColliderHandle } from '../physics/static-colliders';
import {
  addProperties,
  readProperty,
  registerWorldProperties,
  type WorldPropertyInit,
} from '../properties/components';
import type { MaterialPresets } from '../properties/materials';
import type { KitLookup, KitPieceSpec, SceneSpec } from '../scene/layout';
import { loadScene, registerSceneComponents } from '../scene/loader';
import { addScenePhysics, type PropBody } from '../scene/physics';
import { hashWorld } from '../snapshot';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { StimulusShape } from '../stimulus/shapes';
import type { StimulusElement } from '../stimulus/stimulus';
import { applyStimulus, installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  BreakableComponent,
  DebrisComponent,
  SpilledComponent,
  type BreakableProfile,
} from './components';
import {
  breakableBroken,
  debrisCulled,
  passageRevealed,
  type BreakableBrokenInfo,
  type DebrisCulled,
  type PassageRevealed,
} from './events';
import { addSceneBreakables } from './scene';
import {
  breakThreshold,
  DEFAULT_FROZEN_FRAGILITY,
  installBreakables,
  liveDebris,
  makeBreakable,
  MAX_DEBRIS_WEIGHT,
  MIN_DEBRIS_WEIGHT,
  structuralDamage,
  type BreakablesOptions,
} from './system';

const OLD_WALL: BreakableProfile = {
  id: 'old-wall',
  resistances: { blunt: 0.2, slash: 0.9, pierce: 1, force: 0.2 },
  debris: { count: 3, size: 0.3 },
  breakLoudness: 85,
};
const POTTERY: BreakableProfile = {
  id: 'pottery',
  resistances: {},
  debris: { count: 2, size: 0.1 },
  breakLoudness: 70,
};
const PROFILES = new Map([OLD_WALL, POTTERY].map((p) => [p.id, p]));

const MATERIALS: MaterialPresets = new Map([
  ['stone', { density: 2600, friction: 0.6, hp: 400 }],
  ['clay', { density: 1800, friction: 0.5, fragile: 15, hp: 10 }],
  ['wood', { density: 700, friction: 0.5 }],
]);
const PROPS = new Map<string, PropBody>([
  ['pot', { size: { x: 0.3, y: 0.4, z: 0.3 }, material: 'clay', weight: 2 }],
  ['coin', { size: { x: 0.1, y: 0.05, z: 0.1 }, material: 'wood', weight: 0.1 }],
  ['stone', { size: { x: 0.3, y: 0.3, z: 0.3 }, material: 'stone', weight: 5 }],
]);
const props = (id: string) => PROPS.get(id);

interface Log {
  readonly broken: BreakableBrokenInfo[];
  readonly passages: PassageRevealed[];
  readonly noises: NoiseEvent[];
  readonly culled: DebrisCulled[];
}

function listen(world: World<never>): Log {
  const log: Log = { broken: [], passages: [], noises: [], culled: [] };
  world.events.on(breakableBroken, (e) => log.broken.push(e));
  world.events.on(passageRevealed, (e) => log.passages.push(e));
  world.events.on(noiseEmitted, (e) => log.noises.push(e));
  world.events.on(debrisCulled, (e) => log.culled.push(e));
  return log;
}

/** A world with properties, stimuli and breakables, but no physics: breaks leave no debris. */
function plain(options: BreakablesOptions = {}) {
  const world = installStimuli(registerWorldProperties(new World<never>({ seed: 5 })));
  world.addSystem(stimulusSystem());
  const off = installBreakables(world, options);
  return { world, off, log: listen(world) };
}

/** A world on Rapier with physics objects, a stone floor (top at y = 0) and breakables. */
function physical(options: BreakablesOptions = {}, withBlame = true) {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(
    registerWorldProperties(registerSceneComponents(new World<never>({ seed: 5, physics }))),
  );
  if (withBlame) world.register(BlameComponent);
  installPhysicsObjects(world);
  world.addSystem(stimulusSystem());
  installBreakables(world, { props, materials: MATERIALS, ...options });
  physics.add(box({ x: -20, y: -1, z: -20 }, { x: 20, y: 0, z: 20 }));
  return { world, physics, log: listen(world) };
}

/** A placed breakable with `init` properties. */
function breakable(
  world: World<never>,
  profile: BreakableProfile,
  init: WorldPropertyInit,
  at = { x: 0, y: 1, z: 0 },
  instance: Parameters<typeof makeBreakable>[3] = {},
): EntityId {
  const entity = world.spawn();
  addProperties(world, entity, init);
  placeEntity(world, entity, at, 0.5);
  makeBreakable(world, entity, profile, instance);
  return entity;
}

/** A pot standing on the floor at x, z (a physics object). */
function pot(world: World<never>, x: number, z: number, y = 0.2): EntityId {
  const entity = world.spawn();
  addProperties(world, entity, { material: 'clay', fragile: 15, hp: 10, weight: 2 });
  addPhysicsObject(world, entity, {
    shape: { kind: 'box', halfExtents: { x: 0.15, y: 0.2, z: 0.15 } },
    position: { x, y, z },
  });
  makeBreakable(world, entity, POTTERY, { contents: ['coin', 'lever', 'coin'] });
  return entity;
}

function hit(
  world: World<never>,
  target: EntityId,
  element: StimulusElement,
  intensity: number,
  source: EntityId | null = null,
): void {
  applyStimulus(world, { shape: { kind: 'contact', target }, element, intensity, source });
}

/** `value`, which the test knows is there. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const steps = (world: World<never>, n: number): void => {
  for (let i = 0; i < n; i++) world.step();
};

describe('breakables: damage by kind of hit (mw-e03.11)', () => {
  it('AC-1: blunt 125 through 20% resistance breaks a 100 hp wall; the same slash through 90% does not', () => {
    const { world, log } = plain();
    const knight = world.spawn();
    const wall = breakable(world, OLD_WALL, { hp: 100, material: 'stone' });
    const twin = breakable(world, OLD_WALL, { hp: 100, material: 'stone' });
    for (const [amount, left] of [
      [50, 60],
      [50, 20],
    ] as const) {
      hit(world, wall, 'blunt', amount, knight);
      hit(world, twin, 'slash', amount, knight);
      world.step();
      expect(readProperty(world, wall, 'hp')).toBe(left);
    }
    expect(log.broken).toEqual([]);
    hit(world, wall, 'blunt', 25, knight);
    hit(world, twin, 'slash', 25, knight);
    world.step();
    expect(readProperty(world, twin, 'hp')).toBe(87.5);
    expect(world.isAlive(twin)).toBe(true);
    expect(world.isAlive(wall)).toBe(false);
    expect(log.broken).toEqual([
      expect.objectContaining({
        entity: wall,
        profile: 'old-wall',
        material: 'stone',
        cause: 'structure',
        by: 'blunt',
        source: knight,
        debris: [],
        spilled: [],
        reveals: null,
        loudness: 85,
      }),
    ]);
    expect(structuralDamage(125, 0.2)).toBe(100);
    expect(structuralDamage(10, 1.5)).toBe(0); // clamped: immune
    expect(structuralDamage(10, -1)).toBe(10); // clamped: no resistance
  });

  it('ignores kinds it is immune to, elements that are not hits, and things that are not breakable', () => {
    const { world, log } = plain();
    const wall = breakable(world, OLD_WALL, { hp: 100 });
    const rock = world.spawn();
    addProperties(world, rock, { hp: 5 });
    placeEntity(world, rock, { x: 0, y: 1, z: 0 }, 0.5);
    hit(world, wall, 'pierce', 1000);
    hit(world, wall, 'heat', 1000);
    hit(world, rock, 'blunt', 1000);
    world.step();
    expect(readProperty(world, wall, 'hp')).toBe(100);
    expect(readProperty(world, rock, 'hp')).toBe(5);
    expect(log.broken).toEqual([]);
  });

  it('a shove (force) strains the structure but is no impact; the world pushes breakables too', () => {
    const { world, log } = plain();
    const wall = breakable(world, OLD_WALL, { hp: 100 });
    applyStimulus(world, {
      shape: { kind: 'sphere', center: { x: 0, y: 1, z: -2 }, radius: 4 },
      element: 'force',
      intensity: 200,
      falloff: 'none',
    });
    world.step();
    expect(log.broken).toEqual([expect.objectContaining({ entity: wall, by: 'force' })]);
  });

  it('breaks once: a second hit in the same tick finds it broken; hits after it is gone do nothing', () => {
    const { world, log } = plain();
    const wall = breakable(world, OLD_WALL, { hp: 10 });
    hit(world, wall, 'blunt', 100);
    hit(world, wall, 'blunt', 200);
    world.step();
    expect(log.broken).toHaveLength(1);
    expect(log.noises).toHaveLength(1);
    expect(readProperty(world, world.spawn(), 'hp')).toBe(100); // sanity: default
  });

  it('gives a breakable without hit points of its own its effective hp, so hits can wear it down', () => {
    const { world } = plain();
    const thing = world.spawn();
    placeEntity(world, thing, { x: 0, y: 0, z: 0 });
    makeBreakable(world, thing, POTTERY);
    expect(readProperty(world, thing, 'hp')).toBe(100);
    expect(readProperty(world, thing, 'breakable')).toBe(true);
    expect(world.get(thing, BreakableComponent)).toEqual({
      profile: 'pottery',
      resistances: {},
      debris: { count: 2, size: 0.1 },
      breakLoudness: 70,
      contents: [],
      reveals: null,
    });
    hit(world, thing, 'slash', 30);
    world.step();
    expect(readProperty(world, thing, 'hp')).toBe(70);
  });

  it('a break of something unplaced is centred on the origin', () => {
    const { world, log } = plain();
    const thing = world.spawn();
    makeBreakable(world, thing, POTTERY);
    hit(world, thing, 'blunt', 500);
    world.step();
    expect(log.broken[0]?.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(log.broken[0]?.cleared).toEqual({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
    });
  });

  it('stops listening once uninstalled', () => {
    const { world, off, log } = plain();
    const wall = breakable(world, OLD_WALL, { hp: 1 });
    off();
    hit(world, wall, 'blunt', 100);
    world.step();
    expect(log.broken).toEqual([]);
  });

  it('rejects bad options and a world without stimuli', () => {
    const fresh = () => installStimuli(registerWorldProperties(new World<never>({ seed: 1 })));
    expect(() => installBreakables(fresh(), { debrisBudget: -1 })).toThrow(RangeError);
    expect(() => installBreakables(fresh(), { debrisBudget: 1.5 })).toThrow(RangeError);
    expect(() => installBreakables(fresh(), { debrisLifetime: 0 })).toThrow(RangeError);
    expect(() => installBreakables(fresh(), { debrisLifetime: Infinity })).toThrow(RangeError);
    expect(() => installBreakables(fresh(), { frozenFragility: 0.5 })).toThrow(RangeError);
    expect(() => installBreakables(registerWorldProperties(new World<never>({ seed: 1 })))).toThrow(
      'install stimuli before breakables',
    );
    expect(() => liveDebris(fresh())).toThrow('breakables are not installed');
  });
});

describe('breakables: fragility (mw-e03.11)', () => {
  it('AC-2: an impact over its threshold breaks a fragile thing whatever the source — a blow, a fall, a throw — and it spills its contents', () => {
    const { world, log } = physical();
    const thrower = world.spawn();
    // A blow: 20 J of slash on a 15 J pot, though 20 slash would leave it hp.
    const struck = pot(world, -3, 0);
    // A fall: dropped from 2 m.
    const dropped = pot(world, 0, 0, 2);
    // A throw: a stone flung at a pot on the floor, blamed on the thrower.
    const target = pot(world, 3, 0);
    const stone = world.spawn();
    addProperties(world, stone, { material: 'stone', weight: 5 });
    addPhysicsObject(world, stone, {
      shape: { kind: 'box', halfExtents: { x: 0.1, y: 0.1, z: 0.1 } },
      position: { x: 1.5, y: 0.2, z: 0 },
      velocity: { x: 8, y: 0, z: 0 },
    });
    blame(world, stone, thrower);
    world.step();
    hit(world, struck, 'slash', 20, thrower);
    steps(world, 60);
    const byEntity = new Map(log.broken.map((b) => [b.entity, b]));
    expect(byEntity.get(struck)).toMatchObject({ cause: 'impact', by: 'slash', source: thrower });
    expect(byEntity.get(dropped)).toMatchObject({ cause: 'impact', by: 'collision', source: null });
    expect(byEntity.get(target)).toMatchObject({
      cause: 'impact',
      by: 'collision',
      source: thrower,
    });
    for (const broken of [struck, dropped, target]) {
      expect(world.isAlive(broken)).toBe(false);
      const info = byEntity.get(broken);
      // Two coins spill; the lever has no body and stays inside.
      expect(info?.spilled).toHaveLength(2);
      for (const coin of info?.spilled ?? []) {
        expect(world.get(coin, SpilledComponent)).toEqual({ prop: 'coin', from: broken });
        expect(world.has(coin, PhysicsObjectComponent)).toBe(true);
      }
    }
  });

  it('a gentle impact under the threshold does nothing', () => {
    const { world, log } = physical({}, false);
    const impacts: number[] = [];
    world.events.on(physicsImpact, (e) => impacts.push(e.energy));
    const jar = pot(world, 0, 0, 0.4); // a 20 cm drop: about 4 J
    steps(world, 30);
    expect(impacts.length).toBeGreaterThan(0);
    expect(Math.max(...impacts)).toBeLessThan(15);
    expect(log.broken).toEqual([]);
    expect(world.isAlive(jar)).toBe(true);
  });

  it('AC-3: frozen, its threshold is divided by the frozen fragility multiplier', () => {
    const { world, log } = plain();
    const ice = { hp: 400, fragile: 40, freezePoint: 0 };
    const frozen = breakable(world, OLD_WALL, { ...ice, frozen: true, temperature: -10 });
    const thawed = breakable(world, OLD_WALL, { ...ice, frozen: false });
    expect(breakThreshold(world, frozen)).toBe(40 / DEFAULT_FROZEN_FRAGILITY);
    expect(breakThreshold(world, thawed)).toBe(40);
    expect(breakThreshold(world, frozen, 8)).toBe(5);
    hit(world, frozen, 'blunt', 14);
    hit(world, thawed, 'blunt', 14);
    world.step();
    expect(log.broken.map((b) => [b.entity, b.cause])).toEqual([[frozen, 'impact']]);
    expect(world.isAlive(thawed)).toBe(true);
  });

  it('takes the world’s frozen fragility multiplier', () => {
    const { world, log } = plain({ frozenFragility: 2 });
    const frozen = breakable(world, OLD_WALL, { hp: 400, fragile: 40, frozen: true });
    hit(world, frozen, 'blunt', 12);
    world.step();
    expect(log.broken).toEqual([]);
    hit(world, frozen, 'blunt', 20);
    world.step();
    expect(log.broken).toHaveLength(1);
  });
});

const KIT: readonly KitPieceSpec[] = [
  {
    id: 'floor',
    purpose: 'walkable',
    parts: [{ shape: 'box', size: [10, 0.2, 10], offset: [0, -0.1, 0], collider: true }],
  },
  {
    id: 'wall',
    purpose: 'blocking',
    parts: [{ shape: 'box', size: [2, 3, 0.2], offset: [0, 1.5, 0], collider: true }],
  },
];
const kit: KitLookup = (id) => KIT.find((piece) => piece.id === id);

/** A floor, a weak wall 2 m along +z hiding a passage, and a pot full of coins. */
const SCENE = {
  id: 'weak-wall',
  grid: 1,
  placements: [
    { piece: { id: 'floor' }, at: [0, 0, 0], yaw: 0, scale: [1, 1, 1] },
    {
      piece: { id: 'wall' },
      at: [0, 0, 2],
      yaw: 0,
      scale: [1, 1, 1],
      properties: { hp: 100 },
      breakable: { profile: { id: 'old-wall' }, reveals: 'hidden-room' },
    },
  ],
  spawns: [
    { id: 'start', at: [0, 0, -2], yaw: 0, tags: ['player-start'] },
    {
      id: 'jar',
      at: [-2, 0, 0],
      yaw: 0,
      prop: { id: 'pot' },
      tags: [],
      breakable: { profile: { id: 'pottery' }, contents: [{ id: 'coin' }] },
    },
    {
      id: 'urn',
      at: [2, 0, 0],
      yaw: 0,
      tags: [],
      properties: { material: { id: 'clay' } },
      breakable: { profile: { id: 'pottery' } },
    },
    { id: 'vase', at: [3, 0, 0], yaw: 0, tags: [], breakable: { profile: { id: 'pottery' } } },
  ],
} as unknown as SceneSpec;

function weakWallScene(options: BreakablesOptions = {}) {
  const s = physical(options);
  const loaded = loadScene(s.world, SCENE, kit, s.physics);
  addScenePhysics(s.world, loaded, { props, materials: MATERIALS });
  const made = addSceneBreakables(s.world, loaded, (id) => PROFILES.get(id));
  return { ...s, loaded, made };
}

describe('breakables: what a break does (mw-e03.11)', () => {
  it('makes a scene’s breakable pieces and spawns breakable, placed where stimuli reach them', () => {
    const { world, loaded, made } = weakWallScene();
    const wall = must(loaded.pieces[1]);
    const [, jar, urn, vase] = loaded.spawns.map((s) => s.entity);
    expect(made).toEqual({ pieces: [wall], spawns: [jar, urn, vase] });
    expect(world.get(must(vase), PlacementComponent)).toEqual({ x: 3, y: 0, z: 0, radius: 0 });
    expect(world.get(wall, BreakableComponent)?.reveals).toBe('hidden-room');
    expect(world.get(must(jar), BreakableComponent)?.contents).toEqual(['coin']);
    expect(readProperty(world, wall, 'hp')).toBe(100);
    expect(world.has(must(jar), PhysicsObjectComponent)).toBe(true);
    const place = (e: EntityId) => world.get(e, PhysicsObjectComponent) ?? null;
    expect(place(must(urn))).toBeNull(); // no body: placed at its spawn point
    expect(() => addSceneBreakables(world, loaded, () => undefined)).toThrow(
      'unknown breakable profile "old-wall"',
    );
  });

  it('AC-4: the collider goes by the end of the tick, the passage is revealed and the break is heard', () => {
    const { world, physics, loaded, log } = weakWallScene();
    const knight = world.spawn();
    const wall = must(loaded.pieces[1]);
    const colliders = world.get(wall, PhysicsColliderComponent)?.colliders ?? [];
    expect(colliders).toHaveLength(1);
    world.step();
    hit(world, wall, 'blunt', 150, knight);
    world.step();
    expect(world.isAlive(wall)).toBe(false);
    for (const c of colliders) expect(physics.has(c as ColliderHandle)).toBe(false);
    const centre = { x: 0, y: 1.5, z: 2 };
    expect(log.broken).toEqual([
      expect.objectContaining({
        entity: wall,
        cause: 'structure',
        source: knight,
        position: centre,
        cleared: { min: { x: -1, y: 0, z: 1.9 }, max: { x: 1, y: 3, z: 2.1 } },
        reveals: 'hidden-room',
      }),
    ]);
    expect(log.passages).toEqual([
      { tick: 1, passage: 'hidden-room', entity: wall, source: knight, position: centre },
    ]);
    expect(log.noises).toEqual([
      { tick: 1, position: centre, loudness: 85, kind: 'break', entity: wall, source: knight },
    ]);
    // Debris: stone chunks inside where the wall stood, capped in weight, flying up and out.
    const debris = log.broken[0]?.debris ?? [];
    expect(debris).toHaveLength(3);
    for (const piece of debris) {
      expect(world.get(piece, DebrisComponent)).toEqual({ spawned: 1, from: wall });
      expect(readProperty(world, piece, 'material')).toBe('stone');
      expect(readProperty(world, piece, 'weight')).toBe(MAX_DEBRIS_WEIGHT);
      const at = world.get(piece, PhysicsObjectComponent)?.position;
      expect(at?.x).toBeGreaterThanOrEqual(-0.85);
      expect(at?.x).toBeLessThanOrEqual(0.85);
    }
    expect(liveDebris(world)).toEqual(debris);
  });

  it('small things leave light debris centred in them', () => {
    const { world, loaded, log } = weakWallScene();
    const urn = must(loaded.spawns[2]?.entity);
    hit(world, urn, 'blunt', 500);
    world.step();
    const [shard] = log.broken[0]?.debris ?? [];
    expect(readProperty(world, must(shard), 'weight')).toBeCloseTo(1.8, 9);
    expect(world.get(must(shard), PhysicsObjectComponent)?.position).toMatchObject({
      x: 2,
      z: 0,
    });
    expect(MIN_DEBRIS_WEIGHT).toBeLessThan(1800 * 0.1 ** 3);
  });

  it('debris clears itself after its lifetime', () => {
    const { world, loaded } = weakWallScene({ debrisLifetime: 0.5 });
    hit(world, must(loaded.pieces[1]), 'blunt', 500);
    world.step();
    const debris = liveDebris(world);
    expect(debris).toHaveLength(3);
    steps(world, 29);
    expect(liveDebris(world)).toEqual(debris);
    world.step();
    expect(liveDebris(world)).toEqual([]);
    for (const piece of debris) expect(world.isAlive(piece)).toBe(false);
  });

  it('skips culling debris something else already removed', () => {
    const { world, loaded, log } = weakWallScene({ debrisBudget: 3 });
    const wall = must(loaded.pieces[1]);
    hit(world, wall, 'blunt', 500);
    world.step();
    const [gone, ...older] = liveDebris(world) as EntityId[];
    world.destroy(must(gone));
    hit(world, must(loaded.spawns[2]?.entity), 'blunt', 500);
    world.step();
    // Two new shards over a budget of 3: the two oldest go, one of them already gone.
    expect(log.culled.flatMap((c) => c.culled)).toEqual([gone, older[0]]);
    expect(world.isAlive(must(older[0]))).toBe(false);
    expect(world.isAlive(must(older[1]))).toBe(true);
  });

  it('forgets debris something else removed', () => {
    const { world, loaded } = weakWallScene();
    hit(world, must(loaded.pieces[1]), 'blunt', 500);
    world.step();
    const [first, ...rest] = liveDebris(world);
    world.destroy(must(first));
    world.step();
    expect(liveDebris(world)).toEqual(rest);
  });

  it('leaves no debris without a budget or without physics objects, and spills nothing without props', () => {
    const none = weakWallScene({ debrisBudget: 0 });
    hit(none.world, must(none.loaded.pieces[1]), 'blunt', 500);
    none.world.step();
    expect(none.log.broken[0]?.debris).toEqual([]);
    const bare = plain();
    const jar = breakable(bare.world, OLD_WALL, { hp: 1 }, undefined, { contents: ['coin'] });
    hit(bare.world, jar, 'blunt', 50);
    bare.world.step();
    expect(bare.log.broken[0]).toMatchObject({ debris: [], spilled: [] });
  });
});

describe('breakables: the debris budget (mw-e03.11)', () => {
  /** Four placed pots in a row, broken by one blunt sphere in one tick. */
  function smashFour(budget: number) {
    const { world, log } = physical({ debrisBudget: budget });
    const pots = [0, 1, 2, 3].map((i) =>
      breakable(world, OLD_WALL, { hp: 10, material: 'stone' }, { x: i * 2, y: 1, z: 0 }),
    );
    world.step();
    const shape: StimulusShape = { kind: 'sphere', center: { x: 3, y: 1, z: 0 }, radius: 8 };
    applyStimulus(world, { shape, element: 'blunt', intensity: 100, falloff: 'none' });
    world.step();
    return { world, log, pots };
  }

  it('AC-5: many breaks in one tick over the budget cull the oldest debris first, and every break completes', () => {
    const { world, log, pots } = smashFour(5);
    expect(log.broken.map((b) => b.entity)).toEqual(pots);
    for (const p of pots) expect(world.isAlive(p)).toBe(false);
    const all = log.broken.flatMap((b) => b.debris);
    expect(all).toHaveLength(12);
    expect(liveDebris(world)).toEqual(all.slice(7));
    expect(log.culled.flatMap((c) => c.culled)).toEqual(all.slice(0, 7));
    expect(log.culled.every((c) => c.budget === 5)).toBe(true);
    for (const piece of all.slice(0, 7)) expect(world.isAlive(piece)).toBe(false);
    for (const piece of all.slice(7)) expect(world.isAlive(piece)).toBe(true);
    expect(world.query(DebrisComponent).ids()).toEqual(all.slice(7));
  });

  it('AC-5: older debris goes before newer, across ticks; culling is deterministic', () => {
    const run = () => {
      const s = smashFour(3);
      const pot = breakable(s.world, OLD_WALL, { hp: 1 }, { x: 0, y: 1, z: 5 });
      s.world.step();
      hit(s.world, pot, 'blunt', 50);
      s.world.step();
      return { ...s, pot, hash: hashWorld(s.world) };
    };
    const first = run();
    const newest = first.log.broken.at(-1)?.debris ?? [];
    expect(liveDebris(first.world)).toEqual(newest);
    expect(run().hash).toBe(first.hash);
  });
});
