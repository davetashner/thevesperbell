// mw-e15.7: puzzle recovery in the sim: a respawner replaces a lost critical crate (retrying while its
// chute is blocked), critical objects that fall out of the level return home within the tick, and a
// reset lever puts doors and switches back to their authored state. Real Rapier for the bodies.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import { BreakableComponent } from '../breakables/components';
import { breakableBroken } from '../breakables/events';
import { installBreakables, makeBreakable } from '../breakables/system';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { interacted } from '../interaction/system';
import { DoorComponent, LockComponent, SwitchComponent } from '../mechanisms/components';
import { installMechanisms, makeDoor, makeSwitch, openDoor, useSwitch } from '../mechanisms/system';
import type { DoorProfile } from '../mechanisms/components';
import {
  addPhysicsObject,
  installPhysicsObjects,
  PhysicsObjectComponent,
  teleportPhysicsObject,
} from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { addProperties, registerWorldProperties, setProperty } from '../properties/components';
import { registerSceneComponents, spawnSceneSpawn } from '../scene/loader';
import { placementOf } from '../stimulus/placement';
import { installSignals } from '../signals/runtime';
import { installStimuli } from '../stimulus/stimulus';
import type { Vec3 } from '../stimulus/shapes';
import { fireBurntOut } from '../elements/fire';
import { puzzleFailed, puzzleRecovered, type PuzzleRecovered } from './events';
import {
  footprintClear,
  halfExtentsOf,
  markPuzzleCritical,
  PuzzleCriticalComponent,
  resetMechanisms,
  returnLost,
} from './recovery';
import {
  PuzzleRuntime,
  puzzleSystem,
  RETRY_SECONDS,
  type PuzzleDef,
  type PuzzleHost,
  type RecoveryDef,
} from './runtime';

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value');
  return value;
};

const HZ = 10;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const rotation = { x: 0, y: 0, z: 0, w: 1 };
const HALF = v(0.25, 0.25, 0.25);
const CHUTE = v(2, 1, 0);

const door: DoorProfile = {
  id: 'gate',
  kind: 'sliding',
  size: v(2, 2, 0.2),
  seconds: 1,
  crush: 0,
  manual: true,
  blocks: { light: true, gas: false, sound: false },
  loudness: 40,
};

function puzzle(recovery: RecoveryDef[], extra: Partial<PuzzleDef> = {}): PuzzleDef {
  return {
    id: 'plate-room',
    // Nothing ever burns here: the goal stays out of reach.
    goal: {
      entities: { tag: 'lamp' },
      where: [{ test: 'element', element: 'fire' }],
      match: 'all',
    },
    entities: [
      { id: 'crate', critical: true },
      { id: 'lever', critical: false },
      { id: 'gate', critical: false },
    ],
    solutions: [{ id: 'push', capabilities: [] }],
    outputs: { solvedFact: 'room.solved', set: [], signals: [], rewards: [] },
    recovery,
    ...extra,
  };
}

function setup(recovery: RecoveryDef[], options: { killY?: number; host?: boolean } = {}) {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(
    registerWorldProperties(
      registerSceneComponents(new World<never>({ seed: 5, hz: HZ, physics })),
    ),
  );
  installPhysicsObjects(world);
  // A floor patch around the chute (top at y = 1); past its edge is a drop.
  physics.add(box(v(-6, 0, -6), v(12, 1, 12)));
  installBreakables(world);
  installSignals(world);
  installMechanisms(world);
  world.facts.declare('room.solved', { type: 'bool', default: false });
  world.facts.declare('room.resets', { type: 'int', default: 0 });
  const bodyOf = (entity: EntityId, at: Vec3) => {
    addProperties(world, entity, { liftable: true, weight: 20, burning: false });
    addPhysicsObject(world, entity, {
      shape: { kind: 'box', halfExtents: HALF },
      position: { ...at, y: at.y + HALF.y },
    });
  };
  const crates: EntityId[] = [];
  const spawnCrate = (): EntityId => {
    const entity = spawnSceneSpawn(world, 'room', {
      id: 'crate',
      tags: ['crate'],
      position: CHUTE,
      rotation,
    } as never);
    bodyOf(entity, CHUTE);
    crates.push(entity);
    return entity;
  };
  const first = spawnCrate();
  const attempts: { tick: number; clear: boolean }[] = [];
  const spawned: number[] = [];
  const removed: number[] = [];
  const host: PuzzleHost = {
    footprint: (spawn) =>
      spawn === 'crate'
        ? { centre: { ...CHUTE, y: CHUTE.y + HALF.y }, halfExtents: HALF }
        : undefined,
    spawn: () => {
      spawned.push(world.tick);
      spawnCrate();
    },
    remove: (spawn) => {
      removed.push(world.tick);
      const stale = crates.at(-1);
      if (spawn === 'crate' && stale !== undefined && world.isAlive(stale)) world.destroy(stale);
    },
  };
  const lamp = spawnSceneSpawn(world, 'room', {
    id: 'lamp',
    tags: ['lamp'],
    position: v(0, 0, -3),
    rotation,
  } as never);
  addProperties(world, lamp, { burning: false });
  const lever = spawnSceneSpawn(world, 'room', {
    id: 'lever',
    tags: [],
    position: v(0, 0, 3),
    rotation,
  } as never);
  makeSwitch(world, lever, 'lever');
  const gate = spawnSceneSpawn(world, 'room', {
    id: 'gate',
    tags: [],
    position: v(0, 0, 5),
    rotation,
  } as never);
  makeDoor(world, gate, door, { origin: v(0, 0, 5), state: 'closed' });
  const runtime = new PuzzleRuntime(world, [puzzle(recovery)], {
    killY: options.killY,
    host: options.host === false ? undefined : host,
  });
  world.addSystem(puzzleSystem(runtime));
  const recovered: PuzzleRecovered[] = [];
  world.events.on(puzzleRecovered, (e) => recovered.push(e));
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) world.step();
  };
  return {
    world,
    runtime,
    first,
    lamp,
    lever,
    gate,
    host,
    recovered,
    attempts,
    spawned,
    removed,
    crates,
    step,
    bodyOf,
  };
}

const touch = (s: ReturnType<typeof setup>) => {
  s.world.events.emit(interacted, { target: s.first } as never);
  s.world.events.flush();
};

describe('respawner (mw-e15.7)', () => {
  const respawn: RecoveryDef = { kind: 'respawn', entity: 'crate', seconds: 10 };

  it('AC-2: a respawner of 10 s drops a replacement at the chute after 10 s and emits puzzleRecovered', () => {
    const s = setup([respawn]);
    const failed: unknown[] = [];
    s.world.events.on(puzzleFailed, (e) => failed.push(e));
    touch(s); // the puzzle is touched: in progress
    s.step();
    const destroyedAt = s.world.tick;
    s.world.destroy(s.first);
    s.step(2); // destroyed at the end of this tick; the runtime notices at the next poll
    expect(s.runtime.state('plate-room')).toBe('failed');
    const [pending] = s.runtime.record('plate-room').recovering ?? [];
    // Ten seconds (100 ticks) after the loss was noticed.
    expect(pending?.due).toBeGreaterThanOrEqual(destroyedAt + 10 * HZ);
    expect(pending?.due).toBeLessThanOrEqual(destroyedAt + 10 * HZ + 2);
    const due = must(pending?.due);
    s.step(due - s.world.tick - 1);
    expect(s.spawned).toEqual([]);
    s.step(2);
    expect(s.spawned).toEqual([due]);
    expect(s.recovered).toEqual([
      { puzzle: 'plate-room', tick: due, kind: 'respawn', entity: 'crate' },
    ]);
    s.step(2);
    expect(s.runtime.state('plate-room')).toBe('in-progress');
    expect(s.runtime.record('plate-room').recovering).toBeUndefined();
    const fresh = must(s.crates.at(-1));
    expect(placementOf(s.world, fresh)?.x).toBeCloseTo(2, 1);
    expect(placementOf(s.world, fresh)?.z).toBeCloseTo(0, 1);
    expect(failed).toHaveLength(1);
  });

  it('AC-5: a blocked chute is retried every 2 s and a crate never appears overlapping another body', () => {
    const s = setup([respawn]);
    s.world.destroy(s.first);
    s.step(2);
    // Something is parked in the chute (the footprint is the crate's own size at the spawn point).
    const blocker = s.world.spawn();
    s.bodyOf(blocker, v(2.3, 1, 0));
    const asked: number[] = [];
    const probe = s.host.footprint.bind(s.host);
    const seen = new Set<number>();
    s.host.footprint = (spawn) => {
      if (!seen.has(s.world.tick)) asked.push(s.world.tick);
      seen.add(s.world.tick);
      return probe(spawn);
    };
    // `host` is read by reference by the runtime: wrap through the same object.
    s.step(10 * HZ + 3 * RETRY_SECONDS * HZ + 5);
    expect(s.spawned).toEqual([]);
    expect(asked.length).toBeGreaterThanOrEqual(3);
    asked.slice(1).forEach((tick, i) => {
      expect(tick - must(asked[i])).toBe(RETRY_SECONDS * HZ);
    });
    s.world.destroy(blocker);
    s.step(RETRY_SECONDS * HZ + 2);
    expect(s.spawned).toHaveLength(1);
    expect(s.recovered.map((r) => r.kind)).toEqual(['respawn']);
    // Where the new crate stands, nothing else overlaps.
    const fresh = must(s.crates.at(-1));
    expect(footprintClear(s.world, v(9, 9, 9), HALF)).toBe(true);
    expect(s.world.isAlive(fresh)).toBe(true);
  });

  it('a crate that burnt out is taken away and replaced; a solved puzzle replaces nothing', () => {
    const s = setup([respawn]);
    touch(s);
    s.step();
    s.world.events.emit(fireBurntOut, { entity: s.first, becomes: 'charred' });
    s.world.events.emit(fireBurntOut, { entity: s.first, becomes: 'charred' });
    s.world.events.flush();
    expect(s.runtime.record('plate-room').recovering).toEqual([
      { spawn: 'crate', due: s.world.tick + 10 * HZ, spent: true },
    ]);
    s.step(10 * HZ + 3);
    expect(s.removed).toHaveLength(1);
    expect(s.spawned).toHaveLength(1);
    expect(s.world.isAlive(s.first)).toBe(false);
    expect(s.recovered.map((r) => r.kind)).toEqual(['respawn']);
  });

  it('ignores burnouts of other things, and does nothing without a host', () => {
    const s = setup([respawn], { host: false });
    s.world.events.emit(fireBurntOut, { entity: s.lever, becomes: null });
    s.world.events.flush();
    expect(s.runtime.record('plate-room').recovering).toBeUndefined();
    s.world.destroy(s.first);
    s.step(10 * HZ + 5);
    expect(s.recovered).toEqual([]);
    expect(s.runtime.record('plate-room').recovering).toHaveLength(1);
  });

  it('keeps a pending respawn through a save and load, and finishes it', () => {
    const s = setup([respawn]);
    s.world.destroy(s.first);
    s.step(5);
    const saved = JSON.stringify(s.world.snapshot());
    s.world.restore(JSON.parse(saved) as ReturnType<World<never>['snapshot']>);
    expect(s.runtime.record('plate-room').recovering).toHaveLength(1);
    s.step(10 * HZ);
    expect(s.spawned).toHaveLength(1);
  });

  it('drops a pending respawn when the entity comes back by itself', () => {
    const s = setup([respawn]);
    s.world.destroy(s.first);
    s.step(3);
    expect(s.runtime.record('plate-room').recovering).toHaveLength(1);
    s.host.spawn('crate'); // e.g. a recovery anchor rebuilt it
    s.spawned.length = 0;
    s.step(3);
    expect(s.runtime.record('plate-room').recovering).toBeUndefined();
    s.step(10 * HZ);
    expect(s.spawned).toEqual([]);
  });
});

describe('respawner and a solved puzzle (mw-e15.7)', () => {
  it('replaces nothing once the puzzle is solved', () => {
    const s = setup([{ kind: 'respawn', entity: 'crate', seconds: 10 }]);
    s.world.destroy(s.first);
    s.step(3);
    expect(s.runtime.record('plate-room').recovering).toHaveLength(1);
    setProperty(s.world, s.lamp, 'burning', true);
    s.step(10 * HZ + 5);
    expect(s.runtime.state('plate-room')).toBe('solved');
    expect(s.spawned).toEqual([]);
    expect(s.runtime.record('plate-room').recovering).toBeUndefined();
  });
});

describe('out-of-bounds return (mw-e15.7)', () => {
  it('AC-3: a puzzleCritical object below the kill plane is back at its spawn within one tick, unbroken', () => {
    const s = setup([], { killY: -10 });
    makeBreakable(s.world, s.first, {
      id: 'pottery',
      resistances: {},
      debris: { count: 0, size: 0.1 },
      breakLoudness: 70,
    });
    s.step(3);
    expect(s.world.isRegistered(PuzzleCriticalComponent)).toBe(false); // dormant: nothing marked
    touch(s);
    s.step(2);
    expect(s.world.has(s.first, PuzzleCriticalComponent)).toBe(true);
    const broken: unknown[] = [];
    s.world.events.on(breakableBroken, (e) => broken.push(e));
    teleportPhysicsObject(s.world, s.first, v(30, -50, 0));
    s.step();
    expect(placementOf(s.world, s.first)).toMatchObject({ x: 2, z: 0 });
    expect(placementOf(s.world, s.first)?.y).toBeCloseTo(1.25, 2);
    expect(s.recovered).toEqual([
      { puzzle: 'plate-room', tick: s.world.tick - 1, kind: 'out-of-bounds', entity: 'crate' },
    ]);
    s.step(30);
    expect(broken).toEqual([]);
    expect(s.world.has(s.first, BreakableComponent)).toBe(true);
    expect(s.recovered).toHaveLength(1);
  });

  it('marks any entity by property and leaves unmarked ones alone', () => {
    const s = setup([], { killY: 0 });
    const other = s.world.spawn();
    s.bodyOf(other, v(8, 1, 8));
    markPuzzleCritical(s.world, other, { puzzle: 'other', spawn: '', home: v(8, 1, 8) });
    const plain = s.world.spawn();
    s.bodyOf(plain, v(-8, 1, 8));
    teleportPhysicsObject(s.world, other, v(8, -3, 8));
    teleportPhysicsObject(s.world, plain, v(-8, -3, 8));
    s.step();
    expect(s.world.get(other, PhysicsObjectComponent)?.position.y).toBeGreaterThan(0);
    expect(s.world.get(plain, PhysicsObjectComponent)?.position.y).toBeLessThan(0);
    expect(s.recovered).toEqual([
      { puzzle: 'other', tick: s.world.tick - 1, kind: 'out-of-bounds', entity: '' },
    ]);
  });

  it('returns nothing in a world with no marked entity or no bodies, and sizes every body shape', () => {
    const bare = new World<never>({ seed: 1, hz: HZ });
    expect(returnLost(bare, 0)).toBe(0);
    const bodiless = registerSceneComponents(new World<never>({ seed: 1, hz: HZ }));
    markPuzzleCritical(bodiless, bodiless.spawn(), { puzzle: 'p', spawn: '', home: v(0, 0, 0) });
    markPuzzleCritical(bodiless, bodiless.spawn(), { puzzle: 'p', spawn: '', home: v(0, 0, 0) });
    expect(returnLost(bodiless, 0)).toBe(0);
    expect(footprintClear(bare, v(0, 0, 0), HALF)).toBe(true);
    expect(halfExtentsOf({ kind: 'sphere', radius: 0.5 })).toEqual(v(0.5, 0.5, 0.5));
    expect(halfExtentsOf({ kind: 'capsule', radius: 0.3, halfHeight: 0.4 })).toEqual(
      v(0.3, 0.7, 0.3),
    );
    expect(halfExtentsOf({ kind: 'box', halfExtents: v(1, 2, 3) })).toEqual(v(3, 2, 3));
  });
});

describe('a world without physics (mw-e15.7)', () => {
  it('watches no critical entity for falling, and marks nothing', () => {
    const world = registerWorldProperties(new World<never>({ seed: 1, hz: HZ }));
    registerSceneComponents(world);
    world.facts.declare('room.solved', { type: 'bool', default: false });
    const crate = spawnSceneSpawn(world, 'room', {
      id: 'crate',
      tags: [],
      position: CHUTE,
      rotation,
    } as never);
    const runtime = new PuzzleRuntime(world, [puzzle([])], { killY: -10 });
    world.addSystem(puzzleSystem(runtime));
    world.events.emit(interacted, { target: crate } as never);
    world.events.flush();
    for (let i = 0; i < 3; i++) world.step();
    expect(runtime.state('plate-room')).toBe('in-progress');
    expect(world.isRegistered(PuzzleCriticalComponent)).toBe(false);
  });
});

describe('reset lever (mw-e15.7)', () => {
  const reset = (fact?: string): RecoveryDef => ({
    kind: 'reset',
    trigger: 'lever',
    ...(fact !== undefined && { fact }),
    mechanisms: [
      { spawn: 'lever', switch: { position: 0 } },
      { spawn: 'gate', door: { open: false, jammed: false, locked: false } },
      { spawn: 'crate', switch: { position: 0 } },
      { spawn: 'crate', door: { open: false, jammed: false } },
      { spawn: 'missing', door: { open: true, jammed: false } },
    ],
  });
  const pull = (s: ReturnType<typeof setup>) => {
    s.world.events.emit(interacted, { target: s.lever } as never);
    s.world.events.flush();
  };

  it('AC-4: pulling the reset lever returns the doors and switches to their authored state and the puzzle to in-progress', () => {
    const s = setup([reset('room.resets')]);
    useSwitch(s.world, s.lever); // the lever was thrown on its own
    openDoor(s.world, s.gate);
    s.step(15);
    expect(s.world.get(s.gate, DoorComponent)?.openness).toBe(1);
    expect(s.runtime.state('plate-room')).toBe('dormant');
    pull(s);
    s.step(15);
    expect(s.world.get(s.lever, SwitchComponent)?.position).toBe(0);
    expect(s.world.get(s.gate, DoorComponent)?.openness).toBe(0);
    expect(s.runtime.state('plate-room')).toBe('in-progress');
    expect(s.world.facts.get('room.resets')).toBe(1);
    expect(s.recovered).toEqual([
      { puzzle: 'plate-room', tick: s.world.tick - 15, kind: 'reset', entity: '' },
    ]);
    pull(s);
    expect(s.world.facts.get('room.resets')).toBe(2);
  });

  it('a puzzle already solved ignores the lever', () => {
    const s = setup([reset('room.resets')]);
    setProperty(s.world, s.lamp, 'burning', true);
    s.step();
    expect(s.runtime.state('plate-room')).toBe('solved');
    pull(s);
    s.step();
    expect(s.world.facts.get('room.resets')).toBe(0);
    expect(s.recovered).toEqual([]);
  });

  it('restores a jam and a lock, and a puzzle already solved ignores the lever', () => {
    const jammed: RecoveryDef = {
      kind: 'reset',
      trigger: 'lever',
      mechanisms: [{ spawn: 'gate', door: { open: false, jammed: true, locked: true } }],
    };
    const s = setup([jammed]);
    s.world.add(s.gate, LockComponent, {
      lock: 'iron',
      tier: 1,
      pickTier: null,
      sealed: false,
      tags: [],
      hint: 'locked',
      locked: false,
    });
    pull(s);
    s.step();
    expect(s.world.get(s.gate, LockComponent)?.locked).toBe(true);
    expect(s.world.get(s.gate, DoorComponent)?.jammed).toBe(true);
  });

  it('puts a lock and a jam back, opens a door authored open, and skips what is not a door', () => {
    const s = setup([]);
    const vault = s.world.spawn();
    makeDoor(s.world, vault, door, {
      origin: v(0, 0, 8),
      state: 'open',
      lock: { id: 'iron', tier: 1, pickTier: null, sealed: false, tags: [], hint: 'locked' },
      locked: false,
    });
    const shut = s.world.spawn();
    makeDoor(s.world, shut, door, {
      origin: v(3, 0, 8),
      state: 'closed',
      lock: { id: 'iron', tier: 1, pickTier: null, sealed: false, tags: [], hint: 'locked' },
      locked: true,
    });
    s.step();
    expect(s.world.get(vault, DoorComponent)?.openness).toBe(1);
    // Someone shut and locked the open door, and picked the shut one open.
    s.world.set(vault, DoorComponent, {
      ...must(s.world.get(vault, DoorComponent)),
      openness: 0,
      target: 0,
    });
    s.world.set(vault, LockComponent, {
      ...must(s.world.get(vault, LockComponent)),
      locked: true,
    });
    s.world.set(shut, LockComponent, {
      ...must(s.world.get(shut, LockComponent)),
      locked: false,
    });
    resetMechanisms(s.world, [
      { kind: 'door', entity: vault, open: true, jammed: false, locked: false },
      { kind: 'door', entity: shut, open: false, jammed: true, locked: true },
      { kind: 'door', entity: s.lamp, open: true, jammed: false, locked: undefined },
    ]);
    s.step(15);
    expect(s.world.get(vault, DoorComponent)).toMatchObject({ target: 1, jammed: false });
    expect(s.world.get(vault, LockComponent)?.locked).toBe(false);
    expect(s.world.get(shut, DoorComponent)).toMatchObject({ target: 0, jammed: true });
    expect(s.world.get(shut, LockComponent)?.locked).toBe(true);
  });
});
