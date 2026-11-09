// Bodies in containers and containers that break (mw-e03.23): stash by weight, the prompt, saves,
// spilling items and bodies on a break or a burn-out.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { CarryBulkyComponent, CarryLedgerComponent } from '../carry/state';
import { hypot as simHypot } from '../math';
import { installCarry } from '../carry/carry';
import { box } from '../character/greybox';
import { CharacterController } from '../character/system';
import { PlayerLook } from '../player/player';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { registerPersistence, WorldPersistence } from '../deltas/persistence';
import { fireBurntOut } from '../elements/fire';
import { breakableBroken, type BreakableBrokenInfo } from '../breakables/events';
import { actionButton, actionFrame, actionVector, type ActionFrame } from '../input/action-frame';
import {
  addInteractor,
  installInteraction,
  interacted,
  interactionPrompt,
  InteractionFocusComponent,
} from '../interaction/system';
import {
  addInventory,
  InventoryRules,
  inventoryOf,
  type InventoryItemDef,
} from '../inventory/inventory';
import {
  PhysicsObjectComponent,
  installPhysicsObjects,
  addPhysicsObject,
} from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { addProperties, readProperty, registerWorldProperties } from '../properties/components';
import { registerSceneComponents } from '../scene/loader';
import { placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli } from '../stimulus/stimulus';
import {
  Containers,
  installContainers,
  NO_BODY_REASON,
  TOO_HEAVY_REASON,
  addSceneContainers,
  ContainerComponent,
  type ItemSpawner,
} from './containers';
import {
  containerSpilled,
  containerStashed,
  containerStashRefused,
  StashComponent,
  stashedWeight,
  stashRoom,
  spawnStashedBody,
  type ContainerSpilled,
  type ContainerStashed,
  type ContainerStashRefused,
} from './stash';
import { LootTables } from './tables';
import { LockComponent } from '../mechanisms/components';

/** A value the test knows is there. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing');
  return value;
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const IDLE: ActionFrame = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: () => actionButton(false, false, false),
});

const def = (id: string, category: InventoryItemDef['category'], stackable = false) =>
  ({
    id,
    category,
    stackable,
    flags: { unique: false, questItem: false },
  }) satisfies InventoryItemDef;
const ITEMS = [
  def('bread', 'consumable', true),
  def('gold', 'currency', true),
  def('ring', 'artifact'),
];

interface Spawn {
  readonly defId: string;
  readonly count?: number;
  readonly position: Vec3;
}

function setup(options: { stash?: number | null; spawner?: boolean } = {}) {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(
    registerWorldProperties(registerSceneComponents(new World<ActionFrame>({ seed: 5, physics }))),
  );
  world.register(CharacterController, PlayerLook);
  const sim = world as unknown as World<never>;
  installPhysicsObjects(sim);
  physics.add(box(v(-20, -1, -20), v(20, 0, 20)));
  installInteraction(world);
  registerPersistence(world);
  const rules = new InventoryRules(ITEMS);
  const spawns: Spawn[] = [];
  const spawner: ItemSpawner = {
    spawn: (_w, spec) => {
      spawns.push({
        defId: spec.defId,
        ...(spec.count !== undefined && { count: spec.count }),
        position: spec.position,
      });
      return world.spawn();
    },
  };
  const containers = new Containers(rules, new LootTables([], ITEMS), {
    ...(options.spawner !== false && { items: spawner }),
  });
  installContainers(world, containers);
  const player = world.spawn();
  addInventory(world, player);
  addInteractor(sim, player);
  const chest = world.spawn();
  containers.make(sim, chest, {
    level: 'cellar',
    id: 'chest',
    position: v(0, 0, 0),
    ...(options.stash !== null && { stashKg: options.stash ?? 60 }),
  });
  world.step([IDLE]);
  return { world, sim, containers, rules, player, chest, spawns };
}

type Setup = ReturnType<typeof setup>;

/** A body of `kg` weighing a bulky box on the floor. */
function body(s: Setup, kg: number, bulky = true): EntityId {
  const entity = s.world.spawn();
  addProperties(s.sim, entity, { liftable: true, weight: kg });
  if (bulky) s.world.add(entity, CarryBulkyComponent, { kind: 'body' });
  addPhysicsObject(s.sim, entity, {
    shape: { kind: 'box', halfExtents: v(0.3, 0.2, 0.6) },
    position: v(2, 0.2, 2),
  });
  s.world.step([IDLE]);
  return entity;
}

/** Puts `target` in `actor`'s hands, as the carry ledger records it. */
function hold(s: Setup, target: EntityId): void {
  if (!s.world.isRegistered(CarryLedgerComponent)) s.world.register(CarryLedgerComponent);
  const ledger = s.world.spawn();
  s.world.add(ledger, CarryLedgerComponent, {
    holds: [
      {
        actor: s.player,
        target,
        mode: 'shoulder',
        since: 0,
        speedScale: 0.5,
        noJump: true,
        charge: -1,
        burning: 0,
      },
    ],
  });
  s.world.step([IDLE]);
}

const stashOf = (s: Setup) => s.world.get(s.chest, StashComponent);

function heard(s: Setup) {
  const stashed: ContainerStashed[] = [];
  const refused: ContainerStashRefused[] = [];
  const spilled: ContainerSpilled[] = [];
  s.world.events.on(containerStashed, (e) => stashed.push(e));
  s.world.events.on(containerStashRefused, (e) => refused.push(e));
  s.world.events.on(containerSpilled, (e) => spilled.push(e));
  // Events emitted outside a step are delivered when the next one starts (or on a flush).
  const flushed =
    <T>(list: T[]) =>
    (): T[] => {
      s.world.events.flush();
      return list;
    };
  return { stashed: flushed(stashed), refused: flushed(refused), spilled: flushed(spilled) };
}

const brokenInfo = (entity: EntityId): BreakableBrokenInfo => ({
  tick: 0,
  entity,
  profile: 'chest',
  material: 'wood',
  cause: 'impact',
  by: 'collision',
  source: null,
  position: v(0, 0, 0),
  cleared: { min: v(0, 0, 0), max: v(1, 1, 1) },
  debris: [],
  spilled: [],
  reveals: null,
  loudness: 70,
});

describe('bodies in containers (mw-e03.23)', () => {
  it('a body that fits is stashed: destroyed, recorded by kind and weight, and the room shrinks', () => {
    const s = setup();
    const h = heard(s);
    const corpse = body(s, 45);
    expect(s.containers.stash(s.sim, s.chest, s.player, corpse)).toEqual({ ok: true });
    s.world.step([IDLE]);
    expect(s.world.isAlive(corpse)).toBe(false);
    expect(stashOf(s)).toEqual({ capacityKg: 60, bodies: [{ kind: 'body', weight: 45 }] });
    expect(stashedWeight(stashOf(s) as never)).toBe(45);
    expect(stashRoom(stashOf(s) as never)).toBe(15);
    expect(h.stashed()).toMatchObject([{ entity: s.chest, actor: s.player, body: { weight: 45 } }]);
  });

  it('AC-5: a container with 60 kg of room refuses a 70 kg body', () => {
    const s = setup();
    const h = heard(s);
    const heavy = body(s, 70);
    expect(s.containers.stash(s.sim, s.chest, s.player, heavy)).toEqual({
      ok: false,
      reason: 'too-heavy',
    });
    s.world.step([IDLE]);
    expect(s.world.isAlive(heavy)).toBe(true);
    expect(stashOf(s)?.bodies).toEqual([]);
    expect(h.refused()).toMatchObject([{ entity: s.chest, reason: 'too-heavy' }]);
  });

  it('AC-5: bodies add up: a second 45 kg body does not fit after a first', () => {
    const s = setup();
    const a = body(s, 45);
    const b = body(s, 45);
    expect(s.containers.stash(s.sim, s.chest, s.player, a).ok).toBe(true);
    s.world.step([IDLE]);
    expect(s.containers.stash(s.sim, s.chest, s.player, b)).toEqual({
      ok: false,
      reason: 'too-heavy',
    });
    // A body exactly the room left fits.
    const rest = body(s, 15);
    expect(s.containers.stash(s.sim, s.chest, s.player, rest).ok).toBe(true);
  });

  it('refuses a locked container, a container without room, and a thing that is not a body', () => {
    const s = setup();
    const crate = body(s, 10, false);
    expect(s.containers.stashRefusal(s.sim, s.chest, crate)).toBe('not-a-body');
    s.world.register(LockComponent);
    s.world.add(s.chest, LockComponent, {
      lock: 'iron',
      tier: 1,
      pickTier: 1,
      sealed: false,
      tags: [],
      hint: '',
      locked: true,
    });
    s.world.step([IDLE]);
    const corpse = body(s, 10);
    expect(s.containers.stashRefusal(s.sim, s.chest, corpse)).toBe('locked');
    const bare = setup({ stash: null });
    const other = body(bare, 10);
    expect(bare.containers.stashRefusal(bare.sim, bare.chest, other)).toBe('no-stash');
    expect(bare.containers.stash(bare.sim, bare.chest, bare.player, other)).toEqual({
      ok: false,
      reason: 'no-stash',
    });
  });

  it('stashing in something that is not a container is a RangeError', () => {
    const s = setup();
    expect(() => s.containers.stash(s.sim, s.world.spawn(), s.player, body(s, 1))).toThrow(
      RangeError,
    );
  });

  it('Stash is offered ahead of Search, greyed unless a body that fits is in the hands', () => {
    const s = setup();
    s.rules.add(s.sim, s.chest, 'bread', 1); // so Search is not greyed "Empty"
    const prompt = () => {
      s.world.set(s.player, InteractionFocusComponent, { target: s.chest, score: 1, hold: null });
      return interactionPrompt(s.sim, s.player);
    };
    expect(prompt()).toMatchObject({ verb: 'search', available: true });
    expect(prompt()?.options.map((o) => o.verb)).toEqual(['stash', 'search']);
    expect(prompt()?.options[0]).toMatchObject({ available: false, reason: NO_BODY_REASON });
    const crate = body(s, 10, false);
    hold(s, crate);
    expect(prompt()?.options[0]).toMatchObject({ available: false, reason: NO_BODY_REASON });
    const s2 = setup();
    const heavy = body(s2, 70);
    hold(s2, heavy);
    s2.world.set(s2.player, InteractionFocusComponent, {
      target: s2.chest,
      score: 1,
      hold: null,
    });
    expect(interactionPrompt(s2.sim, s2.player)?.options[0]).toMatchObject({
      available: false,
      reason: TOO_HEAVY_REASON,
    });
    const s3 = setup();
    const light = body(s3, 30);
    hold(s3, light);
    s3.world.set(s3.player, InteractionFocusComponent, {
      target: s3.chest,
      score: 1,
      hold: null,
    });
    expect(interactionPrompt(s3.sim, s3.player)).toMatchObject({
      verb: 'stash',
      label: 'Stash body',
      available: true,
    });
  });

  it('Interact with a body in the hands stashes it; a locked chest offers Unlock instead', () => {
    const s = setup();
    const corpse = body(s, 30);
    hold(s, corpse);
    s.world.events.emit(interacted, {
      actor: s.player,
      target: s.chest,
      verb: 'stash',
      affordance: 0,
    });
    s.world.step([IDLE]);
    s.world.step([IDLE]);
    expect(stashOf(s)?.bodies).toEqual([{ kind: 'body', weight: 30 }]);
    // Stash with nothing bulky in the hands does nothing; so does Stash on a non-container.
    const empty = setup();
    empty.world.events.emit(interacted, {
      actor: empty.player,
      target: empty.chest,
      verb: 'stash',
      affordance: 0,
    });
    empty.world.events.emit(interacted, {
      actor: empty.player,
      target: empty.world.spawn(),
      verb: 'stash',
      affordance: 0,
    });
    empty.world.step([IDLE]);
    expect(stashOf(empty)?.bodies).toEqual([]);
  });

  it('AC-6: what is stashed is saved with the level and is still inside after a reload', () => {
    const s = setup();
    const baseline = new WorldPersistence().baseline(s.sim, 'cellar', [['spawn:chest', s.chest]]);
    s.rules.add(s.sim, s.chest, 'ring', 1);
    s.containers.stash(s.sim, s.chest, s.player, body(s, 45));
    s.world.step([IDLE]);
    const persistence = new WorldPersistence();
    const deltas = persistence.capture(s.sim, baseline);
    expect(Object.keys(deltas.entities[0]?.aspects ?? {}).sort()).toEqual(['container', 'stash']);
    const back = setup();
    const fresh = new WorldPersistence().baseline(back.sim, 'cellar', [
      ['spawn:chest', back.chest],
    ]);
    const report = new WorldPersistence().apply(back.sim, fresh, deltas);
    expect(report.skipped).toEqual([]);
    expect(stashOf(back)).toEqual({ capacityKg: 60, bodies: [{ kind: 'body', weight: 45 }] });
    expect(inventoryOf(back.sim, back.chest)?.items.map((i) => i.defId)).toEqual(['ring']);
  });
});

describe('carrying and containers register the bulky marker once, in either order (mw-e03.23)', () => {
  it('containers first, then carrying', () => {
    const s = setup();
    expect(s.world.isRegistered(CarryBulkyComponent)).toBe(true);
    installCarry(s.world, {});
    expect(s.world.isRegistered(CarryLedgerComponent)).toBe(true);
  });

  it('carrying first, then containers', () => {
    const world = installStimuli(
      registerWorldProperties(
        registerSceneComponents(new World({ seed: 1, physics: new RapierPhysics(RAPIER) })),
      ),
    );
    world.register(CharacterController, PlayerLook);
    installPhysicsObjects(world as unknown as World<never>);
    installInteraction(world);
    installCarry(world, {});
    const rules = new InventoryRules(ITEMS);
    installContainers(world, new Containers(rules, new LootTables([], ITEMS)));
    expect(world.isRegistered(CarryBulkyComponent)).toBe(true);
  });
});

describe('a container that breaks (mw-e03.23)', () => {
  it('AC-3: all its items spawn as world pickups around it the tick it breaks', () => {
    const s = setup();
    const h = heard(s);
    s.rules.add(s.sim, s.chest, 'bread', 1);
    s.rules.add(s.sim, s.chest, 'ring', 1);
    s.rules.addGold(s.sim, s.chest, 25);
    s.world.events.emit(breakableBroken, brokenInfo(s.chest));
    s.world.step([IDLE]);
    expect(s.spawns.map((p) => [p.defId, p.count])).toEqual([
      ['bread', 1],
      ['ring', 1],
      ['gold', 25],
    ]);
    // On a ring around it, above it, each its own place.
    const at = placementOf(s.sim, s.chest) as Vec3;
    const places = new Set(
      s.spawns.map((p) => `${p.position.x.toFixed(3)},${p.position.z.toFixed(3)}`),
    );
    expect(places.size).toBe(3);
    for (const { position } of s.spawns) {
      expect(simHypot(position.x - at.x, position.z - at.z)).toBeCloseTo(0.5, 9);
      expect(position.y).toBeCloseTo(at.y + 0.3, 9);
    }
    expect(inventoryOf(s.sim, s.chest)).toMatchObject({ items: [], gold: 0 });
    expect(h.spilled()).toMatchObject([{ entity: s.chest, bodies: 0 }]);
    expect(h.spilled()[0]?.spawned).toHaveLength(3);
  });

  it('its stashed bodies come back as bodies on the floor, carried the same way', () => {
    const s = setup();
    const h = heard(s);
    s.rules.add(s.sim, s.chest, 'ring', 1);
    s.containers.stash(s.sim, s.chest, s.player, body(s, 45));
    s.world.step([IDLE]);
    s.world.events.emit(breakableBroken, brokenInfo(s.chest));
    s.world.step([IDLE]);
    const [ring, spilledBody] = h.spilled()[0]?.spawned ?? [];
    expect(s.spawns.map((p) => p.defId)).toEqual(['ring']);
    expect(ring).toBeDefined();
    expect(spilledBody).toBeDefined();
    s.world.step([IDLE]);
    const entity = must(spilledBody);
    expect(s.world.get(entity, CarryBulkyComponent)).toEqual({ kind: 'body' });
    expect(readProperty(s.sim, entity, 'weight')).toBe(45);
    expect(readProperty(s.sim, entity, 'liftable')).toBe(true);
    expect(s.world.has(entity, PhysicsObjectComponent)).toBe(true);
    expect(stashOf(s)?.bodies).toEqual([]);
  });

  it('a body spills even where no item spawner is installed (the items are lost with it)', () => {
    const s = setup({ spawner: false });
    s.rules.add(s.sim, s.chest, 'ring', 1);
    s.containers.stash(s.sim, s.chest, s.player, body(s, 45));
    s.world.step([IDLE]);
    const h = heard(s);
    s.world.events.emit(breakableBroken, brokenInfo(s.chest));
    s.world.step([IDLE]);
    expect(h.spilled()).toMatchObject([{ bodies: 1 }]);
    expect(h.spilled()[0]?.spawned).toHaveLength(1);
  });

  it('a container that burns away spills; one that only changes to ash, or a thing that is no container, does not', () => {
    const s = setup();
    const h = heard(s);
    s.rules.add(s.sim, s.chest, 'bread', 1);
    s.world.events.emit(fireBurntOut, { entity: s.chest, becomes: 'ash' });
    s.world.events.emit(fireBurntOut, { entity: s.world.spawn(), becomes: null });
    s.world.step([IDLE]);
    expect(h.spilled()).toEqual([]);
    s.world.events.emit(fireBurntOut, { entity: s.chest, becomes: null });
    s.world.step([IDLE]);
    expect(h.spilled()).toHaveLength(1);
    expect(s.spawns).toHaveLength(1);
  });

  it('an empty container, or one with nowhere to be, spills nothing; a thing that breaks and is no container is none of our business', () => {
    const s = setup();
    const h = heard(s);
    s.world.events.emit(breakableBroken, brokenInfo(s.chest));
    s.world.events.emit(breakableBroken, brokenInfo(s.world.spawn()));
    s.world.step([IDLE]);
    expect(h.spilled()).toEqual([]);
    // Spilling a container with no placement or no pack does nothing either.
    const lone = s.world.spawn();
    s.world.add(lone, ContainerComponent, { loot: null, level: 'x', id: 'lone' });
    s.world.step([IDLE]);
    s.containers.spill(s.sim, lone);
    expect(h.spilled()).toEqual([]);
  });

  it('a container with no room for bodies spills just its items', () => {
    const s = setup({ stash: null });
    s.rules.add(s.sim, s.chest, 'ring', 1);
    s.containers.spill(s.sim, s.chest);
    expect(s.spawns.map((p) => p.defId)).toEqual(['ring']);
  });

  it('spilling twice in a tick spills once', () => {
    const s = setup();
    s.rules.add(s.sim, s.chest, 'ring', 1);
    s.containers.spill(s.sim, s.chest);
    s.containers.spill(s.sim, s.chest);
    expect(s.spawns).toHaveLength(1);
  });

  it('spawnStashedBody makes a bulky, liftable body of that weight', () => {
    const s = setup();
    const entity = spawnStashedBody(s.sim, { kind: 'sack', weight: 20 }, v(1, 0.5, 1));
    s.world.step([IDLE]);
    expect(s.world.get(entity, CarryBulkyComponent)).toEqual({ kind: 'sack' });
    expect(readProperty(s.sim, entity, 'weight')).toBe(20);
  });

  it('scene containers carry their room for bodies', () => {
    const s = setup({ stash: null });
    const made = addSceneContainers(
      s.sim,
      s.containers,
      'cellar',
      [
        {
          entity: s.world.spawn(),
          spawn: { id: 'a', position: v(1, 0, 1), container: { contents: [], stashKg: 80 } },
        },
        { entity: s.world.spawn(), spawn: { id: 'b', position: v(2, 0, 2) } },
      ],
      () => undefined,
    );
    s.world.step([IDLE]);
    expect(made).toHaveLength(1);
    expect(s.world.get(must(made[0]), StashComponent)?.capacityKg).toBe(80);
  });
});
