// Lootable containers (mw-e18.3): roll once on the first open (and never again, across a save and
// reload), take all or one stack into the inventory, put items in, refuse while locked, and persist
// what is inside through level deltas and world facts. Interact is driven through the real
// interaction system, and locks through the mechanisms' keyring, as the game wires them.
import { describe, expect, it } from 'vitest';
import { initialCharacterState } from '../character/controller';
import { CharacterController } from '../character/system';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { registerPersistence, WorldPersistence } from '../deltas/persistence';
import type { LevelDeltas } from '../deltas/persistence';
import type { FactSnapshot } from '../facts/store';
import { actionButton, actionFrame, actionVector, type ActionFrame } from '../input/action-frame';
import {
  addInteractor,
  InteractableComponent,
  installInteraction,
  interacted,
  interactionPrompt,
} from '../interaction/system';
import {
  addInventory,
  InventoryComponent,
  inventoryOf,
  InventoryRules,
  type InventoryItemDef,
} from '../inventory/inventory';
import { LockComponent, type DoorProfile, type LockSpec } from '../mechanisms/components';
import { lockRefused, type LockRefused } from '../mechanisms/events';
import { keyring } from '../mechanisms/keys';
import {
  installMechanisms,
  LOCKPICK_CAPABILITY,
  makeDoor,
  refreshAffordances,
} from '../mechanisms/system';
import {
  ownerOf,
  theftRecorded,
  theftReturned,
  thefts,
  type TheftRecorded,
  type TheftReturned,
} from '../ownership/ownership';
import { PlayerLook } from '../player/player';
import { registerWorldProperties } from '../properties/components';
import { PlacementComponent } from '../stimulus/placement';
import { installStimuli } from '../stimulus/stimulus';
import {
  addSceneContainers,
  ContainerComponent,
  containerEmpty,
  containerFact,
  containerLooted,
  CONTAINER_ACTION_COMMAND,
  containerActionCommand,
  containerActionDone,
  containerActionsSystem,
  containerOpened,
  containerSearched,
  containerTaken,
  Containers,
  isContainerActionCommand,
  EMPTY_REASON,
  installContainers,
  refreshContainerAffordances,
  type ContainerAction,
  type ContainerActionDone,
  type ContainerLooted,
  type ContainerSearched,
  type ContainerTaken,
  type ContainerOpened,
  type ContainerSpec,
} from './containers';
import { LootTables, type LootTableDef } from './tables';

const UP = actionButton(false, false, false);
function frame(interact: boolean): ActionFrame {
  const zero = actionVector(0, 0);
  return actionFrame({
    move: zero,
    look: zero,
    buttons: (action) => (action === 'interact' && interact ? actionButton(true, true, false) : UP),
  });
}
const IDLE = frame(false);
const PRESS = frame(true);

const def = (
  id: string,
  category: InventoryItemDef['category'],
  extra: Partial<InventoryItemDef> = {},
): InventoryItemDef => ({
  id,
  category,
  stackable: false,
  flags: { unique: false, questItem: false },
  ...extra,
});
const ITEMS: InventoryItemDef[] = [
  def('bread', 'consumable', { stackable: true, maxStack: 5 }),
  def('arrow', 'ammo', { stackable: true, maxStack: 50 }),
  def('gold', 'currency', { stackable: true }),
  def('crown', 'artifact', { flags: { unique: true, questItem: false } }),
  def('letter', 'quest', { flags: { unique: false, questItem: true } }),
  def('lockpicks', 'tool'),
  def('chest-key', 'key', { key: { opens: ['iron-chest'] } }),
];

const ref = (id: string) => ({ id });
const TABLES: LootTableDef[] = [
  {
    // Random enough that a second roll would almost surely differ.
    id: 'supplies',
    guaranteed: [{ item: ref('bread'), count: 2 }],
    rolls: { min: 1, max: 3 },
    entries: [
      { item: ref('arrow'), weight: 3, count: { min: 1, max: 40 } },
      { item: ref('gold'), weight: 2, count: { min: 1, max: 99 } },
      { item: ref('bread'), weight: 1, count: { min: 1, max: 9 } },
    ],
    noDuplicates: false,
  },
  {
    id: 'regalia',
    guaranteed: [{ item: ref('crown'), count: 1 }],
    rolls: { min: 0, max: 0 },
    entries: [],
    noDuplicates: false,
  },
  {
    id: 'thief-stash',
    guaranteed: [],
    rolls: { min: 1, max: 1 },
    entries: [
      {
        item: ref('lockpicks'),
        weight: 1,
        count: { min: 1, max: 1 },
        conditions: { class: [ref('thief')] },
      },
    ],
    noDuplicates: false,
  },
];

const IRON_CHEST: LockSpec = {
  id: 'iron-chest',
  tier: 1,
  pickTier: 1,
  sealed: false,
  tags: [],
  hint: 'Locked. The key must be about.',
};

const DOOR: DoorProfile = {
  id: 'wooden-door',
  kind: 'hinged',
  size: { x: 1.2, y: 2.2, z: 0.06 },
  seconds: 1,
  crush: 0,
  manual: true,
  blocks: { light: true, gas: true, sound: true },
  loudness: 50,
};

const LEVEL = 'cellar';

interface SetupOptions {
  /** Overrides of the chest; `loot: null` gives it no table (default: supplies). */
  readonly chest?: Omit<Partial<ContainerSpec>, 'loot'> & { readonly loot?: string | null };
  readonly carry?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly classId?: string;
  readonly unitGuard?: number;
}

/**
 * A player at (0, 0, 1.5) facing −z towards a chest at the origin, with interaction, mechanisms
 * (and the keyring) and containers installed as the game does, and the chest's level baseline taken.
 */
function setup(options: SetupOptions = {}) {
  const world = installStimuli(registerWorldProperties(new World<ActionFrame>({ seed: 11 })));
  world.register(CharacterController, PlayerLook);
  installInteraction(world);
  registerPersistence(world);
  const rules = new InventoryRules(ITEMS, { unitGuard: options.unitGuard ?? 9999 });
  installMechanisms(world, { keys: keyring(rules) });
  const containers = new Containers(rules, new LootTables(TABLES, ITEMS), {
    classOf: () => options.classId,
  });
  const off = installContainers(world, containers);
  const sim = world as unknown as World<never>;
  const player = world.spawn();
  world.add(player, CharacterController, initialCharacterState({ x: 0, y: 0, z: 1.5 }));
  world.add(player, PlayerLook, { yaw: 0, pitch: 0 });
  addInteractor(world, player, { capabilities: options.capabilities ?? [] });
  addInventory(world, player);
  const chest = world.spawn();
  const { loot = 'supplies', ...chestSpec } = options.chest ?? {};
  containers.make(sim, chest, {
    level: LEVEL,
    id: 'chest',
    position: { x: 0, y: 0, z: 0 },
    ...chestSpec,
    ...(loot !== null && { loot }),
  });
  for (const item of options.carry ?? []) rules.add(sim, player, item, 1);
  const persistence = new WorldPersistence();
  const baseline = persistence.baseline(sim, LEVEL, [['spawn:chest', chest]]);
  world.step([IDLE]); // focus on the chest
  const opened: ContainerOpened[] = [];
  const looted: ContainerLooted[] = [];
  const refused: LockRefused[] = [];
  const searched: ContainerSearched[] = [];
  const taken: ContainerTaken[] = [];
  const done: ContainerActionDone[] = [];
  world.events.on(containerSearched, (e) => searched.push(e));
  world.events.on(containerTaken, (e) => taken.push(e));
  world.events.on(containerActionDone, (e) => done.push(e));
  world.events.on(containerOpened, (e) => opened.push(e));
  world.events.on(containerLooted, (e) => looted.push(e));
  world.events.on(lockRefused, (e) => refused.push(e));
  const inside = () =>
    inventoryOf(sim, chest)?.items.map(({ defId, count }) => [defId, count] as const);
  const carried = () =>
    inventoryOf(sim, player)?.items.map(({ defId, count }) => [defId, count] as const);
  const save = () => ({
    deltas: persistence.capture(sim, baseline),
    facts: world.facts.snapshot(),
  });
  /** Delivers queued events, then returns what `list` heard. */
  const heard =
    <T>(list: T[]) =>
    (): T[] => {
      world.events.flush();
      return list;
    };
  return {
    world,
    sim,
    rules,
    containers,
    off,
    player,
    chest,
    opened: heard(opened),
    looted: heard(looted),
    refused: heard(refused),
    searched: heard(searched),
    taken: heard(taken),
    done: heard(done),
    inside,
    carried,
    save,
    persistence,
    baseline,
    prompt: () => interactionPrompt(sim, player),
  };
}

type Setup = ReturnType<typeof setup>;

/** A fresh world as built, with `saved`'s facts and the chest's level deltas loaded into it. */
function reload(
  saved: { deltas: LevelDeltas; facts: FactSnapshot },
  options: SetupOptions = {},
): Setup {
  const t = setup(options);
  t.world.facts.prepareRestore(saved.facts)();
  const report = t.persistence.apply(t.sim, t.baseline, saved.deltas);
  expect(report.skipped).toEqual([]);
  t.world.step([IDLE]);
  return t;
}

const opens = (t: Setup) => t.containers.open(t.sim, t.chest, t.player);
const command = (t: Setup, action: ContainerAction) =>
  containerActionCommand(t.player, t.chest, action) as unknown as ActionFrame;
const takeAllCommand = (t: Setup) => command(t, { op: 'take-all' });

describe('lootable containers (mw-e18.3)', () => {
  it('AC-1: a chest with a loot table rolls once: opened twice across a save and reload, the contents are identical', () => {
    const t = setup();
    expect(t.inside()).toEqual([]);
    const first = opens(t);
    expect(first).toMatchObject({ ok: true, first: true });
    const rolled = t.inside();
    expect(rolled?.[0]).toEqual(['bread', 2]); // the guaranteed draught of bread, then the rolls
    expect(t.opened()).toHaveLength(1);
    expect(t.opened()[0]?.rolled.length).toBeGreaterThan(0);
    expect(
      t.world.facts.get(containerFact({ level: LEVEL, id: 'chest', loot: null }, 'opened')),
    ).toBe(true);
    const gold = inventoryOf(t.sim, t.chest)?.gold;

    const back = reload(t.save());
    expect(back.inside()).toEqual(rolled);
    expect(inventoryOf(back.sim, back.chest)?.gold).toBe(gold);
    expect(opens(back)).toMatchObject({ ok: true, first: false });
    expect(back.inside()).toEqual(rolled);
    expect(back.opened()).toEqual([
      { tick: back.world.tick, entity: back.chest, actor: back.player, first: false, rolled: [] },
    ]);
  });

  it('AC-1: the roll comes from the chest’s own stream: the same chest rolls the same loot in any world with the seed, and no other draw moves', () => {
    const a = setup();
    const b = setup();
    b.world.random('loot').int(0, 100); // other loot drawn first
    const before = b.world.random('loot').serialize();
    opens(a);
    opens(b);
    expect(b.inside()).toEqual(a.inside());
    expect(b.world.random('loot').serialize()).toEqual(before);
  });

  it('AC-1: a class-conditioned entry drops for the opener’s class only', () => {
    const thief = setup({ classId: 'thief', chest: { loot: 'thief-stash' } });
    opens(thief);
    expect(thief.inside()).toEqual([['lockpicks', 1]]);
    const knight = setup({ classId: 'knight', chest: { loot: 'thief-stash' } });
    opens(knight);
    expect(knight.inside()).toEqual([]);
    const nobody = new Containers(knight.rules, knight.containers.loot); // no class lookup
    const crate = knight.sim.spawn();
    nobody.make(knight.sim, crate, {
      level: LEVEL,
      id: 'crate',
      position: { x: 3, y: 0, z: 0 },
      loot: 'thief-stash',
    });
    nobody.open(knight.sim, crate, knight.player);
    expect(inventoryOf(knight.sim, crate)?.items).toEqual([]);
  });

  it('AC-2: Interact opens the chest; Take All moves the contents to the inventory, empties it and sets its looted fact', () => {
    const t = setup({ chest: { contents: [{ item: 'letter', count: 1 }] } });
    expect(t.prompt()).toMatchObject({
      target: t.chest,
      verb: 'search',
      label: 'Search',
      available: true,
    });
    t.world.step([PRESS]);
    expect(t.opened()).toHaveLength(1);
    // Search opens it for the window (mw-e18.4): nothing moves yet.
    expect(t.searched()).toEqual([{ tick: t.world.tick - 1, entity: t.chest, actor: t.player }]);
    expect(t.carried()).toEqual([]);
    const taken = t.opened()[0]?.rolled ?? [];
    t.world.step([takeAllCommand(t)]);
    expect(t.inside()).toEqual([]);
    expect(inventoryOf(t.sim, t.chest)?.gold).toBe(0);
    // Everything that was inside is carried now, the quest letter too (taking it is not losing it).
    const carried = Object.fromEntries(
      (t.carried() ?? []).map(([id]) => [id, t.rules.count(t.sim, t.player, { defId: id })]),
    );
    expect(carried['letter']).toBe(1);
    for (const { item, count } of taken.filter((s) => s.item !== 'gold')) {
      expect(carried[item]).toBeGreaterThanOrEqual(count);
    }
    const gold = taken.find((s) => s.item === 'gold')?.count ?? 0;
    expect(inventoryOf(t.sim, t.player)?.gold).toBe(gold);
    const fact = `entity:${LEVEL}/chest.looted`;
    expect(t.world.facts.get(fact)).toBe(true);
    expect(t.looted()).toEqual([
      { tick: t.world.tick - 1, entity: t.chest, actor: t.player, fact },
    ]);
    expect(t.done()).toEqual([
      {
        tick: t.world.tick - 1,
        actor: t.player,
        entity: t.chest,
        action: { op: 'take-all' },
        ok: true,
      },
    ]);

    // Empty now: Search is greyed with the reason, and Interact does nothing more.
    t.world.step([IDLE]);
    expect(t.prompt()).toMatchObject({ verb: 'search', available: false, reason: EMPTY_REASON });
    t.world.step([PRESS]);
    expect(t.opened()).toHaveLength(2); // the take-all opened it too
    expect(t.searched()).toHaveLength(1);
  });

  it('AC-2: take all reports what moved, gold included; a stack the inventory refuses stays inside', () => {
    const t = setup({
      chest: {
        loot: 'regalia',
        contents: [
          { item: 'gold', count: 30 },
          { item: 'bread', count: 7 },
        ],
      },
      carry: ['crown'],
    });
    expect(inventoryOf(t.sim, t.chest)?.gold).toBe(30);
    const result = t.containers.takeAll(t.sim, t.chest, t.player);
    expect(result).toEqual({
      ok: true,
      moved: [
        { item: 'gold', count: 30 },
        { item: 'bread', count: 5 },
        { item: 'bread', count: 2 },
      ],
    });
    // The rolled crown is unique and the player has one: it stays, so the chest is not looted.
    expect(t.inside()).toEqual([['crown', 1]]);
    expect(t.looted()).toEqual([]);
    expect(containerEmpty(t.sim, t.chest)).toBe(false);
    expect(t.rules.count(t.sim, t.player, { defId: 'bread' })).toBe(7);
  });

  it('AC-2: take one moves one stack (or part of it), and the last take sets the looted fact', () => {
    const t = setup({
      chest: {
        loot: null,
        contents: [
          { item: 'bread', count: 3 },
          { item: 'arrow', count: 10 },
        ],
      },
    });
    const [bread, arrows] = inventoryOf(t.sim, t.chest)?.items ?? [];
    const take = (instanceId: number, count?: number) =>
      t.containers.take(t.sim, t.chest, t.player, instanceId, count);
    expect(take(arrows?.instanceId ?? 0, 4)).toEqual({
      ok: true,
      moved: [{ item: 'arrow', count: 4 }],
    });
    expect(t.inside()).toEqual([
      ['bread', 3],
      ['arrow', 6],
    ]);
    expect(take(arrows?.instanceId ?? 0, 7)).toEqual({ ok: false, reason: 'not-enough' });
    expect(take(99)).toEqual({ ok: false, reason: 'no-instance' });
    expect(() => take(arrows?.instanceId ?? 0, 0)).toThrow(RangeError);
    expect(take(arrows?.instanceId ?? 0)).toEqual({
      ok: true,
      moved: [{ item: 'arrow', count: 6 }],
    });
    expect(t.looted()).toEqual([]);
    expect(take(bread?.instanceId ?? 0)).toEqual({
      ok: true,
      moved: [{ item: 'bread', count: 3 }],
    });
    expect(t.looted()).toHaveLength(1);
    expect(t.carried()).toEqual([
      ['arrow', 10],
      ['bread', 3],
    ]);
  });

  it('AC-2: a refused take changes nothing', () => {
    const t = setup({ chest: { loot: 'regalia' }, carry: ['crown'] });
    opens(t);
    const [crown] = inventoryOf(t.sim, t.chest)?.items ?? [];
    expect(t.containers.take(t.sim, t.chest, t.player, crown?.instanceId ?? 0)).toEqual({
      ok: false,
      reason: 'unique-held',
    });
    expect(t.inside()).toEqual([['crown', 1]]);
    expect(t.looted()).toEqual([]);
  });

  it('AC-3: a locked chest without a key refuses with reason locked and does not roll its table', () => {
    const t = setup({ chest: { lock: IRON_CHEST } });
    // Its prompt is the lock's: Unlock greyed with the hint, Pick lock needing lockpicks.
    expect(t.prompt()).toMatchObject({
      verb: 'unlock',
      available: false,
      reason: IRON_CHEST.hint,
      options: [
        { verb: 'unlock', available: false },
        { verb: 'pick-lock', available: false },
      ],
    });
    t.world.step([PRESS]); // nothing usable: nothing happens
    expect(opens(t)).toEqual({ ok: false, reason: 'locked' });
    expect(t.containers.takeAll(t.sim, t.chest, t.player)).toEqual({ ok: false, reason: 'locked' });
    expect(t.containers.take(t.sim, t.chest, t.player, 1)).toEqual({ ok: false, reason: 'locked' });
    expect(t.containers.put(t.sim, t.chest, t.player, 1)).toEqual({ ok: false, reason: 'locked' });
    expect(t.refused().map((e) => e.reason)).toEqual(['locked', 'locked', 'locked', 'locked']);
    expect(t.refused()[0]).toEqual({
      tick: t.world.tick,
      entity: t.chest,
      lock: 'iron-chest',
      reason: 'locked',
      hint: IRON_CHEST.hint,
      source: t.player,
    });
    expect(t.inside()).toEqual([]);
    expect(t.opened()).toEqual([]);
    expect(t.world.facts.has(`entity:${LEVEL}/chest.opened`)).toBe(false);
  });

  it('AC-3: the key on the keyring unlocks the chest through the same path as a door; then Search opens it and Take All empties it', () => {
    const t = setup({ chest: { lock: IRON_CHEST }, carry: ['chest-key'] });
    expect(t.prompt()).toMatchObject({ verb: 'unlock', available: true });
    t.world.step([PRESS]);
    expect(t.world.get(t.chest, LockComponent)?.locked).toBe(false);
    expect(t.opened()).toEqual([]); // unlocking is not opening
    t.world.step([IDLE]);
    expect(t.prompt()).toMatchObject({ verb: 'search', available: true });
    t.world.step([PRESS]);
    expect(t.opened()).toHaveLength(1);
    expect(t.searched()).toHaveLength(1);
    t.world.step([takeAllCommand(t)]);
    expect(t.inside()).toEqual([]);

    // The unlocked lock is part of the level's changes: after a reload the chest offers Search.
    const back = reload(t.save(), { chest: { lock: IRON_CHEST } });
    expect(back.world.get(back.chest, LockComponent)?.locked).toBe(false);
    expect(back.prompt()).toMatchObject({ verb: 'search', available: false, reason: EMPTY_REASON });
  });

  it('AC-3: lockpicks pick the chest’s lock; a lockless or unpickable lock offers what it can', () => {
    const t = setup({ chest: { lock: IRON_CHEST }, capabilities: [LOCKPICK_CAPABILITY] });
    expect(t.prompt()).toMatchObject({ verb: 'pick-lock', available: true });
    t.world.step([PRESS]);
    expect(t.world.get(t.chest, LockComponent)?.locked).toBe(false);
    const open = setup({ chest: { lock: IRON_CHEST, locked: false } });
    expect(open.prompt()).toMatchObject({ verb: 'search', available: true });
  });

  it('AC-3: a door’s lock opening leaves containers alone', () => {
    const t = setup({ carry: ['chest-key'] });
    const door = t.sim.spawn();
    makeDoor(t.sim, door, DOOR, { origin: { x: 5, y: 0, z: 0 }, lock: IRON_CHEST });
    refreshAffordances(t.sim, door);
    t.world.events.emit(interacted, {
      actor: t.player,
      target: door,
      verb: 'unlock',
      affordance: 0,
    });
    t.world.events.flush();
    expect(t.world.get(door, LockComponent)?.locked).toBe(false);
    expect(t.world.get(t.chest, InteractableComponent)?.affordances.map((a) => a.verb)).toEqual([
      'search',
    ]);
  });

  it('AC-4: an item put into a chest is still inside after a save and reload', () => {
    const t = setup({ chest: { loot: null }, carry: ['crown', 'letter'] });
    const [crown, letter] = inventoryOf(t.sim, t.player)?.items ?? [];
    const put = (instanceId: number, count?: number) =>
      t.containers.put(t.sim, t.chest, t.player, instanceId, count);
    expect(put(letter?.instanceId ?? 0)).toEqual({ ok: false, reason: 'quest-item' });
    expect(put(99)).toEqual({ ok: false, reason: 'no-instance' });
    expect(put(crown?.instanceId ?? 0)).toEqual({ ok: true, moved: [{ item: 'crown', count: 1 }] });
    expect(t.inside()).toEqual([['crown', 1]]);
    expect(t.carried()).toEqual([['letter', 1]]);

    const saved = t.save();
    expect(saved.deltas.entities).toEqual([
      { id: 'spawn:chest', aspects: { container: inventoryOf(t.sim, t.chest) } },
    ]);
    const back = reload(saved);
    expect(back.inside()).toEqual([['crown', 1]]);
    expect(back.prompt()).toMatchObject({ verb: 'search', available: true });
  });

  it('AC-4: a put the chest refuses changes nothing', () => {
    const t = setup({
      chest: { loot: null, contents: [{ item: 'bread', count: 10 }] },
      unitGuard: 10,
    });
    t.rules.add(t.sim, t.player, 'bread', 1);
    const [bread] = inventoryOf(t.sim, t.player)?.items ?? [];
    expect(t.containers.put(t.sim, t.chest, t.player, bread?.instanceId ?? 0)).toEqual({
      ok: false,
      reason: 'stack-limit',
    });
    expect(t.carried()).toEqual([['bread', 1]]);
  });

  it('a roll the pack refuses leaves that stack out of what was rolled', () => {
    // The chest already holds the crown its table guarantees: the second one cannot go in.
    const t = setup({ chest: { loot: 'regalia', contents: [{ item: 'crown', count: 1 }] } });
    opens(t);
    expect(t.opened()[0]?.rolled).toEqual([]);
    expect(t.inside()).toEqual([['crown', 1]]);
  });

  it('an empty chest with nothing to roll is empty before it is opened; a non-container never is', () => {
    const t = setup({ chest: { loot: null } });
    expect(containerEmpty(t.sim, t.chest)).toBe(true);
    expect(t.prompt()).toMatchObject({ available: false, reason: EMPTY_REASON });
    expect(containerEmpty(t.sim, t.player)).toBe(false);
    const rolls = setup();
    expect(containerEmpty(rolls.sim, rolls.chest)).toBe(false);
    expect(() => t.containers.open(t.sim, t.player, t.player)).toThrow(/is not a container/);
  });

  it('Interact ignores other verbs, other targets and actors without an inventory; the subscriptions come off', () => {
    const t = setup();
    const emit = (actor: EntityId, target: EntityId, verb: 'search' | 'use') => {
      t.world.events.emit(interacted, { actor, target, verb, affordance: 0 });
    };
    emit(t.player, t.chest, 'use');
    emit(t.player, t.player, 'search');
    const stranger = t.sim.spawn();
    emit(stranger, t.chest, 'search');
    expect(t.opened()).toEqual([]);
    t.off();
    emit(t.player, t.chest, 'search');
    expect(t.opened()).toEqual([]);
  });

  it('works without interaction or mechanisms: placed at its anchor, no prompt, no lock', () => {
    const world = new World<never>({ seed: 2 });
    world.register(InventoryComponent, PlacementComponent);
    const rules = new InventoryRules(ITEMS);
    const containers = new Containers(rules, new LootTables(TABLES, ITEMS));
    installContainers(world, containers);
    const chest = world.spawn();
    containers.make(world, chest, { level: LEVEL, id: 'chest', position: { x: 1, y: 0, z: 2 } });
    expect(world.get(chest, PlacementComponent)).toMatchObject({
      x: 1,
      y: 0.35,
      z: 2,
      radius: 0.4,
    });
    const actor = world.spawn();
    addInventory(world, actor);
    expect(containers.open(world, chest, actor)).toEqual({ ok: true, first: true, items: [] });
    refreshContainerAffordances(world, chest); // no interaction: nothing to refresh
    world.register(InteractableComponent);
    refreshContainerAffordances(world, chest); // made before interaction: it has no prompt
    expect(world.has(chest, InteractableComponent)).toBe(false);
    refreshContainerAffordances(new World<never>({ seed: 3 }), chest); // no containers at all
  });

  it('places a scene’s container spawns with their loot, contents and locks', () => {
    const t = setup();
    const at = { x: 4, y: 0, z: 0 };
    const spawns = [
      { entity: t.sim.spawn(), spawn: { id: 'marker', position: at } },
      {
        entity: t.sim.spawn(),
        spawn: {
          id: 'strongbox',
          position: at,
          container: {
            loot: 'regalia',
            contents: [{ item: 'bread', count: 2 }],
            lock: 'iron-chest',
            locked: true,
          },
        },
      },
      { entity: t.sim.spawn(), spawn: { id: 'barrel', position: at, container: { contents: [] } } },
    ];
    const locks = (id: string) => (id === IRON_CHEST.id ? IRON_CHEST : undefined);
    const made = addSceneContainers(t.sim, t.containers, 'vault', spawns, locks);
    const [, strongbox, barrel] = spawns.map((s) => s.entity);
    expect(made).toEqual([strongbox, barrel]);
    expect(t.world.get(strongbox ?? 0, ContainerComponent)).toEqual({
      loot: 'regalia',
      level: 'vault',
      id: 'strongbox',
    });
    expect(t.world.get(strongbox ?? 0, LockComponent)?.locked).toBe(true);
    expect(inventoryOf(t.sim, strongbox ?? 0)?.items.map((i) => i.defId)).toEqual(['bread']);
    expect(t.world.get(barrel ?? 0, ContainerComponent)?.loot).toBeNull();
    expect(t.world.has(barrel ?? 0, LockComponent)).toBe(false);
    const unknown = [
      {
        entity: t.sim.spawn(),
        spawn: { id: 'x', position: at, container: { contents: [], lock: 'nope' } },
      },
    ];
    expect(() => addSceneContainers(t.sim, t.containers, 'vault', unknown, locks)).toThrow(
      'unknown lock "nope"',
    );
  });
});

describe('container window actions (mw-e18.4)', () => {
  it('AC-1: a take-all command moves every stack and the gold in one step and reports what moved', () => {
    const t = setup({
      chest: {
        loot: null,
        contents: [
          { item: 'bread', count: 2 },
          { item: 'arrow', count: 5 },
          { item: 'gold', count: 12 },
        ],
      },
    });
    t.world.step([takeAllCommand(t)]);
    expect(t.inside()).toEqual([]);
    expect(t.carried()).toEqual([
      ['bread', 2],
      ['arrow', 5],
    ]);
    expect(inventoryOf(t.sim, t.player)?.gold).toBe(12);
    expect(t.taken()).toEqual([
      {
        tick: t.world.tick - 1,
        entity: t.chest,
        actor: t.player,
        moved: [
          { item: 'gold', count: 12 },
          { item: 'bread', count: 2 },
          { item: 'arrow', count: 5 },
        ],
      },
    ]);
    expect(t.looted()).toHaveLength(1);
  });

  it('take and take-gold commands move one stack or the gold; refusals are reported and move nothing', () => {
    const t = setup({
      chest: {
        loot: 'regalia',
        contents: [
          { item: 'bread', count: 3 },
          { item: 'gold', count: 7 },
        ],
      },
      carry: ['crown'],
    });
    opens(t);
    const [bread, crown] = inventoryOf(t.sim, t.chest)?.items ?? [];
    t.world.step([
      command(t, { op: 'take', instanceId: bread?.instanceId ?? 0, count: 2 }),
      command(t, { op: 'take-gold' }),
      command(t, { op: 'take', instanceId: crown?.instanceId ?? 0 }),
      command(t, { op: 'take', instanceId: 99 }),
    ]);
    expect(t.inside()).toEqual([
      ['bread', 1],
      ['crown', 1],
    ]);
    expect(inventoryOf(t.sim, t.player)?.gold).toBe(7);
    expect(t.taken().map((e) => e.moved)).toEqual([
      [{ item: 'bread', count: 2 }],
      [{ item: 'gold', count: 7 }],
    ]);
    expect(t.done().map(({ action, ok, reason }) => ({ op: action.op, ok, reason }))).toEqual([
      { op: 'take', ok: true, reason: undefined },
      { op: 'take-gold', ok: true, reason: undefined },
      { op: 'take', ok: false, reason: 'unique-held' },
      { op: 'take', ok: false, reason: 'no-instance' },
    ]);
    // No gold left: take-gold moves nothing and fires no take.
    expect(t.containers.takeGold(t.sim, t.chest, t.player)).toEqual({ ok: true, moved: [] });
    expect(t.taken()).toHaveLength(2);
  });

  it('a locked container refuses window actions; Search on it opens nothing', () => {
    const t = setup({ chest: { lock: IRON_CHEST } });
    t.world.step([command(t, { op: 'take-gold' })]);
    expect(t.done()).toMatchObject([{ ok: false, reason: 'locked' }]);
    t.world.events.emit(interacted, {
      actor: t.player,
      target: t.chest,
      verb: 'search',
      affordance: 0,
    });
    expect(t.searched()).toEqual([]);
    expect(t.opened()).toEqual([]);
  });

  it('skips commands for a gone container, a non-container or an actor without an inventory, and stops once uninstalled', () => {
    const t = setup({ chest: { loot: null, contents: [{ item: 'bread', count: 1 }] } });
    const stranger = t.sim.spawn();
    const other = t.sim.spawn();
    t.world.step([
      containerActionCommand(stranger, t.chest, { op: 'take-all' }) as unknown as ActionFrame,
      containerActionCommand(t.player, other, { op: 'take-all' }) as unknown as ActionFrame,
      IDLE,
    ]);
    expect(t.done()).toEqual([]);
    expect(t.inside()).toEqual([['bread', 1]]);
    t.off();
    t.world.step([takeAllCommand(t)]);
    expect(t.done()).toEqual([]);
    expect(t.inside()).toEqual([['bread', 1]]);
  });

  it('builds commands, validates them, and recognises them', () => {
    expect(containerActionCommand(1, 2, { op: 'take', instanceId: 3, count: 4 })).toEqual({
      kind: CONTAINER_ACTION_COMMAND,
      actor: 1,
      entity: 2,
      action: { op: 'take', instanceId: 3, count: 4 },
    });
    expect(() => containerActionCommand(1, 2, { op: 'take', instanceId: 0 })).toThrow(
      /instance id must be a positive integer/,
    );
    expect(() => containerActionCommand(1, 2, { op: 'take', instanceId: 1, count: 1.5 })).toThrow(
      /count must be a positive integer/,
    );
    expect(isContainerActionCommand(containerActionCommand(1, 2, { op: 'take-all' }))).toBe(true);
    expect(isContainerActionCommand(null)).toBe(false);
    expect(isContainerActionCommand('loot.containerAction')).toBe(false);
    expect(isContainerActionCommand({ kind: 'item.inventoryAction' })).toBe(false);
    expect(
      containerActionsSystem(
        new Containers(new InventoryRules(ITEMS), new LootTables(TABLES, ITEMS)),
        () => true,
      ).name,
    ).toBe('containerActions');
  });
});

describe('ownership and theft in containers (mw-e27.9)', () => {
  const OWNER = { owner: 'mirela', level: LEVEL, place: 'chest' };
  const owned = (extra: Partial<ContainerSpec> = {}): SetupOptions => ({
    chest: { loot: null, owner: OWNER, ...extra },
  });
  const flagsCarried = (t: Setup) => inventoryOf(t.sim, t.player)?.items.map((i) => i.flags);

  it('AC-1: taking from Mirela’s chest without permission flags the goods stolen and records a theft with owner Mirela', () => {
    const t = setup(owned({ contents: [{ item: 'arrow', count: 12 }] }));
    const heard: TheftRecorded[] = [];
    t.world.events.on(theftRecorded, (e) => heard.push(e));
    t.world.step([takeAllCommand(t)]);
    expect(flagsCarried(t)).toEqual([{ stolen: true, ownerId: 'mirela' }]);
    expect(thefts(t.sim)).toMatchObject([
      { level: LEVEL, owner: 'mirela', item: 'arrow', units: 12, place: 'chest', status: 'stolen' },
    ]);
    t.world.events.flush();
    expect(heard).toMatchObject([{ count: 12, witnessed: 'unknown', thief: t.player }]);
  });

  it('AC-1: each stack taken is its own theft, and a single take records one for the units moved', () => {
    const t = setup(
      owned({
        contents: [
          { item: 'arrow', count: 4 },
          { item: 'lockpicks', count: 1 },
        ],
      }),
    );
    const arrows = inventoryOf(t.sim, t.chest)?.items[0]?.instanceId ?? 0;
    t.containers.take(t.sim, t.chest, t.player, arrows, 3);
    expect(thefts(t.sim).map((x) => [x.id, x.item, x.units])).toEqual([['theft-1', 'arrow', 3]]);
    t.containers.takeAll(t.sim, t.chest, t.player);
    expect(thefts(t.sim).map((x) => [x.id, x.item, x.units])).toEqual([
      ['theft-1', 'arrow', 3],
      ['theft-2', 'arrow', 1],
      ['theft-3', 'lockpicks', 1],
    ]);
  });

  it('AC-2: a permitted take (the owner, or one the game permits) flags nothing', () => {
    const t = setup(owned({ contents: [{ item: 'bread', count: 2 }] }));
    const generous = new Containers(t.rules, t.containers.loot, { permits: () => true });
    generous.takeAll(t.sim, t.chest, t.player);
    expect(flagsCarried(t)).toEqual([{}]);
    expect(thefts(t.sim)).toEqual([]);
  });

  it('AC-4: an unowned chest records no theft when taken from', () => {
    const t = setup({ chest: { loot: null, contents: [{ item: 'bread', count: 2 }] } });
    expect(ownerOf(t.sim, t.chest)).toBeUndefined();
    t.containers.takeAll(t.sim, t.chest, t.player);
    expect(flagsCarried(t)).toEqual([{}]);
    expect(thefts(t.sim)).toEqual([]);
  });

  it('AC-3: a stolen stack put back into its owner’s chest is clean again and the theft resolves to returned', () => {
    const t = setup(owned({ contents: [{ item: 'crown', count: 1 }] }));
    t.containers.takeAll(t.sim, t.chest, t.player);
    expect(flagsCarried(t)).toEqual([{ stolen: true, ownerId: 'mirela' }]);
    const heard: TheftReturned[] = [];
    t.world.events.on(theftReturned, (e) => heard.push(e));
    const crown = inventoryOf(t.sim, t.player)?.items[0]?.instanceId ?? 0;
    expect(t.containers.put(t.sim, t.chest, t.player, crown)).toMatchObject({ ok: true });
    expect(inventoryOf(t.sim, t.chest)?.items.map((i) => i.flags)).toEqual([{}]);
    expect(thefts(t.sim)).toMatchObject([{ id: 'theft-1', status: 'returned', units: 1 }]);
    t.world.events.flush();
    expect(heard).toMatchObject([{ id: 'theft-1', count: 1, resolved: true, actor: t.player }]);
  });

  it('AC-3: a partial return keeps the theft open for the units still out, then later returns resolve it', () => {
    const t = setup(owned({ contents: [{ item: 'arrow', count: 10 }] }));
    t.containers.takeAll(t.sim, t.chest, t.player);
    const arrows = inventoryOf(t.sim, t.player)?.items[0]?.instanceId ?? 0;
    t.containers.put(t.sim, t.chest, t.player, arrows, 4);
    expect(thefts(t.sim)).toMatchObject([{ status: 'stolen', units: 6 }]);
    t.containers.put(t.sim, t.chest, t.player, arrows, 6);
    expect(thefts(t.sim)).toMatchObject([{ status: 'returned', units: 6 }]);
    expect(inventoryOf(t.sim, t.chest)?.items.map((i) => [i.count, i.flags])).toEqual([[10, {}]]);
  });

  it('AC-3: goods stolen from someone else, or put into an unowned or another owner’s chest, stay stolen', () => {
    const t = setup(owned({ contents: [{ item: 'bread', count: 1 }] }));
    t.containers.takeAll(t.sim, t.chest, t.player);
    const other = t.sim.spawn();
    t.containers.make(t.sim, other, {
      level: LEVEL,
      id: 'other',
      position: { x: 3, y: 0, z: 0 },
      owner: { owner: 'toma', level: LEVEL, place: 'other' },
    });
    const plain = t.sim.spawn();
    t.containers.make(t.sim, plain, {
      level: LEVEL,
      id: 'plain',
      position: { x: 6, y: 0, z: 0 },
    });
    for (const target of [other, plain]) {
      const bread = inventoryOf(t.sim, t.player)?.items[0]?.instanceId ?? 0;
      t.containers.put(t.sim, target, t.player, bread);
      expect(inventoryOf(t.sim, target)?.items.map((i) => i.flags)).toEqual([
        { stolen: true, ownerId: 'mirela' },
      ]);
      const back = inventoryOf(t.sim, target)?.items[0]?.instanceId ?? 0;
      t.containers.take(t.sim, target, t.player, back);
    }
    expect(thefts(t.sim).filter((x) => x.status === 'returned')).toEqual([]);
  });

  it('AC-5: after a save and reload the stolen flag and the theft fact are still there', () => {
    const t = setup(owned({ contents: [{ item: 'crown', count: 1 }] }));
    t.containers.takeAll(t.sim, t.chest, t.player);
    const savedPack = structuredClone(inventoryOf(t.sim, t.player));
    const saved = t.save();
    const back = reload(saved, owned());
    // The player's pack is a component of the saved world; here the pack is restored as the game does.
    back.sim.set(back.player, InventoryComponent, savedPack as never);
    expect(flagsCarried(back)).toEqual([{ stolen: true, ownerId: 'mirela' }]);
    expect(thefts(back.sim)).toMatchObject([
      { id: 'theft-1', owner: 'mirela', item: 'crown', witnessed: 'unknown', status: 'stolen' },
    ]);
    // The counter saved too: the next theft is theft-2.
    expect(back.world.facts.get('ownership.thefts')).toBe(1);
  });

  it('a scene container spawn with an owner is tagged with it under the level and spawn id', () => {
    const t = setup();
    const entity = t.sim.spawn();
    addSceneContainers(
      t.sim,
      t.containers,
      'vault',
      [
        {
          entity,
          spawn: {
            id: 'strongbox',
            position: { x: 5, y: 0, z: 0 },
            container: { contents: [] },
            owner: 'mirela',
          },
        },
      ],
      () => undefined,
    );
    expect(ownerOf(t.sim, entity)).toEqual({ owner: 'mirela', level: 'vault', place: 'strongbox' });
  });

  it('a broken owned chest spills goods that are still its owner’s', () => {
    const t = setup(owned({ contents: [{ item: 'bread', count: 2 }] }));
    const spawned: unknown[] = [];
    const spawner = {
      spawn: (_w: unknown, spec: unknown) => {
        spawned.push(spec);
        return t.sim.spawn();
      },
    };
    const breaker = new Containers(t.rules, t.containers.loot, { items: spawner });
    breaker.spill(t.sim, t.chest);
    expect(spawned).toMatchObject([{ defId: 'bread', owner: OWNER }]);
  });
});
