// Doors, locks and switches (mw-e03.18): unlocking with a key, obstruction, lever → portcullis
// signals, burning out, crushing and wedging, and frozen switches, plus the rest of the rules.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { breakableBroken } from '../breakables/events';
import { installBreakables, makeBreakable } from '../breakables/system';
import { fireBurntOut, fireRules, type FireBurnout } from '../elements/fire';
import { ElementRuleSet, elementRulesSystem } from '../elements/rules';
import { elementFieldOf, elementFieldSystem, installElementField } from '../field/install';
import { InteractableComponent, INTERACTION_COMPONENTS, interacted } from '../interaction/system';
import type { AffordanceVerb } from '../interaction/affordance';
import { addInventory, InventoryRules, type InventoryItemDef } from '../inventory/inventory';
import { LightField } from '../light/field';
import { noiseEmitted, type NoiseEvent } from '../noise/events';
import { installPhysicsObjects, PhysicsColliderComponent } from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { RapierSightWorld } from '../physics/rapier-sight-world';
import { InMemoryColliderSink, type ColliderHandle } from '../physics/static-colliders';
import {
  addProperties,
  assignProperty,
  registerWorldProperties,
  type WorldPropertyInit,
} from '../properties/components';
import type { MaterialPresets } from '../properties/materials';
import { registerSceneComponents, ScenePieceComponent } from '../scene/loader';
import type { SignalGraphDef } from '../signals/graph';
import { addSignalGraph, installSignals, signalOutput, signalSystem } from '../signals/runtime';
import { characterCentre } from '../character/stimuli';
import {
  PlacementCentreComponent,
  PlacementComponent,
  placeEntity,
  setPlacementCentre,
} from '../stimulus/placement';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  DoorComponent,
  LockComponent,
  SwitchComponent,
  type Door,
  type DoorProfile,
  type LockSpec,
} from './components';
import {
  doorBlocked,
  doorStateChanged,
  lockRefused,
  lockUnlocked,
  mechanismJammed,
  switchUsed,
  type DoorBlocked,
  type DoorStateChange,
  type LockRefused,
  type LockUnlocked,
  type MechanismJammed,
  type SwitchUsed,
} from './events';
import { closedBox } from './geometry';
import { cos, hypot, sin } from '../math';
import { keyFits, keyring } from './keys';
import {
  closeDoor,
  doorAffordances,
  doorShutsOut,
  doorState,
  doorStatus,
  installMechanisms,
  jamDoor,
  lockDoor,
  LOCKPICK_CAPABILITY,
  makeDoor,
  makeSwitch,
  moveDoor,
  openDoor,
  refreshAffordances,
  setSwitch,
  slamDoor,
  doorLoudness,
  SLAM_SPEED,
  switchPositions,
  syncSwitchNodes,
  unlockDoor,
  useSwitch,
  type MechanismsOptions,
} from './system';

const WOODEN_DOOR: DoorProfile = {
  id: 'wooden-door',
  kind: 'hinged',
  size: { x: 1.2, y: 2.2, z: 0.1 },
  seconds: 1,
  crush: 0,
  manual: true,
  blocks: { light: true, gas: true, sound: true },
  loudness: 50,
};
const PORTCULLIS: DoorProfile = {
  id: 'portcullis',
  kind: 'portcullis',
  size: { x: 1.2, y: 2.2, z: 0.1 },
  seconds: 2,
  crush: 500,
  manual: false,
  blocks: { light: false, gas: false, sound: false },
  loudness: 70,
};
const TOWER_LOCK: LockSpec = {
  id: 'tower-door',
  tier: 2,
  pickTier: 2,
  sealed: false,
  tags: ['warden-tower'],
  hint: 'Locked. Perhaps the warden has the key.',
};
const ITEMS: InventoryItemDef[] = [
  {
    id: 'tower-key',
    category: 'key',
    stackable: false,
    flags: { unique: false, questItem: false },
    key: { opens: ['tower-door'] },
  },
  {
    id: 'master-key',
    category: 'key',
    stackable: false,
    flags: { unique: false, questItem: false },
    key: { opens: [], opensTag: 'warden-tower' },
  },
  {
    id: 'odd-key',
    category: 'key',
    stackable: false,
    flags: { unique: false, questItem: false },
  },
  {
    id: 'bread',
    category: 'consumable',
    stackable: true,
    maxStack: 5,
    flags: { unique: false, questItem: false },
  },
];
const ORIGIN = { x: 0, y: 0, z: 0 };

interface Log {
  readonly states: DoorStateChange[];
  readonly blocked: DoorBlocked[];
  readonly unlocked: LockUnlocked[];
  readonly refused: LockRefused[];
  readonly used: SwitchUsed[];
  readonly jammed: MechanismJammed[];
  readonly noises: NoiseEvent[];
}

function listen(world: World<never>): Log {
  const log: Log = {
    states: [],
    blocked: [],
    unlocked: [],
    refused: [],
    used: [],
    jammed: [],
    noises: [],
  };
  world.events.on(doorStateChanged, (e) => log.states.push(e));
  world.events.on(doorBlocked, (e) => log.blocked.push(e));
  world.events.on(lockUnlocked, (e) => log.unlocked.push(e));
  world.events.on(lockRefused, (e) => log.refused.push(e));
  world.events.on(switchUsed, (e) => log.used.push(e));
  world.events.on(mechanismJammed, (e) => log.jammed.push(e));
  world.events.on(noiseEmitted, (e) => log.noises.push(e));
  return log;
}

/** A world with properties, stimuli, interaction components, signals and mechanisms. */
function setup(options: MechanismsOptions = {}, interaction = true) {
  const world = installSignals(
    installStimuli(registerWorldProperties(new World<never>({ seed: 7 }))),
  );
  if (interaction) world.register(...INTERACTION_COMPONENTS);
  world.addSystem(stimulusSystem()).addSystem(signalSystem());
  const colliders = new InMemoryColliderSink();
  const occluders = new InMemoryColliderSink();
  const off = installMechanisms(world, { colliders, occluders, ...options });
  return { world, colliders, occluders, off, log: listen(world) };
}

function door(
  world: World<never>,
  profile: DoorProfile = WOODEN_DOOR,
  instance: Partial<Parameters<typeof makeDoor>[3]> = {},
  init: WorldPropertyInit = {},
): EntityId {
  const entity = world.spawn();
  addProperties(world, entity, init);
  makeDoor(world, entity, profile, { origin: ORIGIN, ...instance });
  refreshAffordances(world, entity);
  return entity;
}

/** A body (a crate, a pot) at `at` with bounding radius `radius`. */
function body(
  world: World<never>,
  at: { x: number; y: number; z: number },
  radius = 0.3,
  init: WorldPropertyInit = {},
): EntityId {
  const entity = world.spawn();
  addProperties(world, entity, init);
  placeEntity(world, entity, at, radius);
  return entity;
}

function interact(world: World<never>, actor: EntityId, target: EntityId, verb: AffordanceVerb) {
  world.events.emit(interacted, { actor, target, verb, affordance: 0 });
  world.step();
}

const steps = (world: World<never>, n: number): void => {
  for (let i = 0; i < n; i++) world.step();
};

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const doorOf = (world: World<never>, entity: EntityId): Door =>
  must(world.get(entity, DoorComponent));

/** A player with an inventory holding `items`. */
function player(world: World<never>, rules: InventoryRules, items: readonly string[]): EntityId {
  const actor = world.spawn();
  addInventory(world, actor);
  for (const item of items) rules.add(world, actor, item, 1);
  return actor;
}

describe('locks (mw-e03.18)', () => {
  it('AC-1: a player holding the matching key unlocks the door with Unlock; the unlocked event names the player', () => {
    const rules = new InventoryRules(ITEMS);
    const { world, log } = setup({ keys: keyring(rules) });
    const gate = door(world, WOODEN_DOOR, { lock: TOWER_LOCK });
    const actor = player(world, rules, ['bread', 'odd-key', 'tower-key']);
    expect(doorStatus(world, gate)).toBe('locked');
    expect(doorStatus(world, actor)).toBeUndefined();

    interact(world, actor, gate, 'unlock');
    expect(must(world.get(gate, LockComponent)).locked).toBe(false);
    expect(log.unlocked).toEqual([
      {
        tick: 0,
        entity: gate,
        lock: 'tower-door',
        by: 'key',
        source: actor,
        key: 'tower-key',
      },
    ]);
    // It opens straight away, without an inventory screen.
    expect(doorOf(world, gate).target).toBe(1);
    expect(doorStatus(world, gate)).toBe('opening');
  });

  it('AC-1: a master key opens by tag; without a key the lock holds and gives its hint', () => {
    const rules = new InventoryRules(ITEMS);
    const { world, log } = setup({ keys: keyring(rules) });
    const gate = door(world, WOODEN_DOOR, { lock: TOWER_LOCK });
    const empty = player(world, rules, ['bread']);
    interact(world, empty, gate, 'unlock');
    expect(log.refused).toEqual([
      {
        tick: 0,
        entity: gate,
        lock: 'tower-door',
        reason: 'no-key',
        hint: 'Locked. Perhaps the warden has the key.',
        source: empty,
      },
    ]);
    expect(doorStatus(world, gate)).toBe('locked');
    const warden = player(world, rules, ['master-key']);
    interact(world, warden, gate, 'unlock');
    expect(log.unlocked.map((e) => e.key)).toEqual(['master-key']);
    // Unlocking an open lock again does nothing more.
    interact(world, warden, gate, 'unlock');
    expect(log.unlocked).toHaveLength(1);
  });

  it('keys fit by lock id or tag', () => {
    const lock = { lock: 'tower-door', tags: ['warden-tower'] };
    expect(keyFits({ opens: ['tower-door'] }, lock)).toBe(true);
    expect(keyFits({ opens: [], opensTag: 'warden-tower' }, lock)).toBe(true);
    expect(keyFits({ opens: ['cellar'], opensTag: 'crypt' }, lock)).toBe(false);
    expect(keyFits({ opens: ['cellar'] }, lock)).toBe(false);
  });

  it('without a key finder, keys open nothing', () => {
    const { world, log } = setup();
    const gate = door(world, WOODEN_DOOR, { lock: TOWER_LOCK });
    interact(world, world.spawn(), gate, 'unlock');
    expect(log.refused.map((e) => e.reason)).toEqual(['no-key']);
  });

  it('picks a pickable lock, and the pick hook can fail', () => {
    let succeed = false;
    const { world, log } = setup({ pick: () => succeed });
    const gate = door(world, WOODEN_DOOR, { lock: TOWER_LOCK });
    const thief = world.spawn();
    interact(world, thief, gate, 'pick-lock');
    expect(log.refused.map((e) => e.reason)).toEqual(['pick-failed']);
    succeed = true;
    interact(world, thief, gate, 'pick-lock');
    expect(log.unlocked).toEqual([
      expect.objectContaining({ by: 'pick', source: thief, key: null }),
    ]);
    expect(doorOf(world, gate).target).toBe(1);
    // An unlocked door's lock yields to a pick at once.
    interact(world, thief, gate, 'pick-lock');
    expect(log.unlocked).toHaveLength(1);
  });

  it('picks by default, refuses an unpickable lock, and a seal stops keys and picks until magic', () => {
    const rules = new InventoryRules(ITEMS);
    const { world, log } = setup({ keys: keyring(rules) });
    const plain = door(world, WOODEN_DOOR, { lock: TOWER_LOCK });
    const vault = door(world, WOODEN_DOOR, { lock: { ...TOWER_LOCK, pickTier: null } });
    const sealed = door(world, WOODEN_DOOR, { lock: { ...TOWER_LOCK, sealed: true } });
    const actor = player(world, rules, ['tower-key']);
    interact(world, actor, plain, 'pick-lock');
    expect(log.unlocked.map((e) => e.by)).toEqual(['pick']);
    interact(world, actor, vault, 'pick-lock');
    interact(world, actor, sealed, 'pick-lock');
    interact(world, actor, sealed, 'unlock');
    expect(log.refused.map((e) => e.reason)).toEqual(['unpickable', 'sealed', 'sealed']);
    expect(unlockDoor(world, sealed, { by: 'key' })).toBe(false);
    expect(unlockDoor(world, sealed, { by: 'magic', source: actor })).toBe(true);
    world.step();
    expect(must(world.get(sealed, LockComponent)).sealed).toBe(false);
    expect(log.unlocked.at(-1)).toMatchObject({ by: 'magic', source: actor, key: null });
    // Doors without a lock: nothing to unlock or pick, and they stay shut.
    const bare = door(world);
    interact(world, actor, bare, 'unlock');
    interact(world, actor, bare, 'pick-lock');
    expect(doorOf(world, bare).target).toBe(0);
    expect(unlockDoor(world, bare, { by: 'magic' })).toBe(false);
  });

  it('a locked door refuses to move until unlocked, and locks again only when closed', () => {
    const { world, log } = setup();
    const gate = door(world, WOODEN_DOOR, { lock: TOWER_LOCK });
    expect(openDoor(world, gate)).toBe(false);
    world.step();
    expect(log.refused.map((e) => e.reason)).toEqual(['locked']);
    expect(lockDoor(world, gate)).toBe(false); // already locked
    expect(unlockDoor(world, gate, { by: 'magic' })).toBe(true);
    expect(openDoor(world, gate)).toBe(true);
    expect(lockDoor(world, gate)).toBe(false); // not closed
    world.step();
    expect(closeDoor(world, gate)).toBe(true);
    steps(world, 2);
    expect(doorStatus(world, gate)).toBe('closed');
    expect(lockDoor(world, gate)).toBe(true);
    expect(doorStatus(world, gate)).toBe('locked');
    expect(lockDoor(world, door(world))).toBe(false); // no lock
    expect(lockDoor(world, world.spawn())).toBe(false); // not a door
  });

  it('a door that starts unlocked with a lock offers Open', () => {
    const { world } = setup();
    const gate = door(world, WOODEN_DOOR, { lock: TOWER_LOCK, locked: false });
    expect(doorStatus(world, gate)).toBe('closed');
  });
});

describe('door motion', () => {
  it('opens at its speed, emits noise when it sets off, and reports each state', () => {
    const { world, log } = setup();
    const gate = door(world);
    expect(doorStatus(world, gate)).toBe('closed');
    expect(openDoor(world, gate, 9)).toBe(true);
    expect(openDoor(world, gate)).toBe(false); // already heading there
    world.step();
    expect(log.noises).toEqual([
      {
        tick: 0,
        position: { x: 0, y: 1.1, z: 0 },
        loudness: 50,
        kind: 'door',
        entity: gate,
        source: 9,
      },
    ]);
    steps(world, 29);
    expect(doorOf(world, gate).openness).toBeCloseTo(0.5);
    steps(world, 30);
    expect(doorStatus(world, gate)).toBe('open');
    expect(log.states.map((e) => [e.from, e.to])).toEqual([
      ['closed', 'opening'],
      ['opening', 'open'],
    ]);
    expect(moveDoor(world, world.spawn(), 1)).toBe(false);
  });

  it('AC-2: a hinged door opening into a crate stops against it without going in, reports blocked once, and finishes once the crate is gone', () => {
    const { world, log } = setup();
    const gate = door(world);
    const crate = body(world, { x: 0, y: 0.3, z: 0.6 });
    openDoor(world, gate);
    steps(world, 60);
    const stopped = doorOf(world, gate);
    expect(doorStatus(world, gate)).toBe('blocked');
    expect(stopped.blockedBy).toBe(crate);
    expect(stopped.openness).toBeGreaterThan(0.2);
    expect(stopped.openness).toBeLessThan(0.35);
    expect(log.blocked).toEqual([
      expect.objectContaining({ entity: gate, by: crate, crushed: false, kind: 'hinged' }),
    ]);
    // The leaf at the stop (from its hinge at x = −0.6, turned towards +z) keeps out of the crate.
    const angle = (stopped.openness * Math.PI) / 2;
    for (let i = 0; i <= 10; i++) {
      const along = (1.2 * i) / 10;
      const x = -0.6 + along * cos(angle);
      const z = along * sin(angle);
      expect(hypot(x - 0, z - 0.6)).toBeGreaterThanOrEqual(0.3 - 1e-9);
    }
    world.destroy(crate);
    steps(world, 60);
    expect(doorStatus(world, gate)).toBe('open');
    expect(log.states.map((e) => e.to)).toEqual(['opening', 'blocked', 'opening', 'open']);
  });

  it('stops against whichever body it meets first, opening or closing', () => {
    const { world, log } = setup();
    // Fast doors, so both bodies lie in one tick's sweep.
    const swing = door(world, { ...WOODEN_DOOR, seconds: 1 / 60 });
    const first = body(world, { x: 0.4, y: 0.3, z: 0.4 }, 0.15);
    const later = body(world, { x: -0.3, y: 0.3, z: 0.3 }, 0.1);
    openDoor(world, swing);
    world.step();
    expect(doorOf(world, swing).blockedBy).toBe(first);
    const gate = door(
      world,
      { ...PORTCULLIS, seconds: 1 / 60 },
      { origin: { x: 5, y: 0, z: 0 }, state: 'open' },
    );
    const tall = body(world, { x: 5.3, y: 0.6, z: 0 }, 0.2);
    body(world, { x: 5, y: 0.2, z: 0 }, 0.2);
    closeDoor(world, gate);
    world.step();
    expect(doorOf(world, gate).blockedBy).toBe(tall);
    expect(log.blocked.map((e) => e.by)).toEqual([first, tall]);
    expect(later).toBeGreaterThan(0);
  });

  /** A character as the controller places it: feet and capsule radius, centred on its capsule. */
  function character(world: World<never>, feet: { x: number; y: number; z: number }): EntityId {
    const capsule = { radius: 0.35, height: 1.8, crouchHeight: 1 };
    const entity = body(world, feet, capsule.radius);
    const { offset, radius } = characterCentre(capsule, false);
    setPlacementCentre(world, entity, offset, radius);
    return entity;
  }

  it('AC-1: a hinged door opens past a character pressed against the side it swings away from (mw-e01.19)', () => {
    const { world, log } = setup();
    // The slice's spawn door: yawed, swinging back, the player leaning on its front face.
    const gate = door(world, WOODEN_DOOR, { yaw: 90, swing: 'back' });
    const leaf = closedBox(doorOf(world, gate));
    const player = character(world, { x: leaf.max.x + 0.35 + 0.01, y: 0, z: 0 });
    openDoor(world, gate);
    steps(world, 61);
    expect(doorStatus(world, gate)).toBe('open');
    expect(log.blocked).toEqual([]);
    expect(log.states.map((e) => e.to)).toEqual(['opening', 'open']);
    expect(world.has(player, PlacementCentreComponent)).toBe(true);
  });

  it('AC-2: a hinged door still stops against a character standing in its swing (mw-e01.19)', () => {
    const { world, log } = setup();
    const gate = door(world);
    const player = character(world, { x: 0, y: 0, z: 0.6 });
    openDoor(world, gate);
    steps(world, 60);
    const stopped = doorOf(world, gate);
    expect(doorStatus(world, gate)).toBe('blocked');
    expect(stopped.blockedBy).toBe(player);
    expect(stopped.openness).toBeGreaterThan(0.2);
    expect(stopped.openness).toBeLessThan(0.35);
    // The event reports where the body is: the middle of its capsule.
    expect(log.blocked).toEqual([
      expect.objectContaining({ by: player, position: { x: 0, y: 0.9, z: 0.6 } }),
    ]);
    // Closing onto it from open stops too.
    const swing = door(world, WOODEN_DOOR, { origin: { x: 5, y: 0, z: 0 }, state: 'open' });
    const other = character(world, { x: 5, y: 0, z: 0.6 });
    closeDoor(world, swing);
    steps(world, 60);
    expect(doorOf(world, swing).blockedBy).toBe(other);
    expect(doorOf(world, swing).openness).toBeGreaterThan(0.6);
  });

  it('ignores level pieces, mechanisms and points in its way', () => {
    const world = registerSceneComponents(new World<never>({ seed: 1 }));
    installSignals(installStimuli(registerWorldProperties(world)));
    installMechanisms(world);
    const gate = door(world);
    const piece = body(world, { x: 0, y: 0.3, z: 0.6 });
    world.add(piece, ScenePieceComponent, {
      piece: 'wall',
      placement: 0,
      purpose: 'blocking',
      min: ORIGIN,
      max: ORIGIN,
    });
    body(world, { x: 0, y: 0.3, z: 0.6 }, 0);
    const lever = body(world, { x: 0, y: 0.3, z: 0.6 });
    makeSwitch(world, lever, 'lever');
    door(world, WOODEN_DOOR, { origin: { x: 0, y: 0, z: 0.6 }, yaw: 90 });
    openDoor(world, gate);
    steps(world, 61);
    expect(doorStatus(world, gate)).toBe('open');
  });

  it('AC-3: a lever wired to a portcullis raises it at its speed, and pulling it again mid-way reverses it', () => {
    const { world, log } = setup();
    const gate = door(world, PORTCULLIS);
    const lever = body(world, { x: 1.5, y: 1, z: -0.5 }, 0);
    makeSwitch(world, lever, 'lever');
    const graph: SignalGraphDef = {
      id: 'gate',
      nodes: [
        { id: 'lever', kind: 'lever', entity: 'lever' },
        { id: 'gate', kind: 'receiver', receiver: 'door', entity: 'gate' },
      ],
      wires: [{ from: 'lever', to: 'gate' }],
    };
    const wired = addSignalGraph(world, graph, { bindings: { lever, gate } });
    world.step();
    expect(useSwitch(world, lever, 3)).toBe(true);
    world.step(); // the graph sees the lever and the door sets off this tick
    expect(log.used).toEqual([
      { tick: 1, entity: lever, kind: 'lever', position: 1, positions: 2, source: 3 },
    ]);
    expect(signalOutput(world, wired, 'lever')).toBe(true);
    const step = 1 / (2 * 60);
    expect(doorOf(world, gate).openness).toBeCloseTo(step);
    steps(world, 59);
    expect(doorOf(world, gate).openness).toBeCloseTo(60 * step);
    expect(log.states.at(0)).toMatchObject({ from: 'closed', to: 'opening', source: wired });
    useSwitch(world, lever);
    world.step();
    expect(doorOf(world, gate).openness).toBeCloseTo(59 * step);
    expect(doorStatus(world, gate)).toBe('closing');
    steps(world, 59);
    expect(doorStatus(world, gate)).toBe('closed');
  });

  it('a bell sensor wired to a door opens it (the archery range fixture): any signal source works', () => {
    const { world } = setup();
    const gate = door(world, PORTCULLIS);
    const bell = body(world, { x: 3, y: 2, z: 0 }, 0.2, { charge: 0 });
    addSignalGraph(
      world,
      {
        id: 'bell-door',
        nodes: [
          {
            id: 'rung',
            kind: 'sensor',
            entity: 'bell',
            filter: [{ test: 'property', property: 'charge', op: 'gt', value: 0 }],
          },
          { id: 'latch', kind: 'latch' },
          { id: 'door', kind: 'receiver', receiver: 'mechanism', entity: 'door' },
        ],
        wires: [
          { from: 'rung', to: 'latch.set' },
          { from: 'latch', to: 'door' },
        ],
      },
      { bindings: { bell, door: gate } },
    );
    world.step();
    assignProperty(world, bell, 'charge', 5);
    steps(world, 3);
    expect(doorOf(world, gate).target).toBe(1);
  });

  it('jammed and frozen doors do not move; broken ones ignore orders', () => {
    const { world, log } = setup();
    const gate = door(world, WOODEN_DOOR, { state: 'jammed' });
    expect(doorStatus(world, gate)).toBe('jammed');
    expect(openDoor(world, gate, 4)).toBe(false);
    world.step();
    expect(log.jammed).toEqual([{ tick: 0, entity: gate, frozen: false, source: 4 }]);
    expect(jamDoor(world, gate, true)).toBe(false);
    expect(jamDoor(world, gate, false)).toBe(true);
    expect(jamDoor(world, world.spawn(), true)).toBe(false);
    const icy = door(world, WOODEN_DOOR, {}, { frozen: true });
    expect(openDoor(world, icy)).toBe(false);
    world.step();
    expect(log.jammed.at(-1)?.frozen).toBe(true);
    // Frozen mid-swing, it waits for the thaw.
    expect(openDoor(world, gate)).toBe(true);
    steps(world, 10);
    assignProperty(world, gate, 'frozen', true);
    world.step();
    const held = doorOf(world, gate).openness;
    steps(world, 10);
    expect(doorOf(world, gate).openness).toBe(held);
    assignProperty(world, gate, 'frozen', false);
    steps(world, 60);
    expect(doorStatus(world, gate)).toBe('open');
  });

  it('starts open when the scene says so, and toggles with Use', () => {
    const { world } = setup();
    const gate = door(world, WOODEN_DOOR, { state: 'open' });
    expect(doorStatus(world, gate)).toBe('open');
    const actor = world.spawn();
    interact(world, actor, gate, 'use');
    expect(doorOf(world, gate).target).toBe(0);
    interact(world, actor, gate, 'use');
    expect(doorOf(world, gate).target).toBe(1);
    interact(world, actor, gate, 'close');
    expect(doorOf(world, gate).target).toBe(0);
    interact(world, actor, gate, 'open');
    expect(doorOf(world, gate).target).toBe(1);
    // Interacting with something that is no mechanism does nothing.
    interact(world, actor, world.spawn(), 'open');
  });
});

describe('door prompts', () => {
  it('offers what the door can do now', () => {
    const base = { ...WOODEN_DOOR, profile: 'd' } as unknown as Door;
    const shut = { ...base, target: 0, broken: false } as Door;
    expect(doorAffordances(shut, undefined)).toEqual([{ verb: 'open', label: 'Open door' }]);
    expect(doorAffordances({ ...shut, target: 1 }, undefined)).toEqual([
      { verb: 'close', label: 'Close door' },
    ]);
    expect(doorAffordances({ ...shut, broken: true }, undefined)).toEqual([]);
    expect(doorAffordances({ ...shut, manual: false }, undefined)).toEqual([]);
    const lock = { ...TOWER_LOCK, lock: 'tower-door', locked: true };
    expect(doorAffordances(shut, lock)).toEqual([
      { verb: 'unlock', label: 'Unlock' },
      { verb: 'pick-lock', requires: [{ capability: LOCKPICK_CAPABILITY }] },
    ]);
    expect(doorAffordances(shut, { ...lock, pickTier: null })).toEqual([
      { verb: 'unlock', label: 'Unlock' },
    ]);
    expect(doorAffordances(shut, { ...lock, locked: false })).toEqual([
      { verb: 'open', label: 'Open door' },
    ]);
  });

  it('keeps the door’s interactable in step: added, relabelled, then removed when broken', () => {
    const { world } = setup();
    const gate = door(world);
    expect(must(world.get(gate, InteractableComponent)).affordances[0]?.label).toBe('Open door');
    openDoor(world, gate);
    expect(must(world.get(gate, InteractableComponent)).affordances[0]?.label).toBe('Close door');
    const signal = door(world, PORTCULLIS);
    expect(world.has(signal, InteractableComponent)).toBe(false);
    world.events.emit(fireBurntOut, { entity: gate, becomes: 'charred' });
    world.step();
    expect(world.has(gate, InteractableComponent)).toBe(false);
    refreshAffordances(world, world.spawn()); // not a door: nothing
  });

  it('leaves prompts alone when interaction is not installed', () => {
    const { world } = setup({}, false);
    const gate = door(world);
    expect(openDoor(world, gate)).toBe(true);
    expect(world.isRegistered(InteractableComponent)).toBe(false);
  });
});

/** Materials for the fire tests: wood that burns in a second and its charred remains. */
const MATERIALS: MaterialPresets = new Map([
  ['wood', { flammable: true, ignitionPoint: 300, fuel: 1, hp: 100 }],
  ['charred', { flammable: false, fuel: 0 }],
]);

function fiery() {
  const light = new LightField();
  const world = installElementField(
    installSignals(installStimuli(registerWorldProperties(new World<never>({ seed: 3 })))),
    { maxChunks: 16 },
  );
  world.register(...INTERACTION_COMPONENTS);
  const rules = new ElementRuleSet(
    fireRules({ presets: MATERIALS, burnt: new Map([['wood', 'charred']]) }),
  );
  world
    .addSystem(stimulusSystem())
    .addSystem(elementRulesSystem(rules))
    .addSystem(elementFieldSystem());
  const colliders = new InMemoryColliderSink();
  installMechanisms(world, { colliders, occluders: light.statics });
  const burnt: FireBurnout[] = [];
  world.events.on(fireBurntOut, (e) => burnt.push(e));
  return { world, light, colliders, burnt, log: listen(world) };
}

const conductivityAt = (world: World<never>, at: { x: number; y: number; z: number }) => {
  const field = elementFieldOf(world);
  return field.conductivity(field.cellOf(at));
};

describe('doors and fire', () => {
  it('AC-4: a wooden door that burns out is broken open and no longer blocks light, gas or sound', () => {
    const { world, light, colliders, burnt, log } = fiery();
    const gate = door(
      world,
      WOODEN_DOOR,
      { origin: { x: 1, y: 0, z: 1 } },
      { material: 'wood', flammable: true, fuel: 1 },
    );
    world.step();
    const inDoorway = { x: 1, y: 1.1, z: 1 };
    expect(light.statics.count()).toBe(1);
    expect(colliders.count()).toBe(1);
    expect(conductivityAt(world, inDoorway)).toBe(0);
    expect(doorShutsOut(world, gate)).toEqual({ light: true, gas: true, sound: true });

    assignProperty(world, gate, 'temperature', 900);
    assignProperty(world, gate, 'burning', true);
    for (let i = 0; i < 120 && burnt.length === 0; i++) world.step();
    expect(burnt).toEqual([{ entity: gate, becomes: 'charred' }]);
    expect(doorStatus(world, gate)).toBe('broken');
    expect(doorOf(world, gate).openness).toBe(1);
    expect(doorShutsOut(world, gate)).toEqual({ light: false, gas: false, sound: false });
    expect(light.statics.count()).toBe(0);
    expect(colliders.count()).toBe(0);
    expect(conductivityAt(world, inDoorway)).toBe(1);
    expect(log.states.at(-1)).toMatchObject({ from: 'closed', to: 'broken' });
    // A broken door ignores everything after.
    expect(openDoor(world, gate)).toBe(false);
    world.events.emit(fireBurntOut, { entity: gate, becomes: null });
    world.step();
    expect(log.states.filter((e) => e.to === 'broken')).toHaveLength(1);
  });

  it('opening a closed door unseals its doorway and takes away its light occluder', () => {
    const { world, light } = fiery();
    const gate = door(world, WOODEN_DOOR, { origin: { x: 1, y: 0, z: 1 } });
    world.step();
    openDoor(world, gate);
    world.step();
    expect(light.statics.count()).toBe(0);
    expect(conductivityAt(world, { x: 1, y: 1.1, z: 1 })).toBe(1);
    expect(doorShutsOut(world, world.spawn())).toEqual({ light: false, gas: false, sound: false });
  });

  it('a door that goes takes its collider, occluder and seal with it', () => {
    const { world, light, colliders } = fiery();
    const gate = door(world, WOODEN_DOOR, { origin: { x: 1, y: 0, z: 1 } });
    world.step();
    world.destroy(gate);
    expect(light.statics.count()).toBe(0);
    expect(colliders.count()).toBe(0);
    expect(conductivityAt(world, { x: 1, y: 1.1, z: 1 })).toBe(1);
    // One that never sealed or collided goes quietly.
    const { world: bare } = setup({}, false);
    const loose = door(bare, PORTCULLIS);
    bare.destroy(loose);
  });
});

describe('crushing (mw-e03.18)', () => {
  function crushing() {
    const s = setup();
    installBreakables(s.world);
    const gate = door(s.world, PORTCULLIS, { state: 'open' });
    return { ...s, gate };
  }

  it('AC-5: a portcullis closing onto something that holds against its crush stops above it, wedged', () => {
    const { world, gate, log } = crushing();
    const crate = body(world, { x: 0, y: 0.3, z: 0 }, 0.3, { fragile: 1000, hp: 10_000 });
    makeBreakable(world, crate, {
      id: 'crate',
      resistances: {},
      debris: { count: 0, size: 0.1 },
      breakLoudness: 60,
    });
    closeDoor(world, gate);
    steps(world, 200);
    const wedged = doorOf(world, gate);
    expect(doorStatus(world, gate)).toBe('blocked');
    expect(wedged.openness).toBeCloseTo(0.6 / 2.2);
    expect(world.isAlive(crate)).toBe(true);
    expect(log.blocked).toEqual([
      expect.objectContaining({ entity: gate, by: crate, crushed: true, kind: 'portcullis' }),
    ]);
  });

  it('AC-5 (edge): what its crush breaks is gone, and the portcullis closes', () => {
    const { world, gate } = crushing();
    const broke: EntityId[] = [];
    world.events.on(breakableBroken, (e) => broke.push(e.entity));
    const pot = body(world, { x: 0, y: 0.3, z: 0 }, 0.3, { fragile: 15, hp: 10 });
    makeBreakable(world, pot, {
      id: 'pot',
      resistances: {},
      debris: { count: 0, size: 0.1 },
      breakLoudness: 60,
    });
    closeDoor(world, gate);
    steps(world, 200);
    expect(broke).toEqual([pot]);
    expect(doorStatus(world, gate)).toBe('closed');
  });

  it('a door broken by a hit is broken: open for good', () => {
    const { world, log } = crushing();
    const gate = door(world, WOODEN_DOOR, {}, { fragile: 10 });
    makeBreakable(world, gate, {
      id: 'door',
      resistances: {},
      debris: { count: 0, size: 0.1 },
      breakLoudness: 80,
    });
    world.events.emit(breakableBroken, {
      tick: 0,
      entity: gate,
      profile: 'door',
      material: 'wood',
      cause: 'impact',
      by: 'blunt',
      source: 5,
      position: ORIGIN,
      cleared: { min: ORIGIN, max: ORIGIN },
      debris: [],
      spilled: [],
      reveals: null,
      loudness: 80,
    });
    world.step();
    expect(log.states.at(-1)).toMatchObject({ to: 'broken', source: 5 });
  });

  it('a hinged door without a crush just stops, and so does one without stimuli installed', () => {
    const world = installSignals(registerWorldProperties(new World<never>({ seed: 2 })));
    world.register(PlacementComponent, PlacementCentreComponent, ...INTERACTION_COMPONENTS);
    installMechanisms(world);
    const gate = door(world, PORTCULLIS, { state: 'open' });
    body(world, { x: 0, y: 0.3, z: 0 });
    closeDoor(world, gate);
    const blocked: DoorBlocked[] = [];
    world.events.on(doorBlocked, (e) => blocked.push(e));
    steps(world, 200);
    expect(blocked.map((e) => e.crushed)).toEqual([false]);
  });
});

describe('switches', () => {
  it('AC-6: a frozen lever does not move and reports jammed until it thaws', () => {
    const { world, log } = setup();
    const lever = body(world, { x: 0, y: 1, z: 0 }, 0, { frozen: true });
    makeSwitch(world, lever, 'lever');
    const actor = world.spawn();
    interact(world, actor, lever, 'pull');
    expect(must(world.get(lever, SwitchComponent)).position).toBe(0);
    expect(log.jammed).toEqual([{ tick: 0, entity: lever, frozen: true, source: actor }]);
    expect(log.used).toEqual([]);
    expect(setSwitch(world, lever, 1)).toBe(false);
    assignProperty(world, lever, 'frozen', false);
    interact(world, actor, lever, 'pull');
    expect(must(world.get(lever, SwitchComponent)).position).toBe(1);
    expect(log.used).toHaveLength(1);
    expect(log.jammed).toHaveLength(2);
  });

  it('buttons pulse, cranks step round, and a signal can set a lever', () => {
    const { world, log } = setup();
    const button = body(world, { x: 0, y: 1, z: 0 }, 0);
    makeSwitch(world, button, 'button');
    const crank = world.spawn(); // unplaced: it moves silently
    makeSwitch(world, crank, 'crank', { positions: 3 });
    const lever = body(world, { x: 1, y: 1, z: 0 }, 0);
    makeSwitch(world, lever, 'lever', { position: 1 });
    const graph = addSignalGraph(
      world,
      {
        id: 'panel',
        nodes: [
          { id: 'button', kind: 'button', entity: 'button' },
          { id: 'lever', kind: 'lever', entity: 'lever' },
          { id: 'crank', kind: 'lever', entity: 'crank' },
          { id: 'bell', kind: 'receiver', receiver: 'audio-cue', key: 'bell' },
          { id: 'reset', kind: 'receiver', receiver: 'mechanism', entity: 'lever' },
          { id: 'any', kind: 'or' },
        ],
        wires: [
          { from: 'button', to: 'any' },
          { from: 'crank', to: 'any' },
          { from: 'any', to: 'bell' },
          { from: 'crank', to: 'reset' },
        ],
      },
      { bindings: { button, lever, crank } },
    );
    syncSwitchNodes(world, lever);
    syncSwitchNodes(world, button);
    syncSwitchNodes(world, world.spawn());
    world.step();
    expect(signalOutput(world, graph, 'lever')).toBe(true);
    expect(useSwitch(world, button)).toBe(true);
    world.step();
    expect(signalOutput(world, graph, 'button')).toBe(true);
    world.step();
    expect(signalOutput(world, graph, 'button')).toBe(false);
    expect(log.used[0]).toMatchObject({ kind: 'button', position: 0, positions: 1 });
    expect(log.noises.map((e) => e.kind)).toEqual(['switch']);
    useSwitch(world, crank);
    useSwitch(world, crank);
    expect(must(world.get(crank, SwitchComponent)).position).toBe(2);
    world.step(); // crank on: the reset receiver sets the lever to 1 (already there)
    useSwitch(world, crank);
    expect(must(world.get(crank, SwitchComponent)).position).toBe(0);
    steps(world, 2); // crank off: the reset receiver sets the lever off
    expect(must(world.get(lever, SwitchComponent)).position).toBe(0);
    expect(setSwitch(world, button, 1)).toBe(false);
    expect(setSwitch(world, lever, 5)).toBe(true);
    expect(setSwitch(world, lever, 1)).toBe(false);
    expect(useSwitch(world, world.spawn())).toBe(false);
    expect(setSwitch(world, world.spawn(), 1)).toBe(false);
  });

  it('knows how many positions each kind has, and refuses impossible ones', () => {
    expect(switchPositions('button')).toBe(1);
    expect(switchPositions('lever', 5)).toBe(2);
    expect(switchPositions('wheel')).toBe(2);
    expect(switchPositions('wheel', 6)).toBe(6);
    const { world } = setup();
    expect(() => {
      makeSwitch(world, world.spawn(), 'crank', { positions: 1 });
    }).toThrow(RangeError);
    expect(() => {
      makeSwitch(world, world.spawn(), 'crank', { positions: 2.5 });
    }).toThrow(RangeError);
    expect(() => {
      makeSwitch(world, world.spawn(), 'lever', { position: 2 });
    }).toThrow(RangeError);
    expect(() => {
      makeSwitch(world, world.spawn(), 'lever', { position: -1 });
    }).toThrow(RangeError);
  });

  it('works without signals installed', () => {
    const world = installStimuli(registerWorldProperties(new World<never>({ seed: 1 })));
    installMechanisms(world);
    const lever = world.spawn();
    makeSwitch(world, lever, 'lever');
    expect(useSwitch(world, lever)).toBe(true);
  });
});

describe('door colliders on Rapier', () => {
  it('collides as its leaf, bound to the door, and stops blocking once open', () => {
    const physics = new RapierPhysics(RAPIER);
    const world = installSignals(
      installStimuli(
        registerWorldProperties(registerSceneComponents(new World<never>({ seed: 5, physics }))),
      ),
    );
    installPhysicsObjects(world);
    world.register(...INTERACTION_COMPONENTS);
    const off = installMechanisms(world, { colliders: physics });
    physics.add(box({ x: -5, y: -1, z: -5 }, { x: 5, y: 0, z: 5 }));
    const gate = door(world, WOODEN_DOOR, {}, { friction: 0.3 });
    steps(world, 2);
    const bound = must(world.get(gate, PhysicsColliderComponent)).colliders;
    expect(bound).toEqual([doorOf(world, gate).collider]);
    const sight = new RapierSightWorld(physics);
    const front = { x: 0, y: 1, z: -2 };
    const back = { x: 0, y: 1, z: 2 };
    expect(sight.firstCrossing(front, back)).toBe(bound[0]);
    expect(doorOf(world, gate).solid).toEqual(closedBox(doorOf(world, gate)));
    openDoor(world, gate);
    steps(world, 62);
    expect(sight.firstCrossing(front, back)).toBeUndefined();
    expect(physics.has(must(bound[0]) as ColliderHandle)).toBe(false);
    world.events.emit(fireBurntOut, { entity: gate, becomes: 'charred' });
    world.step();
    expect(world.get(gate, PhysicsColliderComponent)?.colliders).toEqual([]);
    world.destroy(gate);
    expect(physics.count()).toBe(1);
    off();
    expect(doorState(doorOf(world, door(world)))).toBe('closed');
  });
});

describe('slamming a door open (a kick, mw-e04.18)', () => {
  it('swings the door open several times faster than by hand, then it is an ordinary door again', () => {
    const { world, log } = setup();
    const gate = door(world);
    const slammer = world.spawn();
    expect(slamDoor(world, gate, slammer)).toBe(true);
    world.events.flush();
    expect(doorOf(world, gate).slam).toEqual({ speed: SLAM_SPEED, source: slammer });
    expect(log.states.map((e) => [e.from, e.to, e.source])).toEqual([
      ['closed', 'opening', slammer],
    ]);
    expect(log.noises).toHaveLength(1);
    steps(world, Math.ceil(60 / SLAM_SPEED) + 1);
    expect(doorState(doorOf(world, gate))).toBe('open');
    expect(doorOf(world, gate)).not.toHaveProperty('slam');
    // The same swing by hand takes the full second.
    const other = door(world);
    openDoor(world, other);
    steps(world, Math.ceil(60 / SLAM_SPEED) + 1);
    expect(doorState(doorOf(world, other))).toBe('opening');
  });

  it('AC-2 (mw-e03.25): a slammed door is at least 3 times the sound pressure of one shut by hand, and a slow close is quieter still', () => {
    const { world, log } = setup();
    const pressure = (db: number) => 10 ** (db / 20);
    const slammed = door(world);
    slamDoor(world, slammed);
    const eased = door(world);
    openDoor(world, eased);
    steps(world, 70);
    closeDoor(world, eased);
    const slow = door(world);
    openDoor(world, slow);
    steps(world, 70);
    moveDoor(world, slow, 0, null, { speed: 0.25, source: null });
    world.events.flush();
    const [slam, open, close, , slowClose] = log.noises.map((e) => e.loudness);
    expect(slam).toBeDefined();
    expect(pressure(must(slam)) / pressure(must(open))).toBeGreaterThanOrEqual(3);
    expect(must(close)).toBe(must(open));
    expect(must(slowClose)).toBeLessThan(must(close));
    expect(doorLoudness({ loudness: 50 })).toBe(50);
  });

  it('a slammed door that meets something stops against it and says who slammed it', () => {
    const { world, log } = setup();
    const gate = door(world);
    const slammer = world.spawn();
    body(world, { x: 0.2, y: 0.3, z: 0.5 });
    slamDoor(world, gate, slammer);
    steps(world, 30);
    expect(log.blocked).toHaveLength(1);
    expect(log.blocked[0]).toMatchObject({ entity: gate, crushed: false, slammedBy: slammer });
    expect(doorState(doorOf(world, gate))).toBe('blocked');
    expect(doorOf(world, gate)).not.toHaveProperty('slam');
    // Opened by hand against the same body, it carries no slammer.
    const { world: calm, log: quiet } = setup();
    const hand = door(calm);
    body(calm, { x: 0.2, y: 0.3, z: 0.5 });
    openDoor(calm, hand);
    steps(calm, 60);
    expect(quiet.blocked[0]).not.toHaveProperty('slammedBy');
  });

  it('a slam can be unsourced, and closing the door drops it', () => {
    const { world } = setup();
    const gate = door(world);
    expect(slamDoor(world, gate)).toBe(true);
    expect(doorOf(world, gate).slam?.source).toBeNull();
    steps(world, 3);
    expect(closeDoor(world, gate)).toBe(true);
    expect(doorOf(world, gate)).not.toHaveProperty('slam');
  });

  it('does nothing to a locked, jammed, broken or already open door, or to a thing that is no door', () => {
    const { world, log } = setup();
    const locked = door(world, WOODEN_DOOR, { lock: TOWER_LOCK });
    const stuck = door(world, WOODEN_DOOR, { state: 'jammed' });
    const open = door(world, WOODEN_DOOR, { state: 'open' });
    expect(slamDoor(world, locked)).toBe(false);
    world.events.flush();
    expect(log.refused.map((e) => e.reason)).toEqual(['locked']);
    expect(slamDoor(world, stuck)).toBe(false);
    world.events.flush();
    expect(log.jammed).toHaveLength(1);
    expect(slamDoor(world, open)).toBe(false);
    world.events.emit(fireBurntOut, { entity: locked, becomes: 'charred' });
    world.step();
    expect(slamDoor(world, locked)).toBe(false);
    expect(slamDoor(world, world.spawn())).toBe(false);
    for (const gate of [locked, stuck, open])
      expect(doorOf(world, gate)).not.toHaveProperty('slam');
  });
});
