// Pushing and pulling heavy objects (mw-e02.18): grab a crate or a statue with Interact, walk to push
// or pull it, let go with Interact again. Nothing here names an object type: what can be grabbed is
// the `pushable` property, how hard it is to move comes from its `weight` and the surface `friction`,
// and a rail, a grid or a turning step is data on a `push.config` component.
//
// - Speed: base × clamp(strength / (weight × friction × load), 0, 1). `base` is PUSH_BASE_SPEED
//   (1 m/s), `strength` the pusher's profile (a knight's is higher: class data), `weight` and
//   `friction` the object's properties (the surface's when a scene says what it stands on). `load` is
//   PUSH_LOAD_FACTOR: what a pusher's strength counts for against weight × friction (the pusher
//   leans into it). Ice (friction 0.05) never slows a pusher, stone (0.6) slows a heavy crate.
// - Movement: the object follows the pusher's move input (pushing or pulling alike) at that speed and
//   is swept first, so a wall or another object stops it short and it never penetrates. A push the
//   object cannot make holds the pusher too (`pushRestraint`: scale 0), so neither moves. A grabbed
//   pusher walks at the object's speed, may not sprint or jump (the same restraint path as carrying),
//   and a rail (`axis`) or a grid (`grid`, one cardinal axis at a time) limits where it goes.
// - Release: the object coasts on with the speed it had, decelerating at friction × g, so a crate
//   released on ice slides about a metre and one on stone stops at once. A grid object instead
//   completes to the next cell centre in the direction it was moving.
// - Rotate: a rotatable object (`rotateStep` > 0) turns by that step each time rotate is used, and
//   `rotationChanged` fires.
//
// Edge cases (as for carrying, mw-e17.14): a pusher who is staggered or knocked back lets go, so does
// one who starts any move (a kick, mw-e04.18: it never kicks what it holds), leaving
// the scene lets go, a save lets go of everything first (`settlePushes`; a grid glide completes), and
// a pusher more than PUSH_REACH from the object loses it.

import type { CollisionWorld } from '../character/collision-world';
import { PoiseBroken } from '../combat/damage/events';
import { reactionRank } from '../combat/reactions/components';
import { HitReaction } from '../combat/reactions/events';
import { ActionStarted } from '../combat/timeline/events';
import type { EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { actionFrameOf } from '../input/action-frame';
import type { Affordance } from '../interaction/affordance';
import { addAffordanceGate, interacted } from '../interaction/system';
import { handlerView, type ItemHandlerView } from '../items/world-items';
import { cos, hypot, sin } from '../math';
import type { BodyShape } from '../physics/bodies';
import { DEFAULT_GRAVITY } from '../physics/rapier';
import {
  PhysicsObjectComponent,
  teleportPhysicsObject,
  type PhysicsObject,
} from '../physics/objects';
import { readProperty } from '../properties/components';
import type { Quat } from '../scene/layout';
import { areaTransition } from '../scene/transitions';
import { holdOf } from '../carry/state';
import { placementOf } from '../stimulus/placement';
import {
  grabOf,
  grabberOf,
  grabsOf,
  PUSH_REFUSAL_TEXT,
  pushGrabbed,
  PushConfigComponent,
  PushLedgerComponent,
  pushReleased,
  rotationChanged,
  setPushPlanner,
  type Glide,
  type Grab,
  type PushConfig,
  type PushRefusal,
  type PushReleaseReason,
} from './state';

/** Speed of an object a pusher moves with no resistance at all, m/s. */
export const PUSH_BASE_SPEED = 1;
/** What a pusher's strength counts for against weight × friction (see the speed formula). */
export const PUSH_LOAD_FACTOR = 4;
/** Strength of a pusher whose class says nothing, in the units of weight (kg). */
export const DEFAULT_PUSH_STRENGTH = 100;
/** Below this share of base speed an object is too heavy to budge. */
export const MIN_PUSH_RATIO = 0.05;
/** The farthest a pusher may be from its object before it loses hold, metres. */
export const PUSH_REACH = 3;
/** How far short of an obstacle a pushed object stops, metres. */
export const PUSH_SKIN = 0.01;
/** Speed a grid object glides to its cell centre at, m/s. */
export const GRID_GLIDE_SPEED = 1;
/** The pusher's own top speed the walk scale is measured against, m/s (the run speed). */
export const DEFAULT_ACTOR_SPEED = 5;
/** A move input below this length asks for nothing. */
const DEAD_ZONE = 0.01;

const GRAVITY = -DEFAULT_GRAVITY.y;

/** How fast an object moves for a pusher: the formula in the header, m/s. */
export function pushSpeed(input: {
  readonly strength: number;
  readonly weight: number;
  readonly friction: number;
}): number {
  const resistance = input.weight * input.friction * PUSH_LOAD_FACTOR;
  const ratio = resistance <= 0 ? 1 : input.strength / resistance;
  return PUSH_BASE_SPEED * Math.min(1, Math.max(0, ratio));
}

export interface PushOptions<TInput> {
  /** Solid colliders a pushed object stops against. Omitted: none. */
  readonly collision?: CollisionWorld;
  /** Strength of `actor` (kg-equivalent; class data). Defaults to DEFAULT_PUSH_STRENGTH. */
  readonly strength?: (world: World<never>, actor: EntityId) => number;
  /** Friction of the surface `target` stands on. Defaults to the target's own `friction` property. */
  readonly surface?: (world: World<never>, target: EntityId) => number;
  /** The pusher's top speed, m/s. Defaults to DEFAULT_ACTOR_SPEED. */
  readonly actorSpeed?: number;
  /** Where `actor` stands and looks; defaults to `handlerView`. */
  readonly view?: (world: World<TInput>, actor: EntityId) => ItemHandlerView | undefined;
  /** This tick's move stick for `actor`; defaults to the tick's ActionFrame's. */
  readonly input?: (
    inputs: readonly TInput[],
    actor: EntityId,
  ) => { readonly x: number; readonly y: number } | undefined;
}

/** What the game keeps of the installed push rules. */
export interface PushController {
  /** The grab of `actor`, or undefined. */
  grabOf(actor: EntityId): Grab | undefined;
  /** `actor` takes hold of `target` (the Interact verb's own path); the refusal otherwise. */
  grab(actor: EntityId, target: EntityId): { ok: true } | { ok: false; reason: PushRefusal };
  /** Lets go of what `actor` has hold of. False when it holds nothing. */
  release(actor: EntityId): boolean;
  /** Turns `target` by its step; false when it is not rotatable. */
  rotate(actor: EntityId, target: EntityId): boolean;
  /** Lets go of everything and settles every glide, as a save does (`settlePushes`). */
  settleAll(): void;
}

/** Declares `target`'s constraints and rotation (a free pushable has none). */
export function addPushConfig(
  world: World<never>,
  target: EntityId,
  config: Partial<Omit<PushConfig, 'angle'>> = {},
): void {
  if (!world.isRegistered(PushConfigComponent)) world.register(PushConfigComponent);
  const { axis = null, grid = 0, rotateStep = 0 } = config;
  if (axis !== null) {
    const length = hypot(axis[0], axis[1]);
    if (Math.abs(length - 1) > 1e-6) throw new RangeError('axis must be a unit vector');
  }
  if (!Number.isFinite(grid) || grid < 0) throw new RangeError('grid must be ≥ 0');
  if (!Number.isFinite(rotateStep) || rotateStep < 0 || rotateStep > 180) {
    throw new RangeError('rotateStep must be 0…180 degrees');
  }
  world.add(target, PushConfigComponent, {
    axis: axis === null ? null : [axis[0], axis[1]],
    grid,
    rotateStep,
    angle: 0,
  });
}

const installed = new WeakMap<object, PushController>();

/**
 * Lets go of every grab in `world` and completes every grid glide, before a save is written: a save
 * never stores a grab. Does nothing where pushing is not installed.
 */
export function settlePushes(world: World<never>): void {
  installed.get(world)?.settleAll();
}

/** The horizontal reach of a body shape (radius) and half its height. */
function reachOf(shape: BodyShape): { readonly radius: number; readonly half: number } {
  switch (shape.kind) {
    case 'box':
      return {
        radius: Math.max(shape.halfExtents.x, shape.halfExtents.z),
        half: shape.halfExtents.y,
      };
    case 'sphere':
      return { radius: shape.radius, half: shape.radius };
    case 'capsule':
      return { radius: shape.radius, half: shape.halfHeight + shape.radius };
  }
}

const yawQuat = (degrees: number): Quat => {
  const half = (degrees * Math.PI) / 360;
  return { x: 0, y: sin(half), z: 0, w: cos(half) };
};

const multiply = (a: Quat, b: Quat): Quat => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});

/** Where a grid object ends up when released at coordinate `p` moving by `v` (cell centres at k·size). */
function cellCentre(p: number, v: number, size: number): number {
  if (v > 0) return Math.ceil(p / size - 1e-9) * size;
  if (v < 0) return Math.floor(p / size + 1e-9) * size;
  return Math.round(p / size) * size;
}

/**
 * Installs pushing in `world`: the ledger, the grab, release and rotate rules on the Interact verb and
 * the push system. The world needs physics objects (installPhysicsObjects), the interaction system
 * (installInteraction) and carrying (installCarry: a pusher's hands are the carry's too). Add it after
 * the systems that move actors. Once at setup, between steps.
 */
export function installPush<TInput>(
  world: World<TInput>,
  options: PushOptions<TInput> = {},
): PushController {
  const w: World<never> = world;
  const { collision } = options;
  const strengthOf = options.strength ?? (() => DEFAULT_PUSH_STRENGTH);
  const surfaceOf =
    options.surface ??
    ((_world: World<never>, target: EntityId) => readProperty(w, target, 'friction'));
  const actorSpeed = options.actorSpeed ?? DEFAULT_ACTOR_SPEED;
  const viewOf =
    options.view ?? ((_world: World<TInput>, actor: EntityId) => handlerView(w, actor));
  const moveOf =
    options.input ??
    ((inputs: readonly TInput[]): { readonly x: number; readonly y: number } | undefined =>
      actionFrameOf(inputs)?.move);
  const dt = 1 / w.clock.hz;
  w.register(PushLedgerComponent);
  if (!w.isRegistered(PushConfigComponent)) w.register(PushConfigComponent);
  const ledgerId = w.spawn();
  w.add(ledgerId, PushLedgerComponent, { grabs: [], glides: [] });
  // The ledger entity is made above and never destroyed.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const glidesOf = (): readonly Glide[] => w.get(ledgerId, PushLedgerComponent)!.glides;
  const putGrabs = (grabs: readonly Grab[]): void => {
    w.set(ledgerId, PushLedgerComponent, { grabs, glides: glidesOf() });
  };
  const putGlides = (glides: readonly Glide[]): void => {
    w.set(ledgerId, PushLedgerComponent, { grabs: grabsOf(w), glides });
  };

  const pushable = (target: EntityId): boolean =>
    w.isAlive(target) &&
    w.has(target, PhysicsObjectComponent) &&
    readProperty(w, target, 'pushable');

  /** Fastest speed `target` moves for `actor`, m/s. */
  const speedFor = (actor: EntityId, target: EntityId): number =>
    pushSpeed({
      strength: strengthOf(w, actor),
      weight: readProperty(w, target, 'weight'),
      friction: surfaceOf(w, target),
    });

  const refusalFor = (actor: EntityId, target: EntityId): PushRefusal | undefined => {
    if (!pushable(target)) return 'not-pushable';
    if (holdOf(w, actor) !== undefined || grabOf(w, actor) !== undefined) return 'hands-full';
    if (grabberOf(w, target) !== undefined) return 'held';
    return speedFor(actor, target) < PUSH_BASE_SPEED * MIN_PUSH_RATIO ? 'too-heavy' : undefined;
  };

  addAffordanceGate(world, (_w: World<never>, actor, target, affordance: Affordance) => {
    if (affordance.verb === 'pick-up') {
      return grabOf(w, actor) === undefined ? undefined : PUSH_REFUSAL_TEXT['hands-full'];
    }
    if (affordance.verb !== 'push') return undefined;
    // Interact on what you hold lets it go.
    if (grabOf(w, actor)?.target === target) return undefined;
    const refusal = refusalFor(actor, target);
    return refusal === undefined ? undefined : PUSH_REFUSAL_TEXT[refusal];
  });

  const configOf = (target: EntityId): PushConfig | undefined => w.get(target, PushConfigComponent);

  /** A swept move of `object` by `step` along unit `dir`: how far it may go, metres. */
  const freeDistance = (
    object: PhysicsObject,
    dir: { readonly x: number; readonly z: number },
    step: number,
  ): number => {
    if (collision === undefined) return step;
    const { radius, half } = reachOf(object.shape);
    const lift = 0.05;
    const height = Math.max(2 * radius, 2 * half - lift);
    const hit = collision.sweepCapsule(
      { radius, height },
      { x: object.position.x, y: object.position.y - half + lift, z: object.position.z },
      { x: dir.x, y: 0, z: dir.z },
      step + PUSH_SKIN,
      object.body,
    );
    return hit === undefined ? step : Math.max(0, hit.distance - PUSH_SKIN);
  };

  /** Moves `target` by `step` along `dir` if the way is clear; whether it moved. */
  const shove = (
    target: EntityId,
    dir: { readonly x: number; readonly z: number },
    step: number,
  ): boolean => {
    // Callers pass a pushable physics object and a positive step.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const object = w.get(target, PhysicsObjectComponent)!;
    if (freeDistance(object, dir, step) < step) return false;
    const { x, y, z } = object.position;
    teleportPhysicsObject(w, target, { x: x + dir.x * step, y, z: z + dir.z * step });
    return true;
  };

  /** The move a grab's input asks for: unit direction, share of full effort, and the speed, m/s. */
  const intent = (
    grab: Grab,
    move: { readonly x: number; readonly y: number },
    view: ItemHandlerView,
  ): { dir: { x: number; z: number }; speed: number } => {
    const effort = Math.min(1, hypot(move.x, move.y));
    const none = { dir: { x: 0, z: 0 }, speed: 0 };
    if (effort < DEAD_ZONE) return none;
    const sy = sin(view.yaw);
    const cy = cos(view.yaw);
    // Camera-relative, as the character controller reads the stick.
    const wx = cy * move.x - sy * move.y;
    const wz = -sy * move.x - cy * move.y;
    const length = hypot(wx, wz);
    let dir = { x: wx / length, z: wz / length };
    let amount = effort;
    const config = configOf(grab.target);
    if (config?.axis != null) {
      const along = dir.x * config.axis[0] + dir.z * config.axis[1];
      const sign = along < 0 ? -1 : 1;
      dir = { x: sign * config.axis[0], z: sign * config.axis[1] };
      amount *= Math.abs(along);
    } else if (config !== undefined && config.grid > 0) {
      const alongX = Math.abs(dir.x) >= Math.abs(dir.z);
      dir = alongX ? { x: Math.sign(dir.x), z: 0 } : { x: 0, z: Math.sign(dir.z) };
      amount *= Math.abs(alongX ? wx : wz) / length;
    }
    return { dir, speed: speedFor(grab.actor, grab.target) * amount };
  };

  /** What share of its speed `actor` keeps this tick: 0 when the object cannot go where it pushes. */
  const planScale = (actor: EntityId, move: { readonly x: number; readonly y: number }): number => {
    // Asked through pushRestraint, which has checked that `actor` has hold of something.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const grab = grabOf(w, actor)!;
    const view = viewOf(world, actor);
    const object = w.get(grab.target, PhysicsObjectComponent);
    if (view === undefined || object === undefined) return 1;
    const { dir, speed } = intent(grab, move, view);
    if (speed <= 0) return 1;
    const step = speed * dt;
    if (freeDistance(object, dir, step) < step) return 0;
    return Math.min(1, speedFor(actor, grab.target) / actorSpeed);
  };
  setPushPlanner(w, planScale);

  const putGrab = (next: Grab): void => {
    putGrabs(grabsOf(w).map((grab) => (grab.actor === next.actor ? next : grab)));
  };

  const withGlide = (rest: readonly Glide[], glide: Glide): Glide[] =>
    [...rest, glide].sort((a, b) => a.target - b.target);

  /** Starts `target` gliding after a release with velocity (vx, vz), per its config. */
  const startGlide = (target: EntityId, vx: number, vz: number): void => {
    const rest = glidesOf().filter((glide) => glide.target !== target);
    // Only a physics object is ever released.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const at = w.get(target, PhysicsObjectComponent)!.position;
    const config = configOf(target);
    if (config !== undefined && config.grid > 0) {
      const alongX = Math.abs(vx) >= Math.abs(vz);
      const goal = {
        x: alongX
          ? cellCentre(at.x, vx, config.grid)
          : Math.round(at.x / config.grid) * config.grid,
        z: alongX
          ? Math.round(at.z / config.grid) * config.grid
          : cellCentre(at.z, vz, config.grid),
      };
      putGlides(withGlide(rest, { target, vx: 0, vz: 0, goal }));
    } else if (vx !== 0 || vz !== 0) {
      putGlides(withGlide(rest, { target, vx, vz, goal: null }));
    } else putGlides(rest);
  };

  const release = (grab: Grab, reason: PushReleaseReason, momentum = true): void => {
    putGrabs(grabsOf(w).filter((held) => held.actor !== grab.actor));
    if (w.isAlive(grab.target) && w.has(grab.target, PhysicsObjectComponent)) {
      startGlide(grab.target, momentum ? grab.vx : 0, momentum ? grab.vz : 0);
    }
    w.events.emit(pushReleased, {
      tick: w.tick,
      actor: grab.actor,
      target: grab.target,
      reason,
    });
  };

  const grab: PushController['grab'] = (actor, target) => {
    const reason = refusalFor(actor, target);
    if (reason !== undefined) return { ok: false, reason };
    putGrabs(
      [...grabsOf(w), { actor, target, since: w.tick, vx: 0, vz: 0 }].sort(
        (a, b) => a.actor - b.actor,
      ),
    );
    putGlides(glidesOf().filter((glide) => glide.target !== target));
    w.events.emit(pushGrabbed, {
      tick: w.tick,
      actor,
      target,
      weight: readProperty(w, target, 'weight'),
      speed: speedFor(actor, target),
    });
    return { ok: true };
  };

  const rotate: PushController['rotate'] = (actor, target) => {
    const config = configOf(target);
    const object = w.get(target, PhysicsObjectComponent);
    if (config === undefined || config.rotateStep <= 0 || object === undefined) return false;
    const angle = (config.angle + config.rotateStep) % 360;
    w.set(target, PushConfigComponent, { ...config, angle });
    teleportPhysicsObject(
      w,
      target,
      object.position,
      multiply(yawQuat(config.rotateStep), object.rotation),
    );
    w.events.emit(rotationChanged, {
      tick: w.tick,
      actor,
      target,
      step: config.rotateStep,
      angle,
    });
    return true;
  };

  const controller: PushController = {
    grabOf: (actor) => grabOf(w, actor),
    grab,
    release(actor) {
      const held = grabOf(w, actor);
      if (held === undefined) return false;
      release(held, 'released');
      return true;
    },
    rotate,
    settleAll() {
      for (const held of grabsOf(w)) release(held, 'saved', false);
      for (const glide of glidesOf()) {
        const object = w.get(glide.target, PhysicsObjectComponent);
        if (glide.goal !== null && object !== undefined) {
          teleportPhysicsObject(w, glide.target, {
            x: glide.goal.x,
            y: object.position.y,
            z: glide.goal.z,
          });
        }
      }
      putGlides([]);
    },
  };
  installed.set(world, controller);

  w.events.on(interacted, ({ actor, target, verb }) => {
    if (verb === 'rotate') {
      rotate(actor, target);
    } else if (verb === 'push' || verb === 'release') {
      const held = grabOf(w, actor);
      if (held?.target === target) release(held, 'released');
      else if (verb === 'push') grab(actor, target);
    }
  });

  const staggered = (actor: EntityId): void => {
    const held = grabOf(w, actor);
    if (held !== undefined) release(held, 'staggered', false);
  };
  w.events.on(PoiseBroken, ({ target }) => {
    staggered(target);
  });
  w.events.on(HitReaction, ({ entity, reaction }) => {
    if (reactionRank(reaction) >= reactionRank('stagger')) staggered(entity);
  });
  // A grabber that starts a move (a kick, a swing, a roll) has its hands free for it: it lets go
  // first, so it never kicks the thing it holds (mw-e04.18).
  w.events.on(ActionStarted, ({ entity }) => {
    const held = grabOf(w, entity);
    if (held !== undefined) release(held, 'acted', false);
  });
  w.events.on(areaTransition, ({ entity }) => {
    const held = grabOf(w, entity);
    if (held !== undefined) release(held, 'exit', false);
  });

  const system: System<TInput> = {
    name: 'push',
    run({ inputs }) {
      for (const held of grabsOf(w)) {
        const { actor, target } = held;
        const view = w.isAlive(actor) && pushable(target) ? viewOf(world, actor) : undefined;
        const at = view === undefined ? undefined : placementOf(w, target);
        if (view === undefined || at === undefined) {
          release(held, 'lost', false);
          continue;
        }
        if (hypot(at.x - view.feet.x, at.z - view.feet.z) > PUSH_REACH) {
          release(held, 'far', false);
          continue;
        }
        const move = moveOf(inputs, actor) ?? { x: 0, y: 0 };
        const { dir, speed } = intent(held, move, view);
        const moved = speed > 0 && shove(target, dir, speed * dt);
        const vx = moved ? dir.x * speed : 0;
        const vz = moved ? dir.z * speed : 0;
        if (vx !== held.vx || vz !== held.vz) putGrab({ ...held, vx, vz });
      }
      // Objects gliding on after a release.
      const glides: Glide[] = [];
      for (const glide of glidesOf()) {
        const object = w.get(glide.target, PhysicsObjectComponent);
        if (!w.isAlive(glide.target) || object === undefined) continue;
        if (glide.goal !== null) {
          const gx = glide.goal.x - object.position.x;
          const gz = glide.goal.z - object.position.z;
          const distance = hypot(gx, gz);
          if (distance < 1e-6) continue;
          const step = Math.min(distance, GRID_GLIDE_SPEED * dt);
          if (shove(glide.target, { x: gx / distance, z: gz / distance }, step)) {
            if (step < distance) glides.push(glide);
            else {
              const { y } = object.position;
              teleportPhysicsObject(w, glide.target, { x: glide.goal.x, y, z: glide.goal.z });
            }
          }
          continue;
        }
        const speed = hypot(glide.vx, glide.vz);
        const dir = { x: glide.vx / speed, z: glide.vz / speed };
        if (!shove(glide.target, dir, speed * dt)) continue;
        const next = speed - surfaceOf(w, glide.target) * GRAVITY * dt;
        if (next > 0) {
          glides.push({ ...glide, vx: dir.x * next, vz: dir.z * next });
        }
      }
      const before = glidesOf();
      if (glides.length !== before.length || glides.some((g, i) => g !== before[i])) {
        putGlides(glides);
      }
    },
  };
  world.addSystem(system);
  return controller;
}
