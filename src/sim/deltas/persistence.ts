// Level deltas (mw-e27.3): smashed walls, burnt crates, moved boxes, looted chests and dead creatures
// stay that way, without saving the whole world. Each level has an authored baseline: the state its
// data spawns. What persists is only how its persistent entities differ from that baseline.
//
// - Stable ids. Every authored entity of a level has an id that does not depend on load order or
//   entity numbering (`sceneAuthoredEntities`): `spawn:<spawn id>` for a scene spawn,
//   `piece:<placement index>` for a placed kit piece and `creature:<spawn id>` for the creature a
//   spawn point brought. Every authored entity is persistent. An entity spawned at runtime persists
//   only when marked (`markPersistent`, e.g. a dropped item: `persistDroppedItems`), under a
//   generated id `spawned:<entity id it was first spawned as>`; entity ids are never reused, and a
//   re-created entity keeps its first id, so generated ids never collide.
// - Baseline. `WorldPersistence.baseline` reads every authored entity's state through the
//   declarations (declarations.ts) right after the level is spawned, before any delta.
// - Capture (on level unload or save): a baseline entity that is gone is `destroyed`; otherwise each
//   declaration's diff against the baseline that is worth keeping is one of its `aspects`. Marked
//   runtime entities of the level are captured whole by their kind's spawner.
// - Apply (on level load: after the baseline spawn, before the first tick, between steps): destroys,
//   then aspects in declaration order, then spawned entities. A delta naming an id the baseline no
//   longer has (the level was edited), an aspect no declaration knows, an aspect that no longer
//   applies, a spawned kind without a spawner, or data a declaration rejects is skipped with a
//   warning, and loading continues (AC-4).
//
// Everything is plain data in a fixed order (baseline order, then ascending entity order), so equal
// worlds give equal deltas, and saves (mw-e27.4) can carry them.

import { ArrowRestComponent } from '../combat/arrows/components';
import { ArrowRested } from '../combat/arrows/events';
import { arrowRetrievalOf, type PersistedArrow } from '../combat/arrows/retrieval';
import { defineComponent, type EntityId } from '../core/component';
import type { World } from '../core/world';
import { CreatureComponent } from '../creatures/components';
import { itemDropped, WorldItemComponent, type WorldItems } from '../items/world-items';
import { PhysicsObjectComponent } from '../physics/objects';
import type { Quat } from '../scene/layout';
import type { LoadedScene } from '../scene/loader';
import type { Vec3 } from '../stimulus/shapes';
import { DEFAULT_PERSISTENCE, type PersistenceDeclaration } from './declarations';

/** A runtime entity that persists with its level (`persistence.spawned`; never renamed). */
export interface PersistentSpawn {
  /** Its generated id (`spawned:<n>`), kept when it is re-created. */
  readonly id: string;
  /** Which spawner captures and re-creates it. */
  readonly kind: string;
  /** The level it belongs to. */
  readonly level: string;
}

export const PersistentSpawnComponent = defineComponent<PersistentSpawn>('persistence.spawned');

/** Registers the persistence component on `world` (once per world, between steps). */
export function registerPersistence<W extends World<never>>(world: W): W {
  world.register(PersistentSpawnComponent);
  return world;
}

/** The generated id of an entity first spawned as `entity`. */
export const spawnedId = (entity: EntityId): string => `spawned:${String(entity)}`;

/**
 * Marks runtime entity `entity` persistent in `level`, captured and re-created by the `kind` spawner.
 * Works during a step on an entity spawned that tick. Returns its generated id.
 */
export function markPersistent(
  world: World<never>,
  entity: EntityId,
  kind: string,
  level: string,
): string {
  const id = spawnedId(entity);
  world.add(entity, PersistentSpawnComponent, Object.freeze({ id, kind, level }));
  return id;
}

/** How one aspect of an entity differs from its baseline. */
export interface EntityDelta {
  /** The entity's stable id. */
  readonly id: string;
  /** It is gone: broken, burnt away, picked up or removed. */
  readonly destroyed?: true;
  /** Declaration key → recorded delta (absent when destroyed). */
  readonly aspects?: Readonly<Record<string, unknown>>;
}

/** A persistent runtime entity, whole. */
export interface SpawnedRecord {
  readonly id: string;
  readonly kind: string;
  readonly data: unknown;
}

/** Everything that persists of one level. */
export interface LevelDeltas {
  readonly level: string;
  /** Changed authored entities, in baseline order. */
  readonly entities: readonly EntityDelta[];
  /** Persistent runtime entities, in ascending entity order. */
  readonly spawned: readonly SpawnedRecord[];
}

/** Captures and re-creates one kind of persistent runtime entity. */
export interface PersistentSpawner<D = unknown> {
  readonly kind: string;
  /** The entity as plain data, or undefined when it can no longer be captured. */
  capture(world: World<never>, entity: EntityId): D | undefined;
  /** Spawns it again (between steps); undefined when it cannot (e.g. its item left the content). */
  spawn(world: World<never>, data: D): EntityId | undefined;
}

/** Why part of a delta was skipped. */
export type DeltaSkipReason =
  /** The baseline has no entity with that id (or it is gone). */
  | 'unknown-entity'
  /** No declaration has that aspect key. */
  | 'unknown-aspect'
  /** The declaration found nothing on the entity to apply it to. */
  | 'not-applicable'
  /** No spawner for that kind. */
  | 'unknown-kind'
  /** The spawner could not re-create it. */
  | 'spawn-failed'
  /** The declaration rejected the data. */
  | 'invalid';

/** One skipped part of a delta. */
export interface DeltaSkip {
  readonly id: string;
  readonly reason: DeltaSkipReason;
  /** The aspect key or spawned kind involved. */
  readonly part?: string;
  readonly message: string;
}

/** What `WorldPersistence.apply` did. */
export interface DeltaApplyReport {
  /** Entities destroyed, aspects applied and entities re-created. */
  readonly applied: number;
  readonly skipped: readonly DeltaSkip[];
  /** Re-created runtime entities: generated id → new entity. */
  readonly spawned: ReadonlyMap<string, EntityId>;
}

/** A level's authored entities and their state as spawned. */
export interface LevelBaseline {
  readonly level: string;
  /** Stable id → entity, in authored order. */
  readonly entities: ReadonlyMap<string, EntityId>;
  /** Stable id → declaration key → captured state (absent: not covered). */
  readonly states: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
}

export interface WorldPersistenceOptions {
  /** What persists, in apply order; defaults to DEFAULT_PERSISTENCE. */
  readonly declarations?: readonly PersistenceDeclaration[];
  /** Spawners of persistent runtime entities, by kind. */
  readonly spawners?: readonly PersistentSpawner[];
  /** Told about every skipped part of a delta. */
  readonly warn?: (message: string) => void;
}

/** A spawn point's creature, scene spawns and pieces under their stable ids, in that order. */
export function sceneAuthoredEntities(
  world: World<never>,
  loaded: LoadedScene,
): [string, EntityId][] {
  const authored: [string, EntityId][] = [];
  loaded.pieces.forEach((entity, placement) => {
    authored.push([`piece:${String(placement)}`, entity]);
  });
  for (const { entity, spawn } of loaded.spawns) authored.push([`spawn:${spawn.id}`, entity]);
  if (world.isRegistered(CreatureComponent)) {
    const points = new Set(loaded.spawns.map(({ spawn }) => spawn.id));
    world.query(CreatureComponent).forEach((entity, { origin }) => {
      if (origin.point !== undefined && points.has(origin.point)) {
        authored.push([`creature:${origin.point}`, entity]);
      }
    });
  }
  return authored;
}

/** Captures and applies level deltas under one set of declarations and spawners (file header). */
export class WorldPersistence {
  readonly declarations: readonly PersistenceDeclaration[];
  readonly #byKey: ReadonlyMap<string, PersistenceDeclaration>;
  readonly #spawners: ReadonlyMap<string, PersistentSpawner>;
  readonly #warn: (message: string) => void;

  /** @throws RangeError when two declarations share a key or two spawners a kind. */
  constructor(options: WorldPersistenceOptions = {}) {
    this.declarations = options.declarations ?? DEFAULT_PERSISTENCE;
    this.#byKey = new Map(this.declarations.map((d) => [d.key, d]));
    if (this.#byKey.size !== this.declarations.length) {
      throw new RangeError('two persistence declarations share a key');
    }
    const spawners = options.spawners ?? [];
    this.#spawners = new Map(spawners.map((s) => [s.kind, s]));
    if (this.#spawners.size !== spawners.length) {
      throw new RangeError('two persistent spawners share a kind');
    }
    this.#warn = options.warn ?? (() => undefined);
  }

  /**
   * The baseline of `level`: its authored entities (`[stable id, entity]`, e.g. from
   * `sceneAuthoredEntities`) and their state now. Take it right after spawning the level, before
   * applying any delta.
   * @throws RangeError when two authored entities share an id.
   */
  baseline(
    world: World<never>,
    level: string,
    authored: Iterable<readonly [string, EntityId]>,
  ): LevelBaseline {
    const entities = new Map<string, EntityId>();
    const states = new Map<string, Readonly<Record<string, unknown>>>();
    for (const [id, entity] of authored) {
      if (entities.has(id))
        throw new RangeError(`level "${level}" has two entities with id "${id}"`);
      entities.set(id, entity);
      const state: Record<string, unknown> = {};
      for (const declaration of this.declarations) {
        const value = declaration.capture(world, entity);
        if (value !== undefined) state[declaration.key] = value;
      }
      states.set(id, state);
    }
    return Object.freeze({ level, entities, states });
  }

  /** How `world`'s level differs from `baseline` now (call between steps). */
  capture(world: World<never>, baseline: LevelBaseline): LevelDeltas {
    const entities: EntityDelta[] = [];
    for (const [id, entity] of baseline.entities) {
      if (!world.isAlive(entity)) {
        entities.push({ id, destroyed: true });
        continue;
      }
      const before = baseline.states.get(id) ?? {};
      const aspects: Record<string, unknown> = {};
      for (const declaration of this.declarations) {
        const delta = declaration.diff(before[declaration.key], declaration.capture(world, entity));
        if (delta !== undefined) aspects[declaration.key] = delta;
      }
      if (Object.keys(aspects).length > 0) entities.push({ id, aspects });
    }
    const spawned: SpawnedRecord[] = [];
    if (world.isRegistered(PersistentSpawnComponent)) {
      world.query(PersistentSpawnComponent).forEach((entity, { id, kind, level }) => {
        if (level !== baseline.level) return;
        const data = this.#spawners.get(kind)?.capture(world, entity);
        if (data !== undefined) spawned.push({ id, kind, data });
      });
    }
    return { level: baseline.level, entities, spawned };
  }

  /**
   * Applies `deltas` to the freshly spawned level of `baseline` (between steps, before its first
   * tick). Skips what no longer fits, with a warning each (see the file header).
   */
  apply(world: World<never>, baseline: LevelBaseline, deltas: LevelDeltas): DeltaApplyReport {
    const skipped: DeltaSkip[] = [];
    const skip = (id: string, reason: DeltaSkipReason, message: string, part?: string): void => {
      skipped.push({ id, reason, message, ...(part !== undefined && { part }) });
      this.#warn(message);
    };
    const where = `level "${baseline.level}"`;
    let applied = 0;
    for (const delta of deltas.entities) {
      const { id } = delta;
      const entity = baseline.entities.get(id);
      if (entity === undefined || !world.isAlive(entity)) {
        skip(id, 'unknown-entity', `${where} has no entity "${id}"; its changes are dropped`);
        continue;
      }
      if (delta.destroyed === true) {
        world.destroy(entity);
        applied++;
        continue;
      }
      const aspects = delta.aspects ?? {};
      for (const key of Object.keys(aspects)) {
        if (!this.#byKey.has(key)) {
          skip(
            id,
            'unknown-aspect',
            `${where} entity "${id}": unknown aspect "${key}" dropped`,
            key,
          );
        }
      }
      for (const declaration of this.declarations) {
        const { key } = declaration;
        if (!Object.hasOwn(aspects, key)) continue;
        try {
          if (declaration.apply(world, entity, aspects[key])) applied++;
          else
            skip(id, 'not-applicable', `${where} entity "${id}": "${key}" no longer applies`, key);
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          skip(id, 'invalid', `${where} entity "${id}": "${key}" rejected: ${error.message}`, key);
        }
      }
    }
    const spawned = new Map<string, EntityId>();
    for (const { id, kind, data } of deltas.spawned) {
      const spawner = this.#spawners.get(kind);
      if (spawner === undefined) {
        skip(id, 'unknown-kind', `${where}: no spawner for "${kind}"; "${id}" dropped`, kind);
        continue;
      }
      const entity = spawner.spawn(world, data);
      if (entity === undefined) {
        skip(id, 'spawn-failed', `${where}: "${id}" (${kind}) could not be re-created`, kind);
        continue;
      }
      world.add(
        entity,
        PersistentSpawnComponent,
        Object.freeze({ id, kind, level: baseline.level }),
      );
      spawned.set(id, entity);
      applied++;
    }
    return { applied, skipped, spawned };
  }
}

/** A dropped world item as it persists. */
export interface PersistedWorldItem {
  readonly defId: string;
  readonly count: number;
  readonly flags: {
    readonly stolen?: boolean;
    readonly ownerId?: string;
    readonly bound?: boolean;
  };
  readonly position: Vec3;
  readonly rotation: Quat;
}

/** The spawner of persistent world items (kind `item`): item, units, flags and pose. */
export function worldItemSpawner(items: WorldItems): PersistentSpawner<PersistedWorldItem> {
  return Object.freeze({
    kind: 'item',
    capture: (world: World<never>, entity: EntityId) => {
      const item = world.get(entity, WorldItemComponent);
      const object = world.get(entity, PhysicsObjectComponent);
      if (item === undefined || object === undefined) return undefined;
      return {
        defId: item.defId,
        count: item.count,
        flags: { ...item.flags },
        position: { ...object.position },
        rotation: { ...object.rotation },
      };
    },
    spawn: (world: World<never>, data: PersistedWorldItem) =>
      items.has(data.defId) ? items.spawn(world, data) : undefined,
  });
}

/**
 * Marks every item dropped or thrown from now on persistent (kind `item`) in the level `level()`
 * names (none: not persisted). Returns a function that stops it.
 */
export function persistDroppedItems(
  world: World<never>,
  level: () => string | undefined,
): () => void {
  return world.events.on(itemDropped, ({ entity }) => {
    const id = level();
    if (id !== undefined) markPersistent(world, entity, 'item', id);
  });
}

/**
 * The spawner of arrows at rest in a level (kind `arrow`, mw-e05.7): type, whether it is whole, where
 * it is and which way it points, and its age so the despawn order survives. The shooter is not kept
 * (entity ids are not stable across saves). Re-creating needs the arrow retrieval rules installed.
 */
export function arrowSpawner(): PersistentSpawner<PersistedArrow> {
  return Object.freeze({
    kind: 'arrow',
    capture: (world: World<never>, entity: EntityId) => {
      const rest = world.isRegistered(ArrowRestComponent)
        ? world.get(entity, ArrowRestComponent)
        : undefined;
      if (rest === undefined) return undefined;
      return {
        arrow: rest.arrow,
        state: rest.state,
        intact: rest.intact,
        position: { ...rest.position },
        direction: { ...rest.direction },
        age: world.tick - rest.tick,
      };
    },
    spawn: (world: World<never>, data: PersistedArrow) =>
      arrowRetrievalOf(world)?.restore(world, data),
  });
}

/**
 * Marks every arrow that comes to rest in level geometry from now on persistent (kind `arrow`) in
 * the level `level()` names (none: not persisted). An arrow in a creature or a physics object is not:
 * its body is not a stable entity (a creature's arrows drop into its loot when it dies). The world
 * holds at most 64 resting arrows, so a level's delta carries at most 64 small records. Returns a
 * function that stops it.
 */
export function persistRestingArrows(
  world: World<never>,
  level: () => string | undefined,
): () => void {
  return world.events.on(ArrowRested, ({ entity, in: host }) => {
    const id = level();
    if (id !== undefined && host === null) markPersistent(world, entity, 'arrow', id);
  });
}
