// Carrying world objects (mw-e02.17, ADR-0003): an actor picks up a crate, a bottle or a body with
// Interact, holds it in front where it collides with the world, and puts it down, places it, or
// throws it. Nothing here names an object type: what can be lifted is the `liftable` property, how
// heavy a load an actor manages is its class's data, and what a thrown object does comes from the
// same properties and rules as anything else that moves.
//
// - Pick up: the pick-up affordance of a `liftable` physics object (src/sim/interaction) is offered
//   with the reason "Too heavy" above the actor's carry limit, "Hands full" while it already
//   carries something and "Held" while another actor does. Inventory items (`item.world`) are
//   weightless and go to the pack, never through here (ADR-0003).
// - Carry: a held object is moved to the hold point, in front of the actor at chest height, every tick (its
//   body is teleported, so it has no speed and strikes nothing). The move is swept first, so a wall
//   pushes the object back towards the carrier and it never ends inside geometry; pinned against a
//   wall with nowhere left to go, it is let go. Hands carry ×0.85 speed and may jump; a `bulky`
//   object (a body) rides the shoulder at ×0.5 and no jump (`carryRestraint`, read by the player's
//   movement). Neither sprints.
// - Release: Drop lets go in front, Drop with crouch held places the object on the surface below it
//   gently, and Throw, held and released, throws it along the aim at 4–14 m/s by how long it was
//   charged (0.2–1.0 s). A thrown object is just a physics object from then on: it strikes creatures
//   (environment damage), breaks if fragile and spills its contents (breakables), keeps burning if it
//   was burning, and makes noise through `physicsImpact` like any physics object that hits something
//   (src/sim/noise/impacts.ts, by energy and material). The release blames the thrower, so a smashed pot or a struck guard is theirs.
// - Fire: an object that burns in the hands for `burnSeconds` heats the carrier (a heat stimulus) and
//   is dropped.
// - The throw arc preview (`preview`) is the line a held throw would fly, for the UI to draw.
//
// Edge cases (mw-e17.14, ADR-0003): a carrier whose poise breaks or who is staggered, knocked back or
// knocked down lets go at once, the object set down at its feet. Leaving the scene sets the object
// down on the near side of the threshold (objects never cross a scene load). A save sets what is
// held down at the carrier's feet first (`settleHeldObjects`), so a save never stores a hold and a
// load never finds the player carrying. A carrier cannot take hold of a ladder, rope, ivy or ledge
// ("Hands full", `refuseGrab` in ./state, asked by the climbing and ledge hooks).
//
// Out of scope: lifting by spell (the tether's) and the AI's response to the noise (e11).

import type { CollisionWorld } from '../character/collision-world';
import { PoiseBroken } from '../combat/damage/events';
import { blame, BlameComponent } from '../combat/environment/environment';
import { reactionRank } from '../combat/reactions/components';
import { HitReaction } from '../combat/reactions/events';
import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { actionFrameOf, type ActionButton } from '../input/action-frame';
import { addAffordanceGate, addFocusFilter, interacted } from '../interaction/system';
import type { Affordance } from '../interaction/affordance';
import { handlerView, WorldItemComponent, type ItemHandlerView } from '../items/world-items';
import { cos, hypot, sin } from '../math';
import type { BodyShape } from '../physics/bodies';
import {
  PhysicsObjectComponent,
  type PhysicsObject,
  setPhysicsObjectVelocity,
  teleportPhysicsObject,
} from '../physics/objects';
import { readProperty } from '../properties/components';
import type { Quat } from '../scene/layout';
import { areaTransition } from '../scene/transitions';
import { placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { applyStimulus, StimulusQueueComponent } from '../stimulus/stimulus';
import { restHeight } from './recovery';
import {
  CarryBulkyComponent,
  CarryLedgerComponent,
  holdOf,
  holderOf,
  holdsOf,
  type CarryMode,
  type Hold,
} from './state';

/** How one carry mode slows the carrier. */
export interface CarryModeTuning {
  /** Share of normal speed kept, in (0, 1]. */
  readonly speedScale: number;
  /** The carrier may not jump. */
  readonly noJump: boolean;
}

/** The throw's charge and speed range. */
export interface ThrowTuning {
  /** Charge below which a throw is the weakest one, seconds. */
  readonly minCharge: number;
  /** Charge at which a throw is the strongest one, seconds. */
  readonly maxCharge: number;
  /** Speed of the weakest throw, m/s. */
  readonly minSpeed: number;
  /** Speed of the strongest throw, m/s. */
  readonly maxSpeed: number;
}

/** Every carry number (game values; the carry limit itself is the class's, see `limit`). */
export interface CarryTuning {
  /** Heaviest hand-carry when no class says otherwise, kg (ADR-0003: 25). */
  readonly handLimitKg: number;
  /** Heaviest shoulder-carry, kg. */
  readonly bulkyLimitKg: number;
  readonly hand: CarryModeTuning;
  readonly shoulder: CarryModeTuning;
  readonly throw: ThrowTuning;
  /** Centre of a held object above the carrier's feet (higher for tall objects), metres. */
  readonly holdHeight: number;
  /** Clearance between the carrier's body and the held object, metres. */
  readonly holdGap: number;
  /** The carrier's body radius, metres (the character tuning's capsule). */
  readonly actorRadius: number;
  /** How far short of a wall a held object stops, metres (well inside the 2 cm the AC allows). */
  readonly skin: number;
  /** Seconds a held object may burn before it is dropped and the carrier is heated. */
  readonly burnSeconds: number;
  /** The heat the carrier takes when a burning object is dropped, °C. */
  readonly burnHeat: number;
  /** Gravity the preview arc assumes, m/s² (the physics world's). */
  readonly gravity: number;
}

/** The default carry tuning. */
export const DEFAULT_CARRY_TUNING: CarryTuning = Object.freeze({
  handLimitKg: 25,
  bulkyLimitKg: 120,
  hand: Object.freeze({ speedScale: 0.85, noJump: false }),
  shoulder: Object.freeze({ speedScale: 0.5, noJump: true }),
  throw: Object.freeze({ minCharge: 0.2, maxCharge: 1, minSpeed: 4, maxSpeed: 14 }),
  holdHeight: 1,
  holdGap: 0.1,
  actorRadius: 0.35,
  skin: 0.01,
  burnSeconds: 2,
  burnHeat: 60,
  gravity: 9.81,
});

/** Why an object was let go. */
export type ReleaseReason =
  | 'dropped'
  | 'placed'
  | 'thrown'
  /** It burned in the hands for too long. */
  | 'burning'
  /** It was pinned against geometry with nowhere to go. */
  | 'blocked'
  /** The carrier or the object is gone. */
  | 'lost'
  /** A hit broke the carrier's poise or staggered it (set down at its feet). */
  | 'staggered'
  /** The carrier left the scene (set down on the near side of the threshold). */
  | 'exit'
  /** The game was saved (set down at the carrier's feet). */
  | 'saved';

/** Why a pick-up was refused. */
export type CarryRefusal = 'not-carryable' | 'too-heavy' | 'hands-full' | 'held';

/** What the prompt says for each refusal. */
export const REFUSAL_TEXT: Readonly<Record<CarryRefusal, string>> = Object.freeze({
  'not-carryable': 'Cannot be carried',
  'too-heavy': 'Too heavy',
  'hands-full': 'Hands full',
  held: 'Held',
});

/** An actor took hold of an object. */
export interface ObjectPickedUp {
  readonly tick: number;
  readonly actor: EntityId;
  readonly target: EntityId;
  readonly mode: CarryMode;
  /** Its weight, kg. */
  readonly weight: number;
}

/** An actor let go of an object. */
export interface ObjectReleased {
  readonly tick: number;
  readonly actor: EntityId;
  readonly target: EntityId;
  readonly reason: ReleaseReason;
  /** Speed it left at, m/s (0 unless thrown). */
  readonly speed: number;
  /** Where it was let go (its centre), metres. */
  readonly position: Vec3;
}

/** A pick-up that was refused. */
export interface PickUpRefused {
  readonly tick: number;
  readonly actor: EntityId;
  readonly target: EntityId;
  readonly reason: CarryRefusal;
}

export const objectPickedUp = defineEvent<ObjectPickedUp>('carry.pickedUp');
export const objectReleased = defineEvent<ObjectReleased>('carry.released');
export const pickUpRefused = defineEvent<PickUpRefused>('carry.pickUpRefused');

/** What the carry buttons are this tick for one actor. */
export interface CarryButtons {
  readonly drop?: ActionButton | undefined;
  readonly throw?: ActionButton | undefined;
  readonly crouch?: ActionButton | undefined;
}

export interface CarryOptions<TInput> {
  /** Solid colliders a held object stops against (RapierCollisionWorld in the game). Omitted: none. */
  readonly collision?: CollisionWorld;
  /** The heaviest hand-carry of `actor`, kg: its class's. Defaults to the tuning's `handLimitKg`. */
  readonly limit?: (world: World<never>, actor: EntityId) => number;
  /** Overrides of DEFAULT_CARRY_TUNING. */
  readonly tuning?: Partial<CarryTuning>;
  /** Where `actor` stands and looks; defaults to `handlerView` (the player's). */
  readonly view?: (world: World<TInput>, actor: EntityId) => ItemHandlerView | undefined;
  /** This tick's carry buttons for `actor`; defaults to the tick's ActionFrame's. */
  readonly input?: (inputs: readonly TInput[], actor: EntityId) => CarryButtons | undefined;
}

/** What the game keeps of the installed carry rules. */
export interface CarryController {
  readonly tuning: CarryTuning;
  /** The hold of `actor`, or undefined. */
  holdOf(actor: EntityId): Hold | undefined;
  /** Picks `target` up for `actor` (the Interact verb's own path); the refusal otherwise. */
  pickUp(actor: EntityId, target: EntityId): { ok: true } | { ok: false; reason: CarryRefusal };
  /** Lets go of what `actor` holds, in front of it. False when it holds nothing. */
  drop(actor: EntityId): boolean;
  /** Sets what `actor` holds down gently on the surface below it. False when it holds nothing. */
  place(actor: EntityId): boolean;
  /** Throws what `actor` holds after charging `seconds`. False when it holds nothing. */
  throwHeld(actor: EntityId, seconds: number): boolean;
  /** Sets down everything held at its carrier's feet, as a save does (`settleHeldObjects`). */
  settleAll(reason?: 'saved'): void;
  /** The arc a throw would fly now, while `actor` charges one; undefined otherwise. */
  preview(actor: EntityId): readonly Vec3[] | undefined;
}

/** Speed of a throw charged for `seconds` (clamped to the tuning's range), m/s. */
export function throwSpeed(tuning: ThrowTuning, seconds: number): number {
  const { minCharge, maxCharge, minSpeed, maxSpeed } = tuning;
  const held = Math.min(maxCharge, Math.max(minCharge, seconds));
  return minSpeed + ((held - minCharge) / (maxCharge - minCharge)) * (maxSpeed - minSpeed);
}

/** The unit vector a look (yaw about +y, 0 faces −z; pitch above the horizon) aims along. */
export function aimOf(view: Pick<ItemHandlerView, 'yaw' | 'pitch'>): Vec3 {
  const flat = cos(view.pitch);
  return { x: -sin(view.yaw) * flat, y: sin(view.pitch), z: -cos(view.yaw) * flat };
}

/** Points of the flight of something thrown from `from` at `velocity`, until it lands (see `preview`). */
export function throwArc(
  from: Vec3,
  velocity: Vec3,
  gravity: number,
  collision: Pick<CollisionWorld, 'raycast'> | undefined,
  options: { readonly step?: number; readonly maxPoints?: number } = {},
): Vec3[] {
  const { step = 0.05, maxPoints = 60 } = options;
  const points: Vec3[] = [from];
  let at = from;
  let v = velocity;
  for (let i = 1; i < maxPoints; i += 1) {
    const next = {
      x: at.x + v.x * step,
      y: at.y + v.y * step - 0.5 * gravity * step * step,
      z: at.z + v.z * step,
    };
    v = { x: v.x, y: v.y - gravity * step, z: v.z };
    const leg = { x: next.x - at.x, y: next.y - at.y, z: next.z - at.z };
    const length = hypot(leg.x, leg.y, leg.z);
    const hit = collision?.raycast(
      at,
      { x: leg.x / length, y: leg.y / length, z: leg.z / length },
      length,
    );
    if (hit !== undefined) {
      points.push(hit.point);
      break;
    }
    points.push(next);
    at = next;
  }
  return points;
}

/** The bounding vertical capsule of a body shape: `radius` and half the height of its core. */
function reachOf(shape: BodyShape): { readonly radius: number; readonly half: number } {
  switch (shape.kind) {
    case 'box':
      return { radius: hypot(shape.halfExtents.x, shape.halfExtents.z), half: shape.halfExtents.y };
    case 'sphere':
      return { radius: shape.radius, half: 0 };
    case 'capsule':
      return { radius: shape.radius, half: shape.halfHeight };
  }
}

/** The controller installed in each world, so a save (which has only the world) can settle holds. */
const installed = new WeakMap<object, CarryController>();

/**
 * Sets down everything a carrier holds in `world` at its carrier's feet, before a save is written
 * (mw-e17.14): the save stores the object as a placed world object and no hold, so a load never finds
 * the player carrying. Does nothing where carrying is not installed or nothing is held.
 */
export function settleHeldObjects(world: World<never>): void {
  installed.get(world)?.settleAll('saved');
}

const yawRotation = (yaw: number): Quat => ({ x: 0, y: sin(yaw / 2), z: 0, w: cos(yaw / 2) });

/**
 * Installs carrying in `world`: the ledger, the pick-up rules on the Interact verb, the carry system
 * and impact noise. The world needs physics objects (installPhysicsObjects), stimuli (installStimuli)
 * and the interaction system (installInteraction). Add it after the systems that move actors and
 * after the world items system (a carrier's Drop and Throw buttons are the object's, not the pack's).
 * Once at setup, between steps.
 */
export function installCarry<TInput>(
  world: World<TInput>,
  options: CarryOptions<TInput> = {},
): CarryController {
  const w: World<never> = world;
  const tuning: CarryTuning = { ...DEFAULT_CARRY_TUNING, ...options.tuning };
  const { collision } = options;
  const limitOf = options.limit ?? (() => tuning.handLimitKg);
  const viewOf =
    options.view ?? ((_world: World<TInput>, actor: EntityId) => handlerView(w, actor));
  const inputOf =
    options.input ??
    ((inputs: readonly TInput[]): CarryButtons | undefined => actionFrameOf(inputs));
  if (!w.isRegistered(StimulusQueueComponent)) throw new Error('install stimuli before carrying');
  // Containers register the bulky marker too (a stashed body, mw-e03.23): whichever comes first.
  w.register(CarryLedgerComponent);
  if (!w.isRegistered(CarryBulkyComponent)) w.register(CarryBulkyComponent);
  if (!w.isRegistered(WorldItemComponent)) w.register(WorldItemComponent);
  const ledgerId = w.spawn();
  w.add(ledgerId, CarryLedgerComponent, { holds: [] });
  const putAll = (holds: readonly Hold[]): void => {
    w.set(ledgerId, CarryLedgerComponent, { holds });
  };
  const put = (next: Hold): void => {
    putAll(holdsOf(w).map((hold) => (hold.actor === next.actor ? next : hold)));
  };

  const bulky = (target: EntityId): boolean => w.has(target, CarryBulkyComponent);
  /** Whether `target` is an object these rules carry (an inventory item is never one). */
  const carryable = (target: EntityId): boolean =>
    w.isAlive(target) &&
    w.has(target, PhysicsObjectComponent) &&
    !w.has(target, WorldItemComponent) &&
    (bulky(target) || readProperty(w, target, 'liftable'));

  const refusalFor = (actor: EntityId, target: EntityId): CarryRefusal | undefined => {
    if (!carryable(target)) return 'not-carryable';
    if (holdOf(w, actor) !== undefined) return 'hands-full';
    if (holderOf(w, target) !== undefined) return 'held';
    const limit = bulky(target) ? tuning.bulkyLimitKg : limitOf(w, actor);
    return readProperty(w, target, 'weight') > limit ? 'too-heavy' : undefined;
  };

  addAffordanceGate(world, (_w: World<never>, actor, target, affordance: Affordance) => {
    if (affordance.verb !== 'pick-up' || w.has(target, WorldItemComponent)) return undefined;
    if (!w.has(target, PhysicsObjectComponent)) return undefined;
    const refusal = refusalFor(actor, target);
    return refusal === undefined ? undefined : REFUSAL_TEXT[refusal];
  });
  // What an actor carries is never what it interacts with: it would hide whatever lies behind it.
  addFocusFilter(world, (_w, _actor, target) => holderOf(w, target) !== undefined);

  const pickUp: CarryController['pickUp'] = (actor, target) => {
    const reason = refusalFor(actor, target);
    if (reason !== undefined) {
      w.events.emit(pickUpRefused, { tick: w.tick, actor, target, reason });
      return { ok: false, reason };
    }
    const mode: CarryMode = bulky(target) ? 'shoulder' : 'hand';
    const { speedScale, noJump } = tuning[mode];
    putAll(
      [
        ...holdsOf(w),
        {
          actor,
          target,
          mode,
          since: w.tick,
          speedScale,
          noJump,
          charge: -1,
          burning: 0,
        },
      ].sort((a, b) => a.actor - b.actor),
    );
    w.events.emit(objectPickedUp, {
      tick: w.tick,
      actor,
      target,
      mode,
      weight: readProperty(w, target, 'weight'),
    });
    return { ok: true };
  };

  w.events.on(interacted, ({ actor, target, verb }) => {
    if (verb !== 'pick-up' || w.has(target, WorldItemComponent)) return;
    if (!w.has(target, PhysicsObjectComponent)) return;
    pickUp(actor, target);
  });

  /** Lets go of `hold`'s object; it leaves at `velocity` when given. */
  const release = (hold: Hold, reason: ReleaseReason, velocity?: Vec3): void => {
    const { actor, target } = hold;
    putAll(holdsOf(w).filter((held) => held.actor !== actor));
    const at = placementOf(w, target);
    const position = at === undefined ? { x: 0, y: 0, z: 0 } : { x: at.x, y: at.y, z: at.z };
    let speed = 0;
    if (velocity !== undefined && carryable(target)) {
      setPhysicsObjectVelocity(w, target, velocity);
      speed = hypot(velocity.x, velocity.y, velocity.z);
    }
    if (w.isAlive(target) && w.isRegistered(BlameComponent)) blame(w, target, actor);
    w.events.emit(objectReleased, { tick: w.tick, actor, target, reason, speed, position });
  };

  /** The hold point and the clear distance to it for `hold`; undefined when the object is pinned. */
  const holdPose = (
    object: PhysicsObject,
    view: ItemHandlerView,
  ): { readonly position: Vec3; readonly rotation: Quat } | undefined => {
    const reach = reachOf(object.shape);
    const lift = Math.max(tuning.holdHeight, reach.half + reach.radius + 0.05);
    const origin = { x: view.feet.x, y: view.feet.y + lift, z: view.feet.z };
    const ahead = { x: -sin(view.yaw), y: 0, z: -cos(view.yaw) };
    const wanted = tuning.actorRadius + reach.radius + tuning.holdGap;
    let distance = wanted;
    if (collision !== undefined) {
      const hit = collision.sweepCapsule(
        { radius: reach.radius, height: 2 * (reach.half + reach.radius) },
        { x: origin.x, y: origin.y - reach.half - reach.radius, z: origin.z },
        ahead,
        wanted,
        object.body,
      );
      if (hit !== undefined) distance = Math.max(0, hit.distance - tuning.skin);
    }
    if (distance < tuning.actorRadius) return undefined;
    return {
      position: { x: origin.x + ahead.x * distance, y: origin.y, z: origin.z + ahead.z * distance },
      rotation: yawRotation(view.yaw),
    };
  };

  const placeHeld = (hold: Hold): void => {
    const object = w.get(hold.target, PhysicsObjectComponent);
    const at = placementOf(w, hold.target);
    if (object !== undefined && at !== undefined && collision !== undefined) {
      const { half } = reachOf(object.shape);
      const hit = collision.sweepCapsule(
        { radius: 0.05, height: 0.1 },
        { x: at.x, y: at.y - half, z: at.z },
        { x: 0, y: -1, z: 0 },
        PLACE_REACH,
        object.body,
      );
      if (hit !== undefined) {
        teleportPhysicsObject(w, hold.target, {
          x: at.x,
          y: at.y - hit.distance + PLACE_LIFT,
          z: at.z,
        });
      }
    }
    release(hold, 'placed');
  };

  /**
   * Lets go of `hold`'s object with its base on its carrier's feet: where it rides (in front, clear of
   * walls) or, with `at`, over that spot instead.
   */
  const setDown = (hold: Hold, reason: ReleaseReason, at?: { x: number; z: number }): void => {
    const object = w.get(hold.target, PhysicsObjectComponent);
    const now = placementOf(w, hold.target);
    const feet = w.isAlive(hold.actor) ? viewOf(world, hold.actor)?.feet : undefined;
    if (object !== undefined && now !== undefined && feet !== undefined) {
      teleportPhysicsObject(w, hold.target, {
        x: at?.x ?? now.x,
        y: feet.y + restHeight(object.shape) + PLACE_LIFT,
        z: at?.z ?? now.z,
      });
    }
    release(hold, reason);
  };

  /** Where the carrier's object goes on leaving through `volume`: outside the nearest face. */
  const nearSide = (
    volume: { readonly min: Vec3; readonly max: Vec3 },
    feet: Vec3,
    margin: number,
  ): { x: number; z: number } => {
    const faces = [
      { dist: feet.x - volume.min.x, x: volume.min.x - margin, z: feet.z },
      { dist: volume.max.x - feet.x, x: volume.max.x + margin, z: feet.z },
      { dist: feet.z - volume.min.z, x: feet.x, z: volume.min.z - margin },
      { dist: volume.max.z - feet.z, x: feet.x, z: volume.max.z + margin },
    ];
    const nearest = faces.reduce((best, face) => (face.dist < best.dist ? face : best));
    return { x: nearest.x, z: nearest.z };
  };

  const launch = (hold: Hold, view: ItemHandlerView, seconds: number): void => {
    const aim = aimOf(view);
    const speed = throwSpeed(tuning.throw, seconds);
    release(hold, 'thrown', { x: aim.x * speed, y: aim.y * speed, z: aim.z * speed });
  };

  const controller: CarryController = {
    tuning,
    holdOf: (actor) => holdOf(w, actor),
    pickUp,
    drop(actor) {
      const hold = holdOf(w, actor);
      if (hold === undefined) return false;
      release(hold, 'dropped');
      return true;
    },
    place(actor) {
      const hold = holdOf(w, actor);
      if (hold === undefined) return false;
      placeHeld(hold);
      return true;
    },
    settleAll(reason = 'saved') {
      for (const hold of holdsOf(w)) setDown(hold, reason);
    },
    throwHeld(actor, seconds) {
      const hold = holdOf(w, actor);
      const view = hold === undefined ? undefined : viewOf(world, actor);
      if (hold === undefined || view === undefined) return false;
      launch(hold, view, seconds);
      return true;
    },
    preview(actor) {
      const hold = holdOf(w, actor);
      const view = hold === undefined ? undefined : viewOf(world, actor);
      const at = hold === undefined ? undefined : placementOf(w, hold.target);
      if (hold === undefined || view === undefined || at === undefined || hold.charge < 0) {
        return undefined;
      }
      const aim = aimOf(view);
      const speed = throwSpeed(tuning.throw, hold.charge / w.clock.hz);
      const clear = at.radius + 0.05; // just outside the object's own body
      return throwArc(
        { x: at.x + aim.x * clear, y: at.y + aim.y * clear, z: at.z + aim.z * clear },
        { x: aim.x * speed, y: aim.y * speed, z: aim.z * speed },
        tuning.gravity,
        collision,
      );
    },
  };

  installed.set(world, controller);

  // A hit that breaks the carrier's poise, or staggers, knocks back or knocks it down, drops the load.
  const staggered = (actor: EntityId): void => {
    const hold = holdOf(w, actor);
    if (hold !== undefined) setDown(hold, 'staggered');
  };
  w.events.on(PoiseBroken, ({ target }) => {
    staggered(target);
  });
  w.events.on(HitReaction, ({ entity, reaction }) => {
    if (reactionRank(reaction) >= reactionRank('stagger')) staggered(entity);
  });
  // Objects never cross a scene load: the player's load is left on the near side of the threshold.
  w.events.on(areaTransition, ({ entity, volume }) => {
    const hold = holdOf(w, entity);
    if (hold === undefined) return;
    const object = w.get(hold.target, PhysicsObjectComponent);
    const feet = viewOf(world, entity)?.feet;
    if (volume === undefined || object === undefined || feet === undefined) {
      setDown(hold, 'exit');
      return;
    }
    setDown(hold, 'exit', nearSide(volume, feet, reachOf(object.shape).radius + tuning.holdGap));
  });

  const burnTicks = Math.max(1, Math.round(tuning.burnSeconds * w.clock.hz));

  const system: System<TInput> = {
    name: 'carry',
    run({ inputs, clock }) {
      for (const hold of holdsOf(w)) {
        const { actor, target } = hold;
        const view = w.isAlive(actor) && carryable(target) ? viewOf(world, actor) : undefined;
        const object = view === undefined ? undefined : w.get(target, PhysicsObjectComponent);
        if (view === undefined || object === undefined) {
          release(hold, 'lost');
          continue;
        }
        let held = hold;
        // Fire in the hands.
        if (readProperty(w, target, 'burning')) {
          if (hold.burning + 1 >= burnTicks) {
            applyStimulus(w, {
              shape: { kind: 'contact', target: actor },
              element: 'heat',
              intensity: tuning.burnHeat,
              source: target,
            });
            release(hold, 'burning');
            continue;
          }
          held = { ...hold, burning: hold.burning + 1 };
          put(held);
        } else if (hold.burning > 0) {
          held = { ...hold, burning: 0 };
          put(held);
        }
        // Where it rides this tick.
        const pose = holdPose(object, view);
        if (pose === undefined) {
          release(held, 'blocked');
          continue;
        }
        teleportPhysicsObject(w, target, pose.position, pose.rotation);
        const buttons = inputOf(inputs, actor);
        if (buttons?.drop?.pressed === true) {
          if (buttons.crouch?.held === true) placeHeld(held);
          else release(held, 'dropped');
          continue;
        }
        // Charging a throw, in ticks from the press to the release.
        const throwButton = buttons?.throw;
        if (held.mode === 'hand' && throwButton !== undefined) {
          if (held.charge >= 0) {
            if (throwButton.held) put({ ...held, charge: held.charge + 1 });
            else launch(held, view, (held.charge + 1) / clock.hz);
          } else if (throwButton.pressed) {
            if (throwButton.held) put({ ...held, charge: 0 });
            else launch(held, view, 0);
          }
        }
      }
    },
  };
  world.addSystem(system);

  return controller;
}

/** How far below a held object a placement looks for a surface, metres. */
const PLACE_REACH = 3;
/** How far above the surface a placed object is set down from, metres. */
const PLACE_LIFT = 0.01;
