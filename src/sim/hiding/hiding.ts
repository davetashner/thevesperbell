// Hiding (mw-e03.23): a thief slips into a wardrobe, a barrel or a haystack to break line of sight.
// A hiding spot is an entity with a `hiding.spot` component (capacity, concealment 0..1, exit points,
// the noise of getting in and out, whether the occupant may peek) and, on whoever is inside, a
// `hiding.hidden` component naming it. Nothing here names an object type: a haystack and a wardrobe
// differ in their data, and what happens to them follows the world's properties.
//
// - Enter: the Hide affordance (a `hideable` thing declares it). The actor is flagged hidden with the
//   spot's concealment, moved to its inside point and stopped, and makes the spot's enter noise. A
//   spot at capacity refuses, so does a burning one and an actor whose hands are full. Perception
//   (src/sim/perception) takes a hidden actor out of every sight query by its concealment: 1 removes
//   it, less only dims it. Hearing is untouched. `isOccupied(entity)` is the question the AI's search
//   asks (mw-e11.11); what it does with the answer is its own.
// - Inside: the occupant's input is cut to look and Interact (an input filter): it cannot move, attack,
//   cast, drop or use anything, and its look is held to the opening's arc. Its camera sits at the
//   spot's eye point (`peekOf`), the glue's peek hook.
// - Leave: the Leave affordance. The occupant steps to the first free exit point in order (an exit is
//   free when the player's capsule fits there); with none free the leave is refused with the reason
//   "Blocked" and the occupant stays, so a way out is never forced through a wall.
// - Ejection: when the spot ignites (`fireIgnited`), breaks (`breakableBroken`), goes under a liquid
//   (`liquidEntered`), topples, or the occupant dies or the spot vanishes, whoever is inside is put at
//   the exit point nearest to them that is free, that same tick (every exit blocked: the nearest
//   anyway, so nobody is left inside a thing that is gone). Ejected by fire, they take a heat stimulus.
// - A spot a physics object carries (a barrel) takes its occupant with it when it is knocked about,
//   and tipping past `toppleUp` throws the occupant out.
//
// Saves: a save never stores a hide (`settleHidden`, as `settleHeldObjects`): whoever is inside is put
// at an exit first, so a load never finds the player inside a prop that was rebuilt empty.
//
// Out of scope: the AI searching a spot (mw-e11); loot tables.

import { SKIN } from '../character/controller';
import { CharacterController } from '../character/system';
import type { Capsule, CollisionWorld } from '../character/collision-world';
import { Died } from '../combat/damage/events';
import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { fireIgnited } from '../elements/fire';
import { actionButton, actionFrame, actionVector, isActionFrame } from '../input/action-frame';
import type { ActionFrame, ButtonAction } from '../input/action-frame';
import {
  addAffordanceGate,
  addFocusFilter,
  addInteractable,
  InteractableComponent,
  interacted,
} from '../interaction/system';
import type { AffordanceGate } from '../interaction/system';
import type { AffordanceSpec } from '../interaction/affordance';
import type { SceneHiding, SceneSpawnPlacement } from '../scene/layout';
import { liquidEntered } from '../liquids/volumes';
import { breakableBroken } from '../breakables/events';
import { emitNoise } from '../noise/system';
import { PhysicsObjectComponent } from '../physics/objects';
import { PlayerLook } from '../player/player';
import { WorldProperties, readProperty } from '../properties/components';
import {
  placementOf,
  placeEntity,
  PlacementComponent,
  type Placement,
} from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { applyStimulus } from '../stimulus/stimulus';
import { holdOf } from '../carry/state';
import {
  HIDE_ENTER_NOISE,
  HIDE_EXIT_NOISE,
  HiddenComponent,
  HidingSpotComponent,
  HIDING_REASONS,
  hiddenOf,
  hidingEjected,
  hidingEntered,
  hidingLeft,
  hidingRefused,
  insidePoint,
  occupantsOf,
  spotOf,
  spotPoint,
  type EjectCause,
  type HidingRefusal,
  type HidingSpot,
} from './state';

/** The prompt of a spot: Leave while inside, Hide otherwise. */
export const LEAVE_AFFORDANCE: AffordanceSpec = Object.freeze({ verb: 'leave', label: 'Leave' });
export const HIDE_AFFORDANCE: AffordanceSpec = Object.freeze({ verb: 'hide', label: 'Hide' });

/** Where a spot's prompt sits above its origin, metres, and its focus radius. */
export const SPOT_ANCHOR: readonly [number, number, number] = Object.freeze([0, 0.9, 0]);
export const SPOT_RADIUS = 0.7;

/** The default player capsule an exit point must fit (the knight's), metres. */
export const DEFAULT_EXIT_CAPSULE: Capsule = Object.freeze({ radius: 0.35, height: 1.8 });

/** The default heat an occupant takes when thrown out of a burning spot, °C (the carry rules' own). */
export const DEFAULT_EJECT_HEAT = 60;

/** How far the occupant may turn its look from the opening, radians, and tilt it up or down. */
export const PEEK_YAW_ARC = 1.2;
export const PEEK_PITCH_ARC = 0.6;

/** A spot tipped past this (the up vector's y) throws its occupant out. */
export const TOPPLE_UP = 0.7;

/** What an occupant may still do: look, Interact, and open the inventory or pause. */
const KEPT_BUTTONS: ReadonlySet<ButtonAction> = new Set(['interact', 'inventory', 'pause']);
const UP = actionButton(false, false, false);

/** How hiding is set up. */
export interface HidingOptions {
  /** Where exit points are tested; without it no exit is ever blocked. */
  readonly collision?: CollisionWorld;
  /** The capsule that must fit at an exit point; DEFAULT_EXIT_CAPSULE. */
  readonly capsule?: Capsule;
  /** Heat taken on ejection from a burning spot, °C; DEFAULT_EJECT_HEAT. */
  readonly ejectHeat?: number;
}

/** How a spot is placed. */
export interface HidingSpotSpec {
  /** Where it stands (its feet), metres. */
  readonly origin: Vec3;
  /** Which way its opening faces; 0 (−z). */
  readonly yaw?: number;
  /** Defaults to 1. */
  readonly capacity?: number;
  /** 0..1; defaults to 1. */
  readonly concealment?: number;
  /** Defaults to true. */
  readonly peek?: boolean;
  /** Dropped in dB at 1 m; defaults to 30 for entering, 24 for leaving. */
  readonly enterDb?: number;
  readonly exitDb?: number;
  /** Frame offsets (see `HidingSpot`); defaults to the centre, an eye at 1.5 m and one exit 0.9 m out. */
  readonly inside?: Vec3;
  readonly eye?: Vec3;
  readonly exits?: readonly Vec3[];
}

/** A value known to be present by construction (noUncheckedIndexedAccess can't see it). */
const known = <T>(value: T | undefined): T => value as T;

const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
const freezeVec = ({ x, y, z }: Vec3): Vec3 => Object.freeze({ x, y, z });

/** The default spot data: one place, fully concealing, one exit out of the front. */
export function hidingSpotOf(spec: HidingSpotSpec): HidingSpot {
  const capacity = spec.capacity ?? 1;
  const concealment = spec.concealment ?? 1;
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError(`hiding capacity must be a positive integer, got ${String(capacity)}`);
  }
  if (!(concealment >= 0 && concealment <= 1)) {
    throw new RangeError(`concealment must be 0..1, got ${String(concealment)}`);
  }
  const inside = freezeVec(spec.inside ?? ZERO);
  const exits = (spec.exits ?? [{ x: 0, y: 0, z: 0.9 }]).map(freezeVec);
  if (exits.length === 0) throw new RangeError('a hiding spot needs an exit point');
  return Object.freeze({
    capacity,
    concealment,
    peek: spec.peek ?? true,
    enterDb: spec.enterDb ?? 30,
    exitDb: spec.exitDb ?? 24,
    origin: freezeVec(spec.origin),
    yaw: spec.yaw ?? 0,
    inside,
    eye: freezeVec(spec.eye ?? { x: inside.x, y: inside.y + 1.5, z: inside.z + 0.2 }),
    exits: Object.freeze(exits),
    occupants: Object.freeze([]),
    follow: null,
  });
}

/** The interaction affordances of a spot, in the order prompts read them. */
export const HIDING_AFFORDANCES: readonly AffordanceSpec[] = Object.freeze([
  LEAVE_AFFORDANCE,
  HIDE_AFFORDANCE,
]);

/** Makes `entity` a hiding spot (and interactable, when interaction is installed). */
export function makeHidingSpot(world: World<never>, entity: EntityId, spec: HidingSpotSpec): void {
  const spot = hidingSpotOf(spec);
  // A spot a physics body carries follows it from where it is now.
  const body = world.isRegistered(PhysicsObjectComponent)
    ? world.get(entity, PhysicsObjectComponent)
    : undefined;
  world.add(
    entity,
    HidingSpotComponent,
    body === undefined ? spot : { ...spot, follow: freezeVec(body.position) },
  );
  if (world.isRegistered(InteractableComponent)) {
    addInteractable(
      world,
      entity,
      { affordances: HIDING_AFFORDANCES, anchor: SPOT_ANCHOR, radius: SPOT_RADIUS },
      spec.origin,
    );
  }
}

/** A scene spawn that may be a hiding spot, and its entity (as `LoadedScene.spawns` lists them). */
export interface HidingSpawnEntity {
  readonly entity: EntityId;
  readonly spawn: {
    readonly position: Vec3;
    readonly yaw: SceneSpawnPlacement['yaw'];
    readonly hiding?: SceneHiding | undefined;
  };
}

/**
 * Makes every loaded spawn that declares `hiding` a hiding spot opening the way its yaw faces
 * (`yawOf` converts the spawn's scene yaw to a look yaw). Call between steps. Returns those
 * entities, in scene order.
 */
export function addSceneHidingSpots(
  world: World<never>,
  spawns: readonly HidingSpawnEntity[],
  yawOf: (spawn: HidingSpawnEntity['spawn']) => number,
): EntityId[] {
  const made: EntityId[] = [];
  for (const { entity, spawn } of spawns) {
    const own = spawn.hiding;
    if (own === undefined) continue;
    const triple = ([x, y, z]: readonly [number, number, number]): Vec3 => ({ x, y, z });
    makeHidingSpot(world, entity, {
      origin: spawn.position,
      yaw: yawOf(spawn),
      ...(own.capacity !== undefined && { capacity: own.capacity }),
      ...(own.concealment !== undefined && { concealment: own.concealment }),
      ...(own.peek !== undefined && { peek: own.peek }),
      ...(own.enterDb !== undefined && { enterDb: own.enterDb }),
      ...(own.exitDb !== undefined && { exitDb: own.exitDb }),
      ...(own.inside !== undefined && { inside: triple(own.inside) }),
      ...(own.eye !== undefined && { eye: triple(own.eye) }),
      ...(own.exits !== undefined && { exits: own.exits.map(triple) }),
    });
    made.push(entity);
  }
  return made;
}

/** What `enterSpot` and `leaveSpot` answer. */
export type HidingResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: HidingRefusal };

const refuse = (reason: HidingRefusal): HidingResult => ({ ok: false, reason });

const yawDelta = (a: number, b: number): number => {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

/** A point on the floor as a character stands on it: SKIN above. */
const standingAt = (point: Vec3): Vec3 => ({ x: point.x, y: point.y + SKIN, z: point.z });

/** Puts `actor` at `feet`, stopped (a controller's state, or a placement). */
function moveActor(world: World<never>, actor: EntityId, feet: Vec3): void {
  const state = world.isRegistered(CharacterController)
    ? world.get(actor, CharacterController)
    : undefined;
  if (state !== undefined) {
    // A held character is not slow-walking.
    const rest: { -readonly [K in keyof typeof state]: (typeof state)[K] } = { ...state };
    delete rest.slowWalk;
    world.set(actor, CharacterController, {
      ...rest,
      position: freezeVec(feet),
      velocity: ZERO,
      sprinting: false,
      traversal: null,
    });
  }
  const at = placedAt(world, actor);
  if (at !== undefined) placeEntity(world, actor, feet, at.radius);
}

/** Where `actor` is placed, when placements exist in `world` and it has one. */
function placedAt(world: World<never>, actor: EntityId): Placement | undefined {
  return world.isRegistered(PlacementComponent) ? placementOf(world, actor) : undefined;
}

function setSpot(world: World<never>, entity: EntityId, spot: HidingSpot): void {
  world.set(entity, HidingSpotComponent, spot);
}

/** The rules over a world: see the file header. */
export class Hiding {
  readonly #collision: CollisionWorld | undefined;
  readonly #capsule: Capsule;
  readonly #heat: number;

  constructor(options: HidingOptions = {}) {
    this.#collision = options.collision;
    this.#capsule = options.capsule ?? DEFAULT_EXIT_CAPSULE;
    this.#heat = options.ejectHeat ?? DEFAULT_EJECT_HEAT;
  }

  /** Whether `actor` fits at `feet`. */
  clear(feet: Vec3): boolean {
    // Characters stand SKIN above the floor they stand on: a point on the floor itself overlaps it.
    return this.#collision?.overlapCapsule(this.#capsule, standingAt(feet)) !== true;
  }

  /** The exit points of `spot` in the world, in order of preference. */
  exitsOf(spot: HidingSpot): Vec3[] {
    return spot.exits.map((local) => spotPoint(spot, local));
  }

  /** The first free exit point of `spot`, or undefined when every one is blocked. */
  freeExit(spot: HidingSpot): Vec3 | undefined {
    return this.exitsOf(spot).find((point) => this.clear(point));
  }

  /** The exit nearest `from` that is free; failing that, the nearest anyway (`free` false). */
  nearestExit(spot: HidingSpot, from: Vec3): { readonly point: Vec3; readonly free: boolean } {
    const distance = (p: Vec3): number => (p.x - from.x) ** 2 + (p.z - from.z) ** 2;
    const sorted = this.exitsOf(spot)
      .map((point, order) => ({ point, order }))
      .sort((a, b) => distance(a.point) - distance(b.point) || a.order - b.order);
    const free = sorted.find(({ point }) => this.clear(point));
    // `exits` is never empty (hidingSpotOf), so there is always a nearest.
    const chosen = free ?? known(sorted[0]);
    return { point: chosen.point, free: free !== undefined };
  }

  /**
   * Why `actor` can't get into `entity` now, or undefined when it can. Reads only: the prompt's gate
   * asks it too.
   */
  enterRefusal(world: World<never>, actor: EntityId, entity: EntityId): HidingRefusal | undefined {
    const spot = spotOf(world, entity);
    if (spot === undefined) return 'not-a-spot';
    if (hiddenOf(world, actor) !== undefined) return 'already-hidden';
    if (spot.occupants.length >= spot.capacity) return 'full';
    if (world.isRegistered(WorldProperties.burning) && readProperty(world, entity, 'burning')) {
      return 'burning';
    }
    if (holdOf(world, actor) !== undefined) return 'hands-full';
    const state = world.isRegistered(CharacterController)
      ? world.get(actor, CharacterController)
      : undefined;
    if (state !== undefined && (state.traversal !== null || !state.grounded)) return 'busy';
    return undefined;
  }

  /**
   * `actor` gets into spot `entity`: flagged hidden with its concealment, moved to its inside point,
   * and the enter noise made. Refused (with `hiding.refused`) when `enterRefusal` says so.
   */
  enter(world: World<never>, actor: EntityId, entity: EntityId): HidingResult {
    const reason = this.enterRefusal(world, actor, entity);
    if (reason !== undefined) {
      world.events.emit(hidingRefused, {
        tick: world.tick,
        actor,
        spot: entity,
        action: 'enter',
        reason,
      });
      return refuse(reason);
    }
    const spot = known(spotOf(world, entity)); // enterRefusal found it
    const state = world.isRegistered(CharacterController)
      ? world.get(actor, CharacterController)
      : undefined;
    const from = freezeVec(state?.position ?? placedAt(world, actor) ?? spot.origin);
    world.add(actor, HiddenComponent, {
      spot: entity,
      concealment: spot.concealment,
      since: world.tick,
      from,
    });
    setSpot(world, entity, { ...spot, occupants: Object.freeze([...spot.occupants, actor]) });
    const inside = insidePoint(spot);
    moveActor(world, actor, standingAt(inside));
    const look = world.isRegistered(PlayerLook) ? world.get(actor, PlayerLook) : undefined;
    if (look !== undefined) world.set(actor, PlayerLook, { yaw: spot.yaw, pitch: 0 });
    emitNoise(world, {
      position: inside,
      loudness: spot.enterDb,
      kind: HIDE_ENTER_NOISE,
      entity,
      source: actor,
    });
    world.events.emit(hidingEntered, {
      tick: world.tick,
      actor,
      spot: entity,
      concealment: spot.concealment,
    });
    return { ok: true };
  }

  /**
   * `actor` steps out of the spot it is in, to the first free exit point. Refused with reason
   * `blocked` (and `hiding.refused`) when every exit point is blocked, `not-inside` when it hides
   * nowhere.
   */
  leave(world: World<never>, actor: EntityId): HidingResult {
    const hidden = hiddenOf(world, actor);
    if (hidden === undefined) return refuse('not-inside');
    const spot = spotOf(world, hidden.spot);
    if (spot === undefined) {
      this.#release(world, actor, hidden, 'gone');
      return { ok: true };
    }
    const exit = this.freeExit(spot);
    if (exit === undefined) {
      world.events.emit(hidingRefused, {
        tick: world.tick,
        actor,
        spot: hidden.spot,
        action: 'leave',
        reason: 'blocked',
      });
      return refuse('blocked');
    }
    this.#remove(world, actor, hidden.spot, spot);
    moveActor(world, actor, standingAt(exit));
    emitNoise(world, {
      position: exit,
      loudness: spot.exitDb,
      kind: HIDE_EXIT_NOISE,
      entity: hidden.spot,
      source: actor,
    });
    world.events.emit(hidingLeft, { tick: world.tick, actor, spot: hidden.spot, to: exit });
    return { ok: true };
  }

  /**
   * Throws everyone out of spot `entity` this tick, each to the free exit nearest to them. Ejected
   * from a burning spot they take a heat stimulus. Returns who was ejected, in order.
   */
  eject(world: World<never>, entity: EntityId, cause: EjectCause): EntityId[] {
    const spot = spotOf(world, entity);
    if (spot === undefined || spot.occupants.length === 0) return [];
    for (const actor of spot.occupants) this.ejectActor(world, actor, cause);
    return [...spot.occupants];
  }

  /** Throws `actor` alone out of the spot it is in (a death), as `eject` does everyone. */
  ejectActor(world: World<never>, actor: EntityId, cause: EjectCause): void {
    const hidden = hiddenOf(world, actor);
    if (hidden === undefined) return;
    const burning =
      cause === 'burning' ||
      (world.isRegistered(WorldProperties.burning) && readProperty(world, hidden.spot, 'burning'));
    this.#release(world, actor, hidden, cause, burning);
  }

  /** Takes `actor` out of whatever it hides in, as a cause the actor did not choose. */
  #release(
    world: World<never>,
    actor: EntityId,
    hidden: { readonly spot: EntityId; readonly from: Vec3 },
    cause: EjectCause,
    burning = false,
  ): void {
    const spot = spotOf(world, hidden.spot);
    const inside = spot === undefined ? hidden.from : insidePoint(spot);
    const chosen =
      spot === undefined ? { point: hidden.from, free: true } : this.nearestExit(spot, inside);
    this.#remove(world, actor, hidden.spot, spot);
    moveActor(world, actor, spot === undefined ? chosen.point : standingAt(chosen.point));
    const heat = burning ? this.#heat : 0;
    if (heat > 0) {
      applyStimulus(world, {
        shape: { kind: 'contact', target: actor },
        element: 'heat',
        intensity: heat,
        source: hidden.spot,
      });
    }
    world.events.emit(hidingEjected, {
      tick: world.tick,
      actor,
      spot: hidden.spot,
      cause,
      to: chosen.point,
      free: chosen.free,
      heat,
    });
  }

  /** Drops `actor`'s hidden flag and its place in `spot`. */
  #remove(world: World<never>, actor: EntityId, entity: EntityId, spot: HidingSpot | undefined) {
    world.remove(actor, HiddenComponent);
    if (spot !== undefined) {
      setSpot(world, entity, {
        ...spot,
        occupants: Object.freeze(spot.occupants.filter((o) => o !== actor)),
      });
    }
  }

  /** Puts everyone hiding anywhere at an exit, silently: a save never stores a hide. */
  settleAll(world: World<never>): void {
    if (!world.isRegistered(HidingSpotComponent)) return;
    const spots: EntityId[] = [];
    world.query(HidingSpotComponent).forEach((entity, spot) => {
      if (spot.occupants.length > 0) spots.push(entity);
    });
    for (const entity of spots) this.eject(world, entity, 'gone');
  }
}

/** The ActionFrame an occupant gets: its look and Interact (and inventory, pause); nothing else. */
export function hiddenFrame(frame: ActionFrame): ActionFrame {
  return actionFrame({
    move: actionVector(0, 0),
    look: frame.look,
    lookStick: frame.lookStick,
    buttons: (action) => (KEPT_BUTTONS.has(action) ? frame[action] : UP),
  });
}

const installed = new WeakMap<object, Hiding>();

/** Puts everyone hiding in `world` at an exit before a save is written (see the file header). */
export function settleHidden(world: World<never>): void {
  installed.get(world)?.settleAll(world);
}

/** The rules installed in `world`, or undefined. */
export function hidingOf(world: World<never>): Hiding | undefined {
  return installed.get(world);
}

/** Whether a quaternion's up vector has tipped below `TOPPLE_UP`. */
function toppled(q: { readonly x: number; readonly z: number }): boolean {
  return 1 - 2 * (q.x * q.x + q.z * q.z) < TOPPLE_UP;
}

/**
 * Sets up hiding in `world`: registers the components, cuts a hidden actor's input to look and
 * Interact, holds the occupant's look to the opening's arc and carries it with its spot, handles the
 * Hide and Leave verbs and gates their prompts, throws occupants out when the spot ignites, breaks,
 * goes under, topples, vanishes or the occupant dies. For prompts, install interaction first. Call
 * once at setup, between steps, after the player. Returns the rules and a function that removes the
 * subscriptions.
 */
export function installHiding<TInput>(
  world: World<TInput>,
  options: HidingOptions = {},
): { readonly hiding: Hiding; readonly uninstall: () => void } {
  const sim: World<never> = world;
  const hiding = new Hiding(options);
  world.register(HidingSpotComponent, HiddenComponent);
  installed.set(sim, hiding);
  let active = true;

  world.addInputFilter({
    name: 'hidden-input',
    keep: () => true,
    map: (input, w) => {
      if (!isActionFrame(input)) return input;
      const player = hiddenPlayer(w);
      return player === undefined ? input : hiddenFrame(input);
    },
  });
  world.addSystem({
    name: 'hiding',
    run: () => {
      if (!active) return;
      const spots: [EntityId, HidingSpot][] = [];
      sim.query(HidingSpotComponent).forEach((entity, spot) => {
        const carried =
          sim.isRegistered(PhysicsObjectComponent) && sim.has(entity, PhysicsObjectComponent);
        if (spot.occupants.length > 0 || carried) spots.push([entity, spot]);
      });
      for (const [entity, spot] of spots) keepOccupants(sim, hiding, entity, spot);
      // Anyone flagged hidden in a spot that is gone is put back where they were.
      const orphans: EntityId[] = [];
      sim.query(HiddenComponent).forEach((actor, hidden) => {
        if (spotOf(sim, hidden.spot) === undefined) orphans.push(actor);
      });
      for (const actor of orphans) hiding.leave(sim, actor);
    },
  });

  const gate: AffordanceGate = (w, actor, target, affordance) => {
    switch (affordance.verb) {
      case 'hide': {
        const reason = hiding.enterRefusal(w, actor, target);
        return reason === undefined ? undefined : HIDING_REASONS[reason];
      }
      case 'leave': {
        const spot = spotOf(w, target);
        if (spot === undefined) return HIDING_REASONS['not-a-spot'];
        if (hiddenOf(w, actor)?.spot === target) {
          return hiding.freeExit(spot) === undefined ? HIDING_REASONS.blocked : undefined;
        }
        // Not inside: the prompt reads why it can't get in when it is full, else what Leave is for.
        return HIDING_REASONS[spot.occupants.length >= spot.capacity ? 'full' : 'not-inside'];
      }
      case 'pick-up':
      case 'push':
        return occupantsOf(w, target).length > 0 ? HIDING_REASONS.full : undefined;
      default:
        return undefined;
    }
  };
  const offs = [
    addAffordanceGate(world, gate),
    // Inside, nothing but the spot itself is in reach.
    addFocusFilter(world, (w, actor, target) => {
      const mine = hiddenOf(w, actor);
      return mine !== undefined && mine.spot !== target;
    }),
    world.events.on(interacted, ({ actor, target, verb }) => {
      if (verb === 'hide' && spotOf(sim, target) !== undefined) hiding.enter(sim, actor, target);
      else if (verb === 'leave') hiding.leave(sim, actor);
    }),
    world.events.on(fireIgnited, ({ entity }) => {
      hiding.eject(sim, entity, 'burning');
    }),
    world.events.on(breakableBroken, ({ entity }) => {
      hiding.eject(sim, entity, 'broken');
    }),
    world.events.on(liquidEntered, ({ entity }) => {
      hiding.eject(sim, entity, 'submerged'); // the spot goes under
      hiding.ejectActor(sim, entity, 'submerged'); // or the occupant does
    }),
    // Only the one who died leaves: the others stay hidden.
    world.events.on(Died, ({ target }) => {
      hiding.ejectActor(sim, target, 'died');
    }),
  ];
  return {
    hiding,
    uninstall: () => {
      active = false;
      for (const off of offs) off();
      installed.delete(sim);
    },
  };
}

/** The (first) actor that is hiding, or undefined when nobody is. */
function hiddenPlayer(world: World<never>): EntityId | undefined {
  let found: EntityId | undefined;
  world.query(HiddenComponent).forEach((actor) => {
    if (found === undefined && world.isRegistered(PlayerLook) && world.has(actor, PlayerLook)) {
      found = actor;
    }
  });
  return found;
}

/** Follows the spot's body, carries its occupants and holds their look to the opening. */
function keepOccupants(
  world: World<never>,
  hiding: Hiding,
  entity: EntityId,
  before: HidingSpot,
): void {
  let spot = before;
  const object = world.isRegistered(PhysicsObjectComponent)
    ? world.get(entity, PhysicsObjectComponent)
    : undefined;
  if (object !== undefined) {
    const { position, rotation } = object;
    const last = before.follow ?? position;
    if (position.x !== last.x || position.y !== last.y || position.z !== last.z) {
      spot = {
        ...before,
        origin: freezeVec({
          x: before.origin.x + position.x - last.x,
          y: before.origin.y + position.y - last.y,
          z: before.origin.z + position.z - last.z,
        }),
        follow: freezeVec(position),
      };
      setSpot(world, entity, spot);
    }
    if (spot.occupants.length > 0 && toppled(rotation)) {
      hiding.eject(world, entity, 'toppled');
      return;
    }
  }
  const inside = standingAt(insidePoint(spot));
  for (const actor of spot.occupants) {
    moveActor(world, actor, inside);
    const look = world.isRegistered(PlayerLook) ? world.get(actor, PlayerLook) : undefined;
    if (look === undefined) continue;
    const arc = spot.peek ? PEEK_YAW_ARC : 0;
    const delta = Math.max(-arc, Math.min(arc, yawDelta(look.yaw, spot.yaw)));
    const pitch = Math.max(-PEEK_PITCH_ARC, Math.min(PEEK_PITCH_ARC, look.pitch));
    const yaw = spot.yaw + delta;
    if (yaw !== look.yaw || pitch !== look.pitch) world.set(actor, PlayerLook, { yaw, pitch });
  }
}
