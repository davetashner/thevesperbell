// The sim world (mw-e00.15): entities, components, systems, events and time in one deterministic
// container. `step(inputs)` is the only way time advances. Each step runs the registered systems in
// registration order and flushes the event bus at every phase boundary (start of tick, after each
// system). Structural changes made during a step (spawn, destroy, add, remove) are queued and applied
// in issue order at the end of the tick, so every system in tick N sees the same set of entities and
// those changes are visible from tick N+1. Outside a step (setup, tools, tests) they apply at once.
//
// Determinism target: same build, same JS engine, same seed and inputs → identical snapshots. Nothing
// here reads the wall clock or Math.random; randomness comes from named, snapshotted RNG streams.

import { SimClock, type ClockState, type ReadonlyClock } from '../clock';
import {
  applyDifficultyCommands,
  DifficultyChanged,
  difficultyOverrides,
  resolveDifficulty,
  type DifficultyConfig,
  type DifficultyOverrides,
} from '../difficulty';
import { applyFactCommands } from '../facts/commands';
import { factChanged, FactStore, type FactSnapshot } from '../facts/store';
import type { PhysicsPort, PhysicsState } from '../physics/port';
import { Rng, type RngState } from '../rng';
import {
  ComponentStore,
  usesDefaultSerialize,
  type ComponentType,
  type EntityId,
} from './component';
import { DEFAULT_MAX_EVENTS_PER_FLUSH, EventBus } from './events';
import { Query, type ComponentList, type StructureVersion } from './query';

export interface WorldOptions {
  /** World seed (32-bit unsigned integer); every RNG stream derives from it. */
  readonly seed: number;
  /** Fixed tick rate; defaults to 60 Hz. */
  readonly hz?: number;
  /** Event cycle guard; defaults to 10,000 events per flush. */
  readonly maxEventsPerFlush?: number;
  /** Difficulty multipliers that differ from neutral (1.0); validated, see `resolveDifficulty`. */
  readonly difficulty?: DifficultyOverrides;
  /**
   * The physics this world owns (ADR-0001, mw-e03.35): stepped once per tick before the systems run,
   * and part of every snapshot. Absent for worlds without physics.
   */
  readonly physics?: PhysicsPort;
}

/** What a system receives each tick. */
export interface TickContext<TInput> {
  readonly world: World<TInput>;
  /** This tick's input commands, in the order given to `step`, after the world's input filters. */
  readonly inputs: readonly TInput[];
  /** The tick being simulated (the clock advances after the last system). */
  readonly tick: number;
  readonly clock: ReadonlyClock;
  /** This tick's difficulty multipliers (frozen; changed only by a `difficultyCommand` input). */
  readonly difficulty: DifficultyConfig;
}

/** A unit of game rules, run once per tick in registration order. */
export interface System<TInput> {
  /** Unique within a world; used in errors and benchmarks. */
  readonly name: string;
  run(ctx: TickContext<TInput>): void;
}

/**
 * Decides whether the systems see one of a tick's inputs (mw-e01.8: a dead player's ActionFrames
 * are dropped). Runs at the start of each step with the world as it was at the end of the last tick,
 * so a change made in tick N filters from tick N+1. Must be deterministic: read only world state.
 */
export interface InputFilter<TInput> {
  /** Unique within a world, like system names. */
  readonly name: string;
  /** Whether the systems see `input` this tick. */
  keep(input: TInput, world: World<TInput>): boolean;
  /**
   * What the systems see of an input that was kept (mw-e03.23: a player hiding in a wardrobe keeps
   * only their look and Interact). Absent: the input as it was. Must be deterministic and pure.
   */
  map?(input: TInput, world: World<TInput>): unknown;
}

/**
 * Plain-data world state: consumed by state hashing and saves. Entity ids and component rows are in
 * ascending id order and component/stream names are sorted, so equal worlds give equal snapshots.
 */
export interface WorldSnapshot {
  readonly seed: number;
  readonly clock: ClockState;
  /** Non-neutral difficulty multipliers; absent when every multiplier is 1 (see difficulty.ts). */
  readonly difficulty?: DifficultyOverrides;
  /** Set world facts, keys in code-unit order; absent when none is set (see facts/store.ts). */
  readonly facts?: FactSnapshot;
  /** The physics port's state; present exactly when the world has physics (see physics/port.ts). */
  readonly physics?: PhysicsState;
  /** The next id `spawn` will hand out; ids below it are never reused. */
  readonly nextEntity: EntityId;
  readonly entities: readonly EntityId[];
  /** Component name → [entity id, serialized value] rows. */
  readonly components: Readonly<Record<string, readonly (readonly [EntityId, unknown])[]>>;
  /** RNG stream name → generator state. */
  readonly rng: Readonly<Record<string, RngState>>;
}

type Command =
  | { readonly kind: 'spawn'; readonly id: EntityId }
  | { readonly kind: 'destroy'; readonly id: EntityId }
  | {
      readonly kind: 'add';
      readonly id: EntityId;
      readonly store: ComponentStore<unknown>;
      readonly value: unknown;
    }
  | { readonly kind: 'remove'; readonly id: EntityId; readonly store: ComponentStore<unknown> };

/**
 * Called when a component leaves a live entity: removed, or destroyed with its entity. Receives the
 * value it had. Runs when the change applies (at once between steps, at the end of the tick during
 * a step); never on `restore`, which replaces all state wholesale.
 */
export type RemoveListener<T> = (id: EntityId, value: T) => void;

export interface SnapshotOptions {
  /**
   * When true, rows of components using the default (clone) hook reference the live values instead
   * of copies. Much cheaper, so state hashing uses it; the result is only valid until the world next
   * changes and must never be mutated or kept. Custom `serialize` hooks still run. Default false.
   */
  readonly shared?: boolean;
}

/** Code-unit order for map entries (keys are unique, so never equal); locale-independent. */
const byKey = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]): number =>
  a < b ? -1 : 1;

export class World<TInput = unknown> {
  readonly events: EventBus;
  private seedValue: number;
  private root: Rng;
  private simClock: SimClock;
  private config: DifficultyConfig;
  private readonly factStore: FactStore;
  private readonly physicsPort: PhysicsPort | undefined;
  private readonly streams = new Map<string, Rng>();
  private readonly stores = new Map<string, ComponentStore<unknown>>();
  private readonly systems: System<TInput>[] = [];
  private readonly inputFilters: InputFilter<TInput>[] = [];
  private readonly queries = new Map<string, Query<ComponentList>>();
  private readonly removeListeners = new Map<ComponentStore<unknown>, RemoveListener<unknown>[]>();
  private readonly structure: StructureVersion = { version: 0 };
  private alive = new Set<EntityId>();
  private readonly pendingSpawns = new Set<EntityId>();
  private commands: Command[] = [];
  private nextEntity: EntityId = 1;
  private stepping = false;

  constructor(options: WorldOptions) {
    this.root = Rng.create(options.seed);
    this.seedValue = options.seed;
    this.simClock = new SimClock(options.hz);
    this.config = resolveDifficulty(options.difficulty);
    this.events = new EventBus(options.maxEventsPerFlush ?? DEFAULT_MAX_EVENTS_PER_FLUSH);
    this.physicsPort = options.physics;
    this.factStore = new FactStore({
      emit: (change) => {
        this.events.emit(factChanged, change);
      },
      tick: () => this.simClock.tick,
    });
  }

  get seed(): number {
    return this.seedValue;
  }

  /** Read-only time; only `step` advances it. */
  get clock(): ReadonlyClock {
    return this.simClock;
  }

  get tick(): number {
    return this.simClock.tick;
  }

  /** The current difficulty multipliers (frozen). */
  get difficulty(): DifficultyConfig {
    return this.config;
  }

  /**
   * Persistent world facts (quests, dialogue, endings, puzzles). Systems write them during a tick;
   * outside the sim, change them with a `factCommand` input so replays record it.
   */
  get facts(): FactStore {
    return this.factStore;
  }

  /** The physics this world owns and steps, if it has any. */
  get physics(): PhysicsPort | undefined {
    return this.physicsPort;
  }

  /** Live entities (spawns queued in the current tick are not counted until it ends). */
  get entityCount(): number {
    return this.alive.size;
  }

  /** Registers component types. Names are the snapshot keys, so they must be unique. */
  register(...types: ComponentType<unknown>[]): this {
    for (const type of types) {
      if (this.stores.has(type.name)) {
        throw new Error(`component "${type.name}" is already registered`);
      }
      this.stores.set(type.name, new ComponentStore(type));
    }
    return this;
  }

  /** Whether exactly this component type is registered (optional features check before reading). */
  isRegistered(type: ComponentType<unknown>): boolean {
    return this.stores.get(type.name)?.type === type;
  }

  /** Appends a system; systems run in the order they were added. */
  addSystem(system: System<TInput>): this {
    if (this.systems.some((s) => s.name === system.name)) {
      throw new Error(`system "${system.name}" is already registered`);
    }
    this.systems.push(system);
    return this;
  }

  /**
   * Appends an input filter (see InputFilter): the systems see only the inputs every filter keeps,
   * in their original order. Difficulty and fact commands are applied from the unfiltered inputs.
   */
  addInputFilter(filter: InputFilter<TInput>): this {
    if (this.inputFilters.some((f) => f.name === filter.name)) {
      throw new Error(`input filter "${filter.name}" is already registered`);
    }
    this.inputFilters.push(filter);
    return this;
  }

  /**
   * The named RNG stream (created from the world seed on first use, then persistent and snapshotted).
   * Give each system or concern its own stream so their draws never shift one another.
   */
  random(name: string): Rng {
    let rng = this.streams.get(name);
    if (rng === undefined) {
      rng = this.root.stream(name);
      this.streams.set(name, rng);
    }
    return rng;
  }

  /** Allocates a new, never-reused entity id. During a step the entity goes live at the end of the tick. */
  spawn(): EntityId {
    const id = this.nextEntity++;
    if (this.stepping) this.pendingSpawns.add(id);
    this.issue({ kind: 'spawn', id });
    return id;
  }

  /** Destroys an entity and all its components (deferred to the end of the tick during a step). */
  destroy(id: EntityId): void {
    this.requireKnown(id);
    this.issue({ kind: 'destroy', id });
  }

  /** Adds or replaces a component (deferred to the end of the tick during a step). */
  add<T>(id: EntityId, type: ComponentType<T>, value: T): void {
    this.requireKnown(id);
    this.issue({ kind: 'add', id, store: this.storeOf(type), value });
  }

  /** Removes a component if present (deferred to the end of the tick during a step). */
  remove(id: EntityId, type: ComponentType<unknown>): void {
    this.requireKnown(id);
    this.issue({ kind: 'remove', id, store: this.storeOf(type) });
  }

  /**
   * Calls `listener` whenever a `type` component leaves an entity, by `remove` or `destroy`, so
   * whatever the component owns outside the world (a physics body) goes with it. Listeners run in
   * the order they were added; for a destroyed entity, components go in registration order.
   */
  onRemove<T>(type: ComponentType<T>, listener: RemoveListener<T>): this {
    const store = this.storeOf(type) as ComponentStore<unknown>;
    const listeners = this.removeListeners.get(store) ?? [];
    listeners.push(listener as RemoveListener<unknown>);
    this.removeListeners.set(store, listeners);
    return this;
  }

  /** Replaces an existing component's value immediately (not a structural change). */
  set<T>(id: EntityId, type: ComponentType<T>, value: T): void {
    const store = this.storeOf(type);
    if (!store.has(id)) {
      throw new Error(`entity ${String(id)} has no "${type.name}" component to set`);
    }
    store.put(id, value);
  }

  get<T>(id: EntityId, type: ComponentType<T>): T | undefined {
    return this.storeOf(type).get(id);
  }

  has(id: EntityId, type: ComponentType<unknown>): boolean {
    return this.storeOf(type).has(id);
  }

  isAlive(id: EntityId): boolean {
    return this.alive.has(id);
  }

  /** A cached query over entities that have every listed component; iterates in ascending id order. */
  query<const Ts extends ComponentList>(...types: Ts): Query<Ts> {
    const stores = types.map((t) => this.storeOf(t)); // validates every type, cached or not
    const key = JSON.stringify(types.map((t) => t.name));
    let query = this.queries.get(key);
    if (query === undefined) {
      query = new Query(this.structure, stores);
      this.queries.set(key, query);
    }
    return query as Query<Ts>; // the key encodes Ts's component names, in order
  }

  /**
   * Simulates one fixed tick. First applies any `difficultyCommand` and `factCommand` among the
   * inputs (so the whole tick, and every later one, sees the new values). Then steps physics by one
   * tick (1 / hz seconds), so every system sees this tick's bodies and queries. Then runs every
   * system in order with this tick's inputs (after the input filters), flushing events at
   * each phase boundary, then applies queued structural changes and advances the clock. If a system
   * or handler throws, the tick's queued changes are dropped and the world should be restored from a
   * snapshot.
   */
  step(inputs: readonly TInput[] = []): void {
    if (this.stepping) throw new Error('step() cannot be called during a step');
    this.stepping = true;
    try {
      // Difficulty commands apply before the first system, so the whole tick sees the new values.
      const tick = this.simClock.tick;
      const { config, changes } = applyDifficultyCommands(this.config, inputs, tick);
      applyFactCommands(this.factStore, inputs); // all or nothing, before difficulty commits
      this.config = config;
      for (const change of changes) this.events.emit(DifficultyChanged, change);
      this.physicsPort?.step(1 / this.simClock.hz);
      const filters = this.inputFilters;
      const filtered =
        filters.length === 0
          ? inputs
          : inputs
              .filter((input) => filters.every((filter) => filter.keep(input, this)))
              .map((input) =>
                filters.reduce((seen, f) => (f.map ? (f.map(seen, this) as TInput) : seen), input),
              );
      const ctx: TickContext<TInput> = {
        world: this,
        inputs: filtered,
        tick,
        clock: this.simClock,
        difficulty: config,
      };
      this.events.flush();
      for (const system of this.systems) {
        system.run(ctx);
        this.events.flush();
      }
      if (this.commands.length > 0) {
        for (const command of this.commands) this.apply(command);
        this.settle();
      }
      this.simClock.advance();
    } finally {
      this.commands = [];
      this.pendingSpawns.clear();
      this.stepping = false;
    }
  }

  /** Plain-data state for hashing and saves (see WorldSnapshot); detached unless `shared`. */
  snapshot(options: SnapshotOptions = {}): WorldSnapshot {
    this.requireIdle('snapshot');
    const components: Record<string, (readonly [EntityId, unknown])[]> = {};
    for (const [name, store] of [...this.stores].sort(byKey)) {
      store.sort();
      const { type, values } = store;
      const alias = options.shared === true && usesDefaultSerialize(type);
      components[name] = store.ids.map((id, slot) => [
        id,
        alias ? values[slot] : type.serialize(values[slot]),
      ]);
    }
    const rng: Record<string, RngState> = {};
    for (const [name, stream] of [...this.streams].sort(byKey)) {
      rng[name] = stream.serialize();
    }
    const difficulty = difficultyOverrides(this.config);
    return {
      seed: this.seedValue,
      clock: this.simClock.serialize(),
      ...(Object.keys(difficulty).length > 0 && { difficulty }),
      ...(this.factStore.size > 0 && { facts: this.factStore.snapshot() }),
      ...(this.physicsPort !== undefined && { physics: this.physicsPort.snapshot() }),
      nextEntity: this.nextEntity,
      entities: [...this.alive].sort((a, b) => a - b),
      components,
      rng,
    };
  }

  /**
   * Replaces all state with a snapshot. The world must already have the snapshot's component types
   * registered (and its systems added); systems and event handlers are code, not state. A world
   * with physics needs a snapshot with physics state and vice versa; the physics port restores it.
   */
  restore(snapshot: WorldSnapshot): void {
    this.requireIdle('restore');
    const root = Rng.create(snapshot.seed);
    const clock = SimClock.restore(snapshot.clock);
    const config = resolveDifficulty(snapshot.difficulty);
    const { nextEntity, entities } = snapshot;
    if (!Number.isSafeInteger(nextEntity) || nextEntity < 1) {
      throw new RangeError(`invalid snapshot: nextEntity ${String(nextEntity)}`);
    }
    let previous = 0;
    for (const id of entities) {
      if (!Number.isSafeInteger(id) || id <= previous || id >= nextEntity) {
        throw new RangeError(`invalid snapshot: entity ids must ascend within [1, nextEntity)`);
      }
      previous = id;
    }
    const alive = new Set(entities);
    const rows = Object.entries(snapshot.components).map(([name, list]) => {
      const store = this.stores.get(name);
      if (store === undefined) {
        throw new Error(`invalid snapshot: component "${name}" is not registered`);
      }
      if (!list.every(([id]) => alive.has(id))) {
        throw new Error(`invalid snapshot: "${name}" has a row for an entity that is not alive`);
      }
      return { store, list };
    });
    const streams = Object.entries(snapshot.rng).map(
      ([name, state]) => [name, Rng.restore(state)] as const,
    );
    const restoreFacts = this.factStore.prepareRestore(snapshot.facts);
    // Last check and first change: the port only swaps its state once the new one has loaded.
    const { physics } = snapshot;
    if (this.physicsPort === undefined) {
      if (physics !== undefined) {
        throw new Error('invalid snapshot: it has physics state but this world has no physics');
      }
    } else if (physics === undefined) {
      throw new Error('invalid snapshot: this world has physics but the snapshot has none');
    } else {
      this.physicsPort.restore(physics);
    }

    this.seedValue = snapshot.seed;
    this.root = root;
    this.simClock = clock;
    this.config = config;
    restoreFacts();
    this.nextEntity = nextEntity;
    this.alive = alive;
    this.streams.clear();
    for (const [name, rng] of streams) this.streams.set(name, rng);
    for (const store of this.stores.values()) store.clear();
    for (const { store, list } of rows) {
      for (const [id, data] of list) store.put(id, store.type.deserialize(data));
    }
    this.events.clear();
    this.settle();
  }

  private issue(command: Command): void {
    if (this.stepping) {
      this.commands.push(command);
    } else {
      this.apply(command);
      this.settle();
    }
  }

  private apply(command: Command): void {
    switch (command.kind) {
      case 'spawn':
        this.alive.add(command.id);
        return;
      case 'destroy':
        if (this.alive.delete(command.id)) {
          for (const store of this.stores.values()) this.deleteRow(store, command.id);
        }
        return;
      case 'add':
        // Skipped when an earlier command in the same tick destroyed the entity.
        if (this.alive.has(command.id)) command.store.put(command.id, command.value);
        return;
      case 'remove':
        this.deleteRow(command.store, command.id);
        return;
    }
  }

  /** Deletes `id`'s row from `store`, telling the store's remove listeners what it held. */
  private deleteRow(store: ComponentStore<unknown>, id: EntityId): void {
    const listeners = this.removeListeners.get(store);
    if (listeners === undefined || !store.has(id)) {
      store.delete(id);
      return;
    }
    const value = store.get(id);
    store.delete(id);
    for (const listener of listeners) listener(id, value);
  }

  /**
   * Invalidates cached queries after structural changes. Stores are re-sorted lazily, by the next
   * query or snapshot that reads them, so a run of changes between steps (a level's deltas, mw-e27.3)
   * sorts each store once rather than once per change.
   */
  private settle(): void {
    this.structure.version++;
  }

  private storeOf<T>(type: ComponentType<T>): ComponentStore<T> {
    const store = this.stores.get(type.name);
    if (store?.type !== type) {
      throw new Error(`component "${type.name}" is not registered with this world`);
    }
    return store as ComponentStore<T>; // the store was created for this exact type
  }

  private requireKnown(id: EntityId): void {
    if (!this.alive.has(id) && !this.pendingSpawns.has(id)) {
      throw new Error(`entity ${String(id)} does not exist`);
    }
  }

  private requireIdle(what: string): void {
    if (this.stepping) throw new Error(`${what}() cannot be called during a step`);
  }
}
