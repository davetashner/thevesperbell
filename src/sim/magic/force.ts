// The force op (mw-e06.8): radial push, directional impulse, point pull and lift. "Throw enemies
// through furniture" is the fantasy, so a force works the same on a creature and on a loose object:
// both are reached through properties (weight, pushable, liftable), never by what they are.
//
// - push / impulse: one shove of `impulse` N·s through the single stimulus API (a contact force with
//   a direction). The velocity change is impulse / weight, so a 10 kg crate leaves four times as fast
//   as a 40 kg one; the physics layer (objects) and the character impulse API (creatures) integrate
//   it. `push` goes away from the point the delivery reached, `impulse` along the line from the caster
//   to it. A creature also takes the force as poise damage (`FORCE_POISE_PER_IMPULSE`) through the
//   damage model; a force that empties its poise knocks it down (the reaction rules' `force` tag).
// - pull / lift with a duration: a sustained force, `impulse` N·s per second, that steers the target
//   to a point (pull: the point reached; lift: LIFT_HEIGHT above where it was) and holds it there
//   until the duration ends. It is a damped approach: the speed asked for shrinks with the distance
//   left and with what the budget can brake, so the target settles on the point instead of swinging
//   through it. A heavier target accelerates slower (the same budget over more mass).
// - anchored things (neither pushable nor liftable: bolted down, part of the level) never move, and lift refuses anything over MAX_LIFTABLE_WEIGHT: the force does
//   nothing and `ForceResisted` fires, so a heavy thing visibly resists rather than being ignored.
//   Without a duration, pull is one impulse towards the point and lift one impulse upwards.

import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import type { System, World } from '../core/world';
import { applyCharacterImpulse } from '../character/impulse';
import { CharacterController } from '../character/system';
import { poiseOf } from '../combat/damage/components';
import { DAMAGE_TAGS } from '../combat/damage/packet';
import { hypot } from '../math';
import {
  PhysicsObjectComponent,
  rigidBodiesOf,
  setPhysicsObjectVelocity,
} from '../physics/objects';
import type { ColliderHandle } from '../physics/static-colliders';
import { readProperty } from '../properties/components';
import { placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { applyStimulus } from '../stimulus/stimulus';
import type { OpDetail } from './events';
import type { OpContext, OpOf } from './registry';
import { ForceResisted, type ForceResistedReason } from './tether';

/** The heaviest object a lift raises, kg. Above it the lift is resisted. */
export const MAX_LIFTABLE_WEIGHT = 250;
/** Poise damage per N·s of force: a 700 N·s shove costs 70 poise. */
export const FORCE_POISE_PER_IMPULSE = 0.1;
/** How far above where it was a lift holds its target, metres. */
export const LIFT_HEIGHT = 1.5;
/** A sustained force's top speed, m/s. */
export const FORCE_MAX_SPEED = 12;
/** Approach rate, 1/s: the speed asked for is this times the distance left (a critically damped approach). */
export const FORCE_APPROACH_RATE = 4;
/** Share of the budget's braking the approach plans on, so lag never overshoots. */
const BRAKE_SAFETY = 0.5;

/** One sustained force (a pull or a lift in progress). */
export interface SeekForce {
  readonly caster: EntityId;
  readonly target: EntityId;
  /** Where the target is steered to and held, metres. */
  readonly point: Vec3;
  /** N·s per second the force may spend. */
  readonly budget: number;
  /** First tick it is over. */
  readonly expiresTick: number;
}

/** Every sustained force (`magic.forces`; a snapshot and save key, never renamed). */
export interface ForceLedger {
  readonly forces: readonly SeekForce[];
}
export const ForceLedgerComponent = defineComponent<ForceLedger>('magic.forces');

const UP: Vec3 = Object.freeze({ x: 0, y: 1, z: 0 });

const minus = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const plus = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scaled = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const lengthOf = (a: Vec3): number => hypot(a.x, a.y, a.z);

/** The unit vector along `a`, or undefined for a zero (or non-finite) one. */
function unit(a: Vec3): Vec3 | undefined {
  const length = lengthOf(a);
  return length > 0 && Number.isFinite(length) ? scaled(a, 1 / length) : undefined;
}

/** Why a force cannot move `target`, with the limit it met (kg), or undefined when it can. */
export function resistanceTo(
  world: World<never>,
  target: EntityId,
  lifting: boolean,
):
  | { readonly weight: number; readonly limit: number; readonly reason: ForceResistedReason }
  | undefined {
  const weight = readProperty(world, target, 'weight');
  if (!readProperty(world, target, 'pushable') && !readProperty(world, target, 'liftable')) {
    return { weight, limit: 0, reason: 'anchored' };
  }
  if (lifting && weight > MAX_LIFTABLE_WEIGHT)
    return { weight, limit: MAX_LIFTABLE_WEIGHT, reason: 'overweight' };
  return undefined;
}

/** The velocity of a creature or physics object, or undefined for anything else. */
function velocityOf(world: World<never>, entity: EntityId): Vec3 | undefined {
  const character = world.get(entity, CharacterController);
  if (character !== undefined) return character.velocity;
  const object = world.get(entity, PhysicsObjectComponent);
  if (object === undefined) return undefined;
  return rigidBodiesOf(world).motionOf(object.body as ColliderHandle).linvel;
}

/** Changes `entity`'s velocity by `dv` at once (an object's body, or a creature's controller). */
function accelerate(world: World<never>, entity: EntityId, dv: Vec3, caster: EntityId): void {
  const object = world.get(entity, PhysicsObjectComponent);
  if (object !== undefined) {
    const now = rigidBodiesOf(world).motionOf(object.body as ColliderHandle).linvel;
    setPhysicsObjectVelocity(world, entity, plus(now, dv));
    return;
  }
  applyCharacterImpulse(world, entity, { velocity: dv, source: caster, stagger: false });
}

function ledgerOf(world: World<never>): readonly [EntityId, ForceLedger] | undefined {
  let found: readonly [EntityId, ForceLedger] | undefined;
  world.query(ForceLedgerComponent).forEach((id, ledger) => {
    found = [id, ledger];
  });
  return found;
}

/** The speed a sustained force asks of its target `distance` metres from the point (see the header). */
export function seekSpeed(distance: number, acceleration: number): number {
  return Math.min(
    FORCE_MAX_SPEED,
    FORCE_APPROACH_RATE * distance,
    Math.sqrt(2 * acceleration * BRAKE_SAFETY * distance),
  );
}

/** Steers one entry for a tick: the velocity change that tracks the damped approach, within budget. */
function seekStep(world: World<never>, force: SeekForce, hz: number): void {
  const at = placementOf(world, force.target);
  const velocity = velocityOf(world, force.target);
  if (at === undefined || velocity === undefined) return;
  const weight = Math.max(readProperty(world, force.target, 'weight'), 1e-6);
  const acceleration = force.budget / weight;
  const toPoint = minus(force.point, at);
  const distance = lengthOf(toPoint);
  // Towards the point at the speed asked for (nothing at the point itself).
  const wanted = scaled(toPoint, seekSpeed(distance, acceleration) / Math.max(distance, 1e-9));
  const change = minus(wanted, velocity);
  const most = acceleration / hz;
  const size = lengthOf(change);
  accelerate(world, force.target, size > most ? scaled(change, most / size) : change, force.caster);
}

/**
 * The system that steers every sustained force. Add it where the other force-driven systems run
 * (after the physics objects have published their poses); `installSpellForces` does.
 */
export function forceSystem(): System<never> {
  return {
    name: 'magic-forces',
    run: ({ world, tick, clock }) => {
      const entry = ledgerOf(world);
      if (entry === undefined) return;
      const [id, { forces }] = entry;
      const live = forces.filter(
        (f) => tick < f.expiresTick && world.isAlive(f.caster) && world.isAlive(f.target),
      );
      for (const force of live) seekStep(world, force, clock.hz);
      if (live.length !== forces.length) {
        world.set(id, ForceLedgerComponent, Object.freeze({ forces: Object.freeze(live) }));
      }
    },
  };
}

/** Makes `world` run sustained spell forces: registers the ledger and adds the system. Once, at setup. */
export function installSpellForces<W extends World<never>>(world: W): W {
  world.register(ForceLedgerComponent);
  world.add(world.spawn(), ForceLedgerComponent, Object.freeze({ forces: Object.freeze([]) }));
  world.addSystem(forceSystem());
  return world;
}

/** The sustained forces now acting, oldest first. */
export function activeForces(world: World<never>): readonly SeekForce[] {
  return ledgerOf(world)?.[1].forces ?? [];
}

/** The direction a one-shot force shoves `target` in (see the header), or up when it has none. */
function directionOf(
  ctx: OpContext,
  mode: OpOf<'force'>['mode'],
  at: Vec3,
  caster: Vec3 | undefined,
): Vec3 {
  const from = (a: Vec3, b: Vec3) => unit(minus(a, b));
  switch (mode) {
    case 'push':
      return from(at, ctx.point) ?? (caster === undefined ? undefined : from(at, caster)) ?? UP;
    case 'impulse':
      return (
        (caster === undefined ? undefined : from(ctx.point, caster)) ??
        (caster === undefined ? undefined : from(at, caster)) ??
        UP
      );
    case 'pull':
      return from(ctx.point, at) ?? UP;
    case 'lift':
      return UP;
  }
}

/** The force op (see the header). */
export function forceOp(ctx: OpContext, op: OpOf<'force'>): OpDetail | undefined {
  const { world, target, caster } = ctx;
  if (target === null) return undefined;
  const at = placementOf(world, target);
  if (at === undefined) return undefined;
  if (readProperty(world, target, 'weight') <= 0) return undefined;
  const lifting = op.mode === 'lift';
  const resisted = resistanceTo(world, target, lifting);
  if (resisted !== undefined) {
    world.events.emit(ForceResisted, {
      tick: world.tick,
      caster,
      spell: null,
      target,
      ...resisted,
    });
    return { mode: op.mode, resisted: true };
  }
  const sustained = op.duration > 0 && (op.mode === 'pull' || lifting);
  const ledger = sustained ? ledgerOf(world) : undefined;
  if (ledger !== undefined) {
    const [id, { forces }] = ledger;
    const point = lifting ? plus(at, scaled(UP, LIFT_HEIGHT)) : ctx.point;
    const next: SeekForce = {
      caster,
      target,
      point: Object.freeze({ x: point.x, y: point.y, z: point.z }),
      budget: op.impulse,
      expiresTick: world.tick + Math.max(1, Math.round(op.duration * world.clock.hz)),
    };
    const kept = forces.filter((f) => f.target !== target);
    world.set(id, ForceLedgerComponent, Object.freeze({ forces: Object.freeze([...kept, next]) }));
    return { mode: op.mode, impulse: op.impulse, sustained: true };
  }
  const direction = directionOf(ctx, op.mode, at, placementOf(world, caster));
  const moved = applyStimulus(world, {
    shape: { kind: 'contact', target },
    element: 'force',
    intensity: op.impulse,
    source: caster,
    direction,
  });
  if (!moved) return undefined;
  if (poiseOf(world, target) !== undefined) {
    ctx.damage.apply(world, target, {
      instigator: caster,
      source: ctx.delivery,
      amounts: {},
      poiseDamage: op.impulse * FORCE_POISE_PER_IMPULSE,
      direction,
      tags: [DAMAGE_TAGS.force],
    });
  }
  const weight = readProperty(world, target, 'weight');
  return {
    mode: op.mode,
    impulse: op.impulse,
    velocityChange: op.impulse / Math.max(weight, 1e-6),
  };
}
