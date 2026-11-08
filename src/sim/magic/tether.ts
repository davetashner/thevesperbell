// The tether delivery (mw-e08.10): a sustained link from the caster to one object, the verb behind
// Mage Hand. A spell with a `tether` delivery grabs the object it is aimed at (a chosen `target`, else
// the nearest thing near the aim point that can be moved or used), and from then on:
//
// - a movable object (a liftable physics object) is held with the remote-hold spring-damper
//   (`remote-hold.ts`, mw-e03.47): the delivery's weight limit is the grip strength, the hold point
//   follows the aim point at up to `speed` m/s, and the body is steered to it by physics, so it is
//   stopped by solid geometry rather than passing through it (a hold jammed against geometry for a
//   second breaks as obstructed), and it lets go with whatever velocity it has;
// - `use` performs the object's primary interact verb for the caster through the Interact verb's own
//   door (`interactRemotely`), so a lever pulled from afar is exactly a lever pulled by hand; only a
//   `remoteActuatable` thing can be used (or grabbed just to be used) from afar;
// - the tether lets go on release, when the caster's channel ends, when the hold runs out, when the
//   object passes beyond range, when either party is gone, when the caster is staggered or leaves the
//   scene, when the remote hold breaks (obstructed, overloaded, saved, taken over), or when line of
//   sight has been broken for longer than `lineOfSightGrace` seconds (the object holds still meanwhile).
//
// An object above the weight limit is not lifted: `ForceResisted` (reason `overweight`) fires and the
// cast fizzles (`too-heavy`); one that is not liftable fizzles `not-liftable`. Nothing here names a spell; every number comes from the delivery section. Deliberately
// powerful (constitution §4): the only balance is mana, cast time and cooldown, never exceptions for
// particular objects.

import type { BodyId } from '../character/collision-world';
import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { HitReaction } from '../combat/reactions/events';
import { reactionRank } from '../combat/reactions/components';
import { PoiseBroken } from '../combat/damage/events';
import { areaTransition } from '../scene/transitions';
import { affordancesOf, interactRemotely, physicsBodiesOf, remoteAffordance } from '../interaction';
import { PhysicsObjectComponent } from '../physics/objects';
import { PlayerLook } from '../player/player';
import { readProperty } from '../properties/components';
import type { SightWorld } from '../sight/sight-world';
import { hypot, cos, sin } from '../math';
import { PlacementComponent, placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { castStateOf, ChannelEnded, type CastController } from './casting';
import type { SpellPipeline } from './pipeline';
import { ForceResisted } from './resisted';
import type { DeliveryContext, DeliveryResult } from './registry';
import {
  canHoldRemotely,
  holdOnTarget,
  holdRemotely,
  releaseHold,
  RemoteHoldReleased,
  setHoldPoint,
} from './remote-hold';

/** Height of the caster's eye above its placement (feet), metres. */
export const TETHER_EYE_HEIGHT = 1.5;

/** One live tether (a row of `magic.tethers`). */
export interface Tether {
  readonly caster: EntityId;
  readonly target: EntityId;
  readonly spell: string;
  /** Whether the target is a physics object the tether carries (else it can only be used). */
  readonly movable: boolean;
  /** How far in front of the eye a held object sits, metres (what it was grabbed at, within range). */
  readonly distance: number;
  readonly range: number;
  readonly speed: number;
  readonly graceTicks: number;
  /** First tick the hold is over. */
  readonly expiresTick: number;
  /** Tick line of sight was first found broken, or null while it is clear. */
  readonly blockedSince: number | null;
}

/** Every tether on one ledger entity (`magic.tethers`). */
export interface TetherLedger {
  readonly tethers: readonly Tether[];
}
export const TetherLedgerComponent = defineComponent<TetherLedger>('magic.tethers');

export type TetherReleaseReason =
  | 'player'
  | 'channel-ended'
  | 'expired'
  | 'out-of-range'
  | 'line-of-sight'
  | 'lost'
  | 'replaced'
  | 'staggered'
  | 'exit'
  | 'hold-broken';

export interface TetherGrabbedInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly target: EntityId;
  readonly spell: string;
  readonly movable: boolean;
}
export const TetherGrabbed = defineEvent<TetherGrabbedInfo>('TetherGrabbed');

export interface TetherReleasedInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly target: EntityId;
  readonly spell: string;
  readonly reason: TetherReleaseReason;
}
export const TetherReleased = defineEvent<TetherReleasedInfo>('TetherReleased');

export interface TetherUsedInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly target: EntityId;
  /** The interact verb performed. */
  readonly verb: string;
}
export const TetherUsed = defineEvent<TetherUsedInfo>('TetherUsed');

export { ForceResisted, type ForceResistedInfo, type ForceResistedReason } from './resisted';

/** The input command that uses the held object. */
export interface TetherUseCommand {
  readonly type: 'tether-use';
  readonly caster: EntityId;
}
/** The input command that lets go. */
export interface TetherReleaseCommand {
  readonly type: 'tether-release';
  readonly caster: EntityId;
}
const isCommand = (input: unknown, type: string): boolean =>
  typeof input === 'object' && input !== null && (input as { type?: unknown }).type === type;
export const isTetherUseCommand = (input: unknown): input is TetherUseCommand =>
  isCommand(input, 'tether-use');
export const isTetherReleaseCommand = (input: unknown): input is TetherReleaseCommand =>
  isCommand(input, 'tether-release');

export interface SpellTetherOptions {
  /** Solid colliders that block the tether (RapierSightWorld in the game). Omitted: nothing blocks. */
  readonly sight?: SightWorld;
  /** Colliders belonging to an entity, which never block the tether to it; default `physicsBodiesOf`. */
  readonly bodiesOf?: (world: World<never>, entity: EntityId) => readonly BodyId[];
  /** The caster's eye; defaults to its placement raised by TETHER_EYE_HEIGHT. */
  readonly eye?: (world: World<never>, caster: EntityId) => Vec3 | undefined;
  /**
   * Where the caster wants a held object, given how far out it was grabbed. Defaults to that distance
   * along the caster's look (PlayerLook); none: the object stays where it is.
   */
  readonly aim?: (world: World<never>, caster: EntityId, distance: number) => Vec3 | undefined;
  /** Ends the caster's channel when the tether lets go (the casting controller). */
  readonly casting?: Pick<CastController, 'cancel'>;
}

/** What the game keeps of the installed tether. */
export interface TetherController {
  /** The object `caster` holds, or null. */
  heldBy(caster: EntityId): EntityId | null;
  /** The tether `caster` has, or undefined. */
  tetherOf(caster: EntityId): Tether | undefined;
  /** Uses the held object's primary affordance; false when nothing held, out of reach, or unusable. */
  use(caster: EntityId): boolean;
  /** Whether `use` would work now: something held, in reach and in sight, with a usable affordance. */
  canUse(caster: EntityId): boolean;
  /** Lets go (ends the caster's channel too); false when nothing was held. */
  release(caster: EntityId): boolean;
}

const distanceBetween = (a: Vec3, b: Vec3): number => hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** The point `distance` metres along a look (yaw about +y, 0 faces −z; pitch above the horizon). */
function along(eye: Vec3, look: { yaw: number; pitch: number }, distance: number): Vec3 {
  const flat = cos(look.pitch);
  return {
    x: eye.x - sin(look.yaw) * flat * distance,
    y: eye.y + sin(look.pitch) * distance,
    z: eye.z - cos(look.yaw) * flat * distance,
  };
}

/** Wires tether spells into a world that has `installSpells`. Once at setup, outside a step. */
export function installSpellTether<TInput>(
  world: World<TInput>,
  pipeline: SpellPipeline,
  options: SpellTetherOptions = {},
): TetherController {
  const w: World<never> = world;
  const { sight } = options;
  const bodiesOf = options.bodiesOf ?? physicsBodiesOf;
  const eyeOf =
    options.eye ??
    ((_w: World<never>, caster: EntityId): Vec3 | undefined => {
      const at = placementOf(w, caster);
      return at === undefined ? undefined : { x: at.x, y: at.y + TETHER_EYE_HEIGHT, z: at.z };
    });
  const aimOf =
    options.aim ??
    ((_w: World<never>, caster: EntityId, distance: number): Vec3 | undefined => {
      const look = w.get(caster, PlayerLook);
      const eye = eyeOf(w, caster);
      return look === undefined || eye === undefined ? undefined : along(eye, look, distance);
    });

  w.register(TetherLedgerComponent);
  const ledgerId = w.spawn();
  w.add(ledgerId, TetherLedgerComponent, { tethers: [] });
  // the ledger entity is made above and never destroyed
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const ledger = (): readonly Tether[] => w.get(ledgerId, TetherLedgerComponent)!.tethers;
  const putAll = (tethers: readonly Tether[]): void => {
    w.set(ledgerId, TetherLedgerComponent, { tethers });
  };
  const tetherOf = (caster: EntityId): Tether | undefined =>
    ledger().find((t) => t.caster === caster);
  const put = (next: Tether): void => {
    putAll(ledger().map((t) => (t.caster === next.caster ? next : t)));
  };

  /** Whether nothing solid but `target`'s own colliders lies between `from` and `to`. */
  const clear = (target: EntityId, from: Vec3, to: Vec3): boolean => {
    if (sight === undefined) return true;
    if (from.x === to.x && from.y === to.y && from.z === to.z) return true;
    const own = bodiesOf(w, target);
    let free = true;
    sight.forEachCrossing(from, to, (body) => {
      free = own.includes(body);
      return free;
    });
    return free;
  };

  const release = (caster: EntityId, reason: TetherReleaseReason, endChannel = true): boolean => {
    const held = tetherOf(caster);
    if (held === undefined) return false;
    putAll(ledger().filter((t) => t !== held));
    if (held.movable) releaseHold(w, held.target);
    w.events.emit(TetherReleased, {
      tick: w.tick,
      caster,
      target: held.target,
      spell: held.spell,
      reason,
    });
    if (endChannel && options.casting !== undefined) {
      const cast = castStateOf(w, caster);
      if (cast?.spell === held.spell && cast.phase === 'channeling') options.casting.cancel(caster);
    }
    return true;
  };

  /** Something to tether near `aim`: the closest movable or usable thing, by surface distance. */
  const pickAt = (caster: EntityId, aim: Vec3, radius: number): EntityId | undefined => {
    let best: EntityId | undefined;
    let bestGap = radius;
    w.query(PlacementComponent).forEach((entity, at) => {
      if (entity === caster) return;
      if (!w.has(entity, PhysicsObjectComponent) && affordancesOf(w, entity).length === 0) return;
      const gap = Math.max(0, distanceBetween(aim, at) - at.radius);
      if (gap < bestGap) {
        best = entity;
        bestGap = gap;
      }
    });
    return best;
  };

  pipeline.deliveries.register('tether', (ctx: DeliveryContext<'tether'>): DeliveryResult => {
    const { request, delivery, spell } = ctx;
    const { caster } = request;
    const held = tetherOf(caster);
    const target =
      request.target ??
      (request.aim === undefined ? undefined : pickAt(caster, request.aim, delivery.pickRadius));
    // A channel's later ticks come back here: the tether stands, nothing is grabbed again.
    if (held !== undefined && (target === undefined || target === held.target)) {
      return { kind: 'hits', hits: [] };
    }
    if (target === undefined || target === caster || !w.isAlive(target)) {
      return { kind: 'fizzle', reason: 'no-target' };
    }
    const eye = eyeOf(w, caster);
    const at = placementOf(w, target);
    if (eye === undefined || at === undefined) return { kind: 'fizzle', reason: 'no-position' };
    const movable = w.has(target, PhysicsObjectComponent);
    if (!movable && (affordancesOf(w, target).length === 0 || !actuatable(target))) {
      return { kind: 'fizzle', reason: 'not-tetherable' };
    }
    const distance = distanceBetween(eye, at);
    if (distance - at.radius > delivery.range) return { kind: 'fizzle', reason: 'out-of-reach' };
    if (!clear(target, eye, at)) return { kind: 'fizzle', reason: 'blocked' };
    if (movable) {
      const grip = canHoldRemotely(w, target, delivery.maxWeight);
      if (!grip.ok && grip.reason === 'overweight') {
        w.events.emit(ForceResisted, {
          tick: w.tick,
          caster,
          spell: spell.id,
          target,
          weight: readProperty(w, target, 'weight'),
          limit: delivery.maxWeight,
          reason: 'overweight',
        });
        return { kind: 'fizzle', reason: 'too-heavy' };
      }
      if (!grip.ok) return { kind: 'fizzle', reason: 'not-liftable' };
    }
    release(caster, 'replaced', false);
    if (movable) holdRemotely(w, caster, target, at, delivery.maxWeight);
    const hz = w.clock.hz;
    putAll([
      ...ledger(),
      {
        caster,
        target,
        spell: spell.id,
        movable,
        distance: Math.min(distance, delivery.range),
        range: delivery.range,
        speed: delivery.speed,
        graceTicks: Math.round(delivery.lineOfSightGrace * hz),
        expiresTick: w.tick + Math.max(1, Math.round(delivery.maxHold * hz)),
        blockedSince: null,
      },
    ]);
    w.events.emit(TetherGrabbed, { tick: w.tick, caster, target, spell: spell.id, movable });
    return { kind: 'hits', hits: [{ target, point: { x: at.x, y: at.y, z: at.z } }] };
  });

  /** Whether `target` may be used from afar (the `remoteActuatable` property). */
  const actuatable = (target: EntityId): boolean => readProperty(w, target, 'remoteActuatable');

  /** The held tether, when its target is in reach and sight. */
  const usableTether = (caster: EntityId): Tether | undefined => {
    const held = tetherOf(caster);
    if (held === undefined) return undefined;
    const eye = eyeOf(w, caster);
    const at = placementOf(w, held.target);
    if (eye === undefined || at === undefined) return undefined;
    if (distanceBetween(eye, at) - at.radius > held.range || !clear(held.target, eye, at)) {
      return undefined;
    }
    return held;
  };

  const use = (caster: EntityId): boolean => {
    const held = usableTether(caster);
    if (held === undefined || !actuatable(held.target)) return false;
    const done = interactRemotely(w, caster, held.target);
    if (done === undefined) return false;
    w.events.emit(TetherUsed, {
      tick: w.tick,
      caster,
      target: held.target,
      verb: done.verb,
    });
    return true;
  };

  /** One tick of one tether: lose, expire, check sight, then carry a movable object toward the aim. */
  const step = (held: Tether, tick: number, dt: number): void => {
    const { caster, target } = held;
    const eye = eyeOf(w, caster);
    const at = placementOf(w, target);
    const object = w.get(target, PhysicsObjectComponent);
    if (
      !w.isAlive(caster) ||
      !w.isAlive(target) ||
      eye === undefined ||
      at === undefined ||
      (held.movable && object === undefined)
    ) {
      release(caster, 'lost');
      return;
    }
    if (tick >= held.expiresTick) {
      release(caster, 'expired');
      return;
    }
    if (distanceBetween(eye, at) - at.radius > held.range) {
      release(caster, 'out-of-range');
      return;
    }
    const seen = clear(target, eye, at);
    if (!seen) {
      const since = held.blockedSince ?? tick;
      if (tick - since > held.graceTicks) {
        release(caster, 'line-of-sight');
        return;
      }
      if (held.blockedSince === null) put({ ...held, blockedSince: since });
    } else if (held.blockedSince !== null) {
      put({ ...held, blockedSince: null });
    }
    if (!held.movable) return;
    // Move the hold point a step toward the aim point (the spring carries the body after it); with
    // line of sight lost the point stays and the object holds still.
    const wanted = seen ? aimOf(w, caster, held.distance) : undefined;
    if (wanted === undefined) return;
    const reach = distanceBetween(eye, wanted);
    const k = reach > held.range ? held.range / reach : 1;
    const goal = {
      x: eye.x + (wanted.x - eye.x) * k,
      y: eye.y + (wanted.y - eye.y) * k,
      z: eye.z + (wanted.z - eye.z) * k,
    };
    // the hold is made at the grab and the tether lets go the moment it breaks
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const from = holdOnTarget(w, target)!.point;
    const gap = distanceBetween(from, goal);
    const reachStep = held.speed * dt;
    const f = gap <= reachStep ? 1 : reachStep / gap;
    setHoldPoint(w, target, {
      x: from.x + (goal.x - from.x) * f,
      y: from.y + (goal.y - from.y) * f,
      z: from.z + (goal.z - from.z) * f,
    });
  };

  world.addSystem({
    name: 'spell-tether',
    run: ({ inputs, tick, clock }) => {
      for (const input of inputs) {
        if (isTetherReleaseCommand(input)) release(input.caster, 'player');
        else if (isTetherUseCommand(input)) use(input.caster);
      }
      const dt = 1 / clock.hz;
      for (const held of ledger()) step(held, tick, dt);
    },
  } satisfies System<TInput>);

  // The remote hold breaking under the tether (jammed, overloaded, saved, taken over) ends the tether.
  w.events.on(RemoteHoldReleased, ({ holder, target, reason }) => {
    const held = tetherOf(holder);
    if (held?.target === target) release(holder, reason === 'lost' ? 'lost' : 'hold-broken');
  });
  // A staggered caster loses its grip; leaving the scene ends the tether (objects never cross a load).
  const staggered = (caster: EntityId): void => {
    release(caster, 'staggered');
  };
  w.events.on(PoiseBroken, ({ target }) => {
    staggered(target);
  });
  w.events.on(HitReaction, ({ entity, reaction }) => {
    if (reactionRank(reaction) >= reactionRank('stagger')) staggered(entity);
  });
  w.events.on(areaTransition, ({ entity }) => {
    release(entity, 'exit');
  });

  w.events.on(ChannelEnded, ({ caster, spell }) => {
    if (tetherOf(caster)?.spell === spell) release(caster, 'channel-ended', false);
  });

  return {
    heldBy: (caster) => tetherOf(caster)?.target ?? null,
    tetherOf,
    use,
    canUse: (caster) => {
      const held = usableTether(caster);
      return (
        held !== undefined &&
        actuatable(held.target) &&
        remoteAffordance(w, caster, held.target) !== undefined
      );
    },
    release: (caster) => release(caster, 'player'),
  };
}
