// Arrows that stay (mw-e05.7): an arrow that comes to rest is a world entity you can walk up to and
// take back. This file is everything that happens to one after it lands; the landing itself, and the
// roll that decides whether it came through whole, are the arrow system's (system.ts).
//
// - Intact arrows are interactable: Interact on one gathers every intact arrow within `gatherRadius`
//   (1.0 m) of it into the quiver, the prompt reading "Take arrows (3)". A trick arrow whose payload is
//   spent (water, fire, noise) comes back as a standard arrow; a rope arrow, which keeps its rope, as a
//   rope arrow. Broken arrows lie there as scenery: no prompt, nothing to take.
// - An arrow stuck in a body follows it (`ArrowRest.local`, the tip's offset from the body's placement:
//   position only, a turning body does not turn the arrow). Its body going away (destroyed) drops the
//   arrow to the ground below.
// - Fire: an intact arrow breaks the moment it, or what it is stuck in, is burning. It reads the
//   `burning` property, which the fire rules set (mw-e03.5); there is no arrow-specific fire script.
//   With `materials`, a resting arrow is itself a small wooden thing that can catch from the heat around
//   it (3 s of fuel), so it joins the fire system as any other wood does.
// - A world holds at most `maxResting` arrows at rest (64). When more land, the oldest go first, those
//   not in view before any in view; see `ArrowViewRule` for what "in view" means to a deterministic sim.
// - A creature's arrows drop with it: `takeStuckArrows` removes every arrow stuck in a creature that
//   died and returns the intact ones as loot stacks (loot/drops.ts), the broken ones vanish with it.
//
// Interact's other targets keep priority: an arrow stuck in something that is itself interactable (a
// chest) yields focus to it (`addFocusDemotion`), so the chest still opens.
//
// Determinism: arrows are visited in ascending entity order and every rule reads sim state only.

import type { CollisionWorld } from '../../character/collision-world';
import type { EntityId } from '../../core/component';
import { defineEvent } from '../../core/events';
import type { System, World } from '../../core/world';
import {
  addAffordanceGate,
  addAffordanceLabel,
  addFocusDemotion,
  addFocusFilter,
  addInteractable,
  affordancesOf,
  InteractableComponent,
  interacted,
} from '../../interaction/system';
import { readProperty, WorldProperties } from '../../properties/components';
import { addMaterialProperties, type MaterialPresets } from '../../properties/materials';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { addArrows, QuiverComponent } from '../bow/components';
import { HealthComponent } from '../damage/components';
import { DEFAULT_ARROW_RULES, type ArrowRules } from './ballistics';
import { ArrowRested } from './events';
import { ArrowRestComponent, type ArrowRest } from './components';
import type { ArrowLookup } from './system';

/**
 * Whether a point counts as in view of the player, for the despawn order. The sim cannot read a
 * camera (replays have none), so a rule reads sim state only: `playerViewRule` (view.ts) uses the
 * player's position and look direction. A rule is not state and must only read the world.
 */
export type ArrowViewRule = (world: World<never>, position: Vec3) => boolean;

/** Nothing is in view: every resting arrow is equally eligible, oldest first. */
export const nothingInView: ArrowViewRule = () => false;

/** What the retrieval rules need. */
export interface ArrowRetrievalOptions {
  /** The arrow table (a spent trick arrow's payload decides what it comes back as). */
  readonly arrows: ArrowLookup;
  /** Overrides of DEFAULT_ARROW_RULES (maxResting, gatherRadius). */
  readonly rules?: Partial<ArrowRules>;
  /** What counts as in view for the despawn order; default: nothing (`nothingInView`). */
  readonly inView?: ArrowViewRule;
  /** The level, so an arrow whose body is gone can fall to the ground; without it, it stays put. */
  readonly collision?: CollisionWorld;
  /**
   * Material presets: with them, a resting arrow carries the `wood` preset (and `ARROW_FUEL_SECONDS`
   * of fuel), so heat can ignite it like any wooden thing.
   */
  readonly materials?: MaterialPresets;
}

/** Seconds of fuel a resting arrow has when it catches fire. */
export const ARROW_FUEL_SECONDS = 3;
/** The material a resting arrow is made of. */
export const ARROW_MATERIAL = 'wood';
/** The size of a resting arrow's bounding sphere, metres (Interact reaches it at the usual range). */
export const ARROW_RADIUS = 0.1;
/** The arrow a spent trick arrow comes back as. */
export const SPENT_ARROW = 'standard';
/** The highest a fallen arrow is searched for ground below, metres. */
const FALL_LIMIT = 40;

/** What taking arrows back did. */
export interface ArrowsTaken {
  readonly tick: number;
  readonly actor: EntityId;
  /** The arrow the actor interacted with. */
  readonly target: EntityId;
  /** Arrows into the quiver, by type (the type they came back as), in type order. */
  readonly taken: Readonly<Record<string, number>>;
  /** How many arrows that is. */
  readonly count: number;
}

export const arrowsTaken = defineEvent<ArrowsTaken>('arrowsTaken');

/** Why an intact arrow broke after it rested. */
export type ArrowBreakCause = 'fire';

/** An arrow at rest broke (mw-e05.7): it is still there, but cannot be taken back. */
export interface ArrowBroken {
  readonly tick: number;
  readonly entity: EntityId;
  readonly arrow: string;
  readonly cause: ArrowBreakCause;
}

export const arrowBroken = defineEvent<ArrowBroken>('arrowBroken');

/** An arrow at rest was removed to keep the world to `maxResting` (the oldest not in view first). */
export interface ArrowDespawned {
  readonly tick: number;
  readonly entity: EntityId;
  readonly arrow: string;
}

export const arrowDespawned = defineEvent<ArrowDespawned>('arrowDespawned');

/** Intact arrows of one type taken from a body. */
export interface ArrowStack {
  readonly arrow: string;
  readonly count: number;
}

/** An arrow at rest as it persists with its level (mw-e27.3 spawner kind `arrow`). */
export interface PersistedArrow {
  readonly arrow: string;
  readonly state: 'stuck' | 'dropped';
  readonly intact: boolean;
  readonly position: Vec3;
  readonly direction: Vec3;
  /** Ticks since it came to rest, so the despawn order survives. */
  readonly age: number;
}

/** What `installArrowRetrieval` gives back. */
export interface ArrowRetrieval {
  /** Re-creates a persisted arrow at rest; undefined when its type left the content. */
  restore(world: World<never>, data: PersistedArrow): EntityId | undefined;
}

const retrievals = new WeakMap<World<never>, ArrowRetrieval>();

/** The retrieval installed in `world`, or undefined. */
export function arrowRetrievalOf(world: World<never>): ArrowRetrieval | undefined {
  return retrievals.get(world);
}

/** The arrow `rest` comes back as: a spent trick arrow (it has a payload, none of it a rope) is plain. */
export function returnsAs(options: Pick<ArrowRetrievalOptions, 'arrows'>, arrow: string): string {
  const def = options.arrows.get(arrow);
  if (def === undefined || def.payload.length === 0) return arrow;
  return def.payload.some((op) => op.op === 'spawn') ? arrow : SPENT_ARROW;
}

/** Orders [arrow type, n] pairs by type, in UTF-16 code unit order (the same everywhere; types are unique). */
const byType = (a: readonly [string, number], b: readonly [string, number]): number =>
  Number(a[0] > b[0]) - Number(a[0] < b[0]);

const frozen = (v: Vec3): Vec3 => Object.freeze({ x: v.x, y: v.y, z: v.z });
const distanceSq = (a: Vec3, b: Vec3): number =>
  (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) + (a.z - b.z) * (a.z - b.z);

/** Every arrow at rest in `world`, ascending entity order. */
export function restingArrows(world: World<never>): { entity: EntityId; rest: ArrowRest }[] {
  const found: { entity: EntityId; rest: ArrowRest }[] = [];
  if (!world.isRegistered(ArrowRestComponent)) return found;
  world.query(ArrowRestComponent).forEach((entity, rest) => found.push({ entity, rest }));
  return found;
}

/**
 * Whether `rest` is stuck in something alive (it has health above 0: a creature, the player). Such an
 * arrow is part of the fight, not something lying about: it cannot be focused or taken, and a
 * creature's arrows come back through its loot when it dies (loot/drops.ts).
 */
function inLivingBody(world: World<never>, rest: ArrowRest): boolean {
  if (rest.in === null || !world.isRegistered(HealthComponent)) return false;
  const health = world.get(rest.in, HealthComponent);
  return health !== undefined && health.current > 0;
}

/**
 * The intact arrows `actor` gathers by interacting with `target`: those at rest within `radius` of
 * it, `target` itself included, ascending entity order. Empty when `target` is not an intact arrow.
 */
function gathered(
  world: World<never>,
  target: EntityId,
  radius: number,
): { entity: EntityId; rest: ArrowRest }[] {
  const at = world.get(target, ArrowRestComponent);
  if (!at?.intact || inLivingBody(world, at)) return [];
  return restingArrows(world).filter(
    ({ rest }) =>
      rest.intact &&
      !inLivingBody(world, rest) &&
      distanceSq(rest.position, at.position) <= radius * radius,
  );
}

/** The entities `gathered` finds (see there). */
export function gatherable(
  world: World<never>,
  target: EntityId,
  radius: number = DEFAULT_ARROW_RULES.gatherRadius,
): EntityId[] {
  return gathered(world, target, radius).map(({ entity }) => entity);
}

/**
 * Removes every arrow stuck in `host` and returns the intact ones as stacks, in arrow-id order, each
 * as the arrow `comesBack` says it returns as (default: its own type).
 */
export function takeStuckArrows(
  world: World<never>,
  host: EntityId,
  comesBack: (arrow: string) => string = (arrow) => arrow,
): ArrowStack[] {
  const counts = new Map<string, number>();
  for (const { entity, rest } of restingArrows(world)) {
    if (rest.in !== host) continue;
    if (rest.intact) {
      const type = comesBack(rest.arrow);
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    world.destroy(entity);
  }
  return [...counts].sort(byType).map(([arrow, count]) => ({ arrow, count }));
}

/**
 * Installs the retrieval rules in `world` (see the file header): the system that keeps resting arrows
 * (follow, burn, cap) and the Interact rules. Call it after `installArrows` and, for the prompt, after the
 * interaction components are registered; once per world, between steps.
 */
export function installArrowRetrieval<TInput>(
  world: World<TInput>,
  options: ArrowRetrievalOptions,
): ArrowRetrieval {
  const w: World<never> = world;
  const rules: ArrowRules = { ...DEFAULT_ARROW_RULES, ...options.rules };
  const inView = options.inView ?? nothingInView;

  /** Makes a resting arrow a thing in the world: placed, wooden, and takeable while it is whole. */
  function settle(entity: EntityId, rest: Pick<ArrowRest, 'intact' | 'position'>): void {
    if (!w.isRegistered(PlacementComponent)) return;
    if (options.materials !== undefined && w.isRegistered(WorldProperties.material)) {
      addMaterialProperties(w, entity, options.materials, {
        material: ARROW_MATERIAL,
        fuel: ARROW_FUEL_SECONDS,
      });
    }
    if (rest.intact && w.isRegistered(InteractableComponent)) {
      addInteractable(
        w,
        entity,
        {
          affordances: [{ verb: 'pick-up', label: 'Take arrow' }],
          anchor: [0, 0, 0],
          radius: ARROW_RADIUS,
        },
        rest.position,
      );
    } else {
      placeEntity(w, entity, rest.position, ARROW_RADIUS);
    }
  }

  /** `target`'s arrow-at-rest state, or undefined (not an arrow, or a world with no arrows). */
  const arrowAt = (target: EntityId): ArrowRest | undefined =>
    w.isRegistered(ArrowRestComponent) ? w.get(target, ArrowRestComponent) : undefined;
  const isTakeable = (target: EntityId): boolean => {
    const rest = arrowAt(target);
    return rest?.intact === true && !inLivingBody(w, rest);
  };
  // An arrow stuck in a living body is never a focus target, however close it is.
  addFocusFilter(world, (_w, _actor, target) => {
    const rest = arrowAt(target);
    return rest !== undefined && inLivingBody(w, rest);
  });

  // Interact on an arrow needs somewhere to put it.
  addAffordanceGate(world, (_w, actor, target, affordance) => {
    if (affordance.verb !== 'pick-up' || !isTakeable(target)) return undefined;
    return w.has(actor, QuiverComponent) ? undefined : 'No quiver';
  });
  addAffordanceLabel(world, (_w, _actor, target, affordance) => {
    if (affordance.verb !== 'pick-up' || !isTakeable(target)) return undefined;
    const count = gatherable(w, target, rules.gatherRadius).length;
    return count > 1 ? `Take arrows (${String(count)})` : 'Take arrow';
  });
  // An arrow in a chest or a door must not take the chest's or the door's Interact.
  addFocusDemotion(world, (_w, _actor, target) => {
    const host = arrowAt(target)?.in;
    return (
      host !== undefined && host !== null && w.isAlive(host) && affordancesOf(w, host).length > 0
    );
  });
  // Settled from the event's own numbers: the arrow's component is added at the end of the tick.
  w.events.on(ArrowRested, ({ entity, intact, position }) => {
    settle(entity, { intact, position });
  });
  w.events.on(interacted, ({ actor, target, verb }) => {
    if (verb !== 'pick-up' || !isTakeable(target) || !w.has(actor, QuiverComponent)) return;
    const taken = new Map<string, number>();
    const found = gathered(w, target, rules.gatherRadius);
    for (const { entity, rest } of found) {
      const type = returnsAs(options, rest.arrow);
      taken.set(type, (taken.get(type) ?? 0) + 1);
      w.destroy(entity);
    }
    const ordered = [...taken].sort(byType);
    for (const [type, count] of ordered) addArrows(w, actor, type, count);
    w.events.emit(arrowsTaken, {
      tick: w.tick,
      actor,
      target,
      taken: Object.fromEntries(ordered),
      count: found.length,
    });
  });

  // A world without properties has nothing that burns.
  const burning = (entity: EntityId): boolean =>
    w.isRegistered(WorldProperties.burning) && readProperty(w, entity, 'burning');

  /** The ground below `from`, or `from` when there is none (or no level). */
  function groundBelow(from: Vec3): Vec3 {
    const hit = options.collision?.raycast(from, { x: 0, y: -1, z: 0 }, FALL_LIMIT);
    return hit === undefined ? from : hit.point;
  }

  function breakArrow(entity: EntityId, rest: ArrowRest): void {
    w.set(entity, ArrowRestComponent, Object.freeze({ ...rest, intact: false }));
    if (w.isRegistered(InteractableComponent) && w.has(entity, InteractableComponent)) {
      w.remove(entity, InteractableComponent);
    }
    w.events.emit(arrowBroken, { tick: w.tick, entity, arrow: rest.arrow, cause: 'fire' });
  }

  /** One arrow's tick: follows its body (or falls when it is gone), then breaks if it burns. */
  function keep(entity: EntityId, rest: ArrowRest): void {
    let current = rest;
    const host = rest.in;
    if (host !== null) {
      if (!w.isAlive(host)) {
        current = Object.freeze({
          arrow: rest.arrow,
          shooter: rest.shooter,
          direction: rest.direction,
          tick: rest.tick,
          intact: rest.intact,
          state: 'dropped' as const,
          in: null,
          position: frozen(groundBelow(rest.position)),
        });
      } else if (rest.local !== undefined && w.isRegistered(PlacementComponent)) {
        const at = w.get(host, PlacementComponent);
        if (at !== undefined) {
          const { local } = rest;
          const position = { x: at.x + local.x, y: at.y + local.y, z: at.z + local.z };
          if (distanceSq(position, rest.position) > 0) {
            current = Object.freeze({ ...rest, position: frozen(position) });
          }
        }
      }
      if (current !== rest) {
        w.set(entity, ArrowRestComponent, current);
        if (w.isRegistered(PlacementComponent) && w.has(entity, PlacementComponent))
          placeEntity(w, entity, current.position, ARROW_RADIUS);
      }
    }
    if (current.intact && ((current.in !== null && burning(current.in)) || burning(entity))) {
      breakArrow(entity, current);
    }
  }

  /** Despawns the oldest arrows over the cap: out of view first (see the file header). */
  function trim(arrows: readonly { entity: EntityId; rest: ArrowRest }[]): void {
    const excess = arrows.length - rules.maxResting;
    if (excess <= 0) return;
    const oldestFirst = [...arrows].sort(
      (a, b) => a.rest.tick - b.rest.tick || a.entity - b.entity,
    );
    const unseen: typeof oldestFirst = [];
    const seen: typeof oldestFirst = [];
    for (const arrow of oldestFirst) (inView(w, arrow.rest.position) ? seen : unseen).push(arrow);
    for (const { entity, rest } of [...unseen, ...seen].slice(0, excess)) {
      w.events.emit(arrowDespawned, { tick: w.tick, entity, arrow: rest.arrow });
      w.destroy(entity);
    }
  }

  const system: System<TInput> = {
    name: 'arrow-rest',
    run: () => {
      if (!w.isRegistered(ArrowRestComponent)) return;
      const arrows = restingArrows(w);
      if (arrows.length === 0) return;
      for (const { entity, rest } of arrows) keep(entity, rest);
      trim(arrows);
    },
  };
  world.addSystem(system);

  const retrieval: ArrowRetrieval = {
    restore(target, data) {
      if (!options.arrows.has(data.arrow)) return undefined;
      const entity = target.spawn();
      const rest: ArrowRest = Object.freeze({
        arrow: data.arrow,
        shooter: null,
        state: data.state,
        position: frozen(data.position),
        direction: frozen(data.direction),
        in: null,
        tick: Math.max(0, target.tick - data.age),
        intact: data.intact,
      });
      target.add(entity, ArrowRestComponent, rest);
      settle(entity, rest);
      return entity;
    },
  };
  retrievals.set(w, retrieval);
  return retrieval;
}
