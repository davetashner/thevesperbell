// The kick (mw-e04.18): the knight's boot, a cheap shove for what a sword is wrong for. Like the shield
// bash it is an ordinary move from content (`kick`: 10/3/16 ticks, 8 stamina, 3 blunt, 20 poise, and a
// world impact that shoves things up to 40 kg), and everything a kick does to a hurtbox or to a
// shovable thing comes from the same rules as every other blow: strikes.ts applies the move's world
// impact (a kicked 25 kg crate takes the impulse and slides, a 50 kg one resists; a kicked burning
// brazier is moved by physics into whatever it meets, and fire spreads from there by properties, with
// no brazier-and-rug pairing anywhere). This file adds the three things a kick has that a swing does
// not, each keyed by data or by a property and never by what the thing is:
//
// - Doors. A closed, unlocked door the kick reaches is slammed open (`slamDoor`: several times the
//   speed of a hand on it). A creature in the way takes the kick's blunt damage and poise damage from
//   the door, so it flinches, and the door stops against it (doorBlocked, `slammedBy`). A locked or
//   jammed door does not move: ImpactResisted, as for anything too heavy to shove, plus a noise.
// - Small creatures. A creature whose size class is `small` (`sizeOf`, from its creature data) that a
//   kick connects with is knocked back by the kick's impulse through the hit reactions (mw-e04.7), so
//   the usual rules carry it: physics and gravity take it over a ledge. Larger creatures just take
//   the hit's flinch.
// - Hands. The grab (src/sim/push) lets go when its holder starts a move, so a kick never hits what
//   the kicker is holding.

import type { MoveTable, RuntimeMove } from '@content/index';
import type { EntityId } from '../../core/component';
import type { World } from '../../core/world';
import { DoorComponent } from '../../mechanisms/components';
import { doorBlocked } from '../../mechanisms/events';
import { doorStatus, slamDoor } from '../../mechanisms/system';
import { noiseEmitted } from '../../noise/events';
import { readProperty } from '../../properties/components';
import { hypot } from '../../math';
import { boundingSphereOf, placementOf, type Placement } from '../../stimulus/placement';
import { shapeFalloff, type StimulusShape, type Vec3 } from '../../stimulus/shapes';
import { ImpactResisted } from '../../stimulus/stimulus';
import type { DamageModel } from '../damage/model';
import { HealthComponent } from '../damage/components';
import type { SocketTrackLookup } from '../hits/system';
import { moveTrack } from '../hits/system';
import { applyHitReaction, type HitReactionOptions } from '../reactions/reactions';
import { reactionOf } from '../reactions/components';
import { ActionPhaseChanged } from '../timeline/events';
import { facingOf } from './components';
import { MoveStruck } from './events';
import { worldImpactShape } from './strikes';

/** Loudness of a kick that bounces off a locked or jammed door, dB 1 m away (a placeholder). */
export const KICK_RESISTED_LOUDNESS = 70;

/** What the kick rules need. */
export interface KickOptions {
  /** Every move the fighters may perform. */
  readonly moves: MoveTable;
  /** The socket tracks their hitboxes sweep along. */
  readonly tracks: SocketTrackLookup;
  /** The damage model a slammed door's blow goes through. */
  readonly damage: DamageModel;
  /** The hit-reaction rules a small creature's knockback is imposed through. */
  readonly reactions: HitReactionOptions;
  /** The move that is the kick, e.g. `kick`. */
  readonly move: string;
  /** A creature's size class (`small`, …), or undefined for what is not a creature. */
  readonly sizeOf: (world: World<never>, entity: EntityId) => string | undefined;
}

/** The size class a kick knocks back. */
export const KICK_KNOCKBACK_SIZE = 'small';

/** Where a placed entity is: doors and what they hit always are (a placement is how they are found). */
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const placed = (world: World<never>, entity: EntityId): Placement => placementOf(world, entity)!;

/** Whether a kick's reach touches `door` (its bounding sphere meets the shape). */
function reaches(world: World<never>, shape: StimulusShape, door: EntityId): boolean {
  const at = boundingSphereOf(world, door, placed(world, door));
  return shapeFalloff(shape, 'none', at, at.radius) !== undefined;
}

/** What a kick does to the doors it reaches. */
function kickDoors(
  world: World<never>,
  kicker: EntityId,
  move: RuntimeMove,
  shape: StimulusShape,
  facing: Vec3,
): void {
  for (const door of [...world.query(DoorComponent).ids()]) {
    if (!reaches(world, shape, door)) continue;
    const status = doorStatus(world, door);
    if (status === 'closed') {
      slamDoor(world, door, kicker);
    } else if (status === 'locked' || status === 'jammed') {
      const { x, y, z } = placed(world, door);
      const force = move.worldImpact?.force ?? 0;
      world.events.emit(ImpactResisted, {
        tick: world.tick,
        entity: door,
        weight: readProperty(world, door, 'weight'),
        maxWeight: move.worldImpact?.maxWeight ?? 0,
        impulse: { x: facing.x * force, y: facing.y * force, z: facing.z * force },
        source: kicker,
      });
      world.events.emit(noiseEmitted, {
        tick: world.tick,
        position: { x, y, z },
        loudness: KICK_RESISTED_LOUDNESS,
        kind: 'kick',
        entity: door,
        source: kicker,
      });
    }
  }
}

/**
 * Wires the kick's extra rules into `world` (see the file header). Install the melee strikes and hit
 * reactions first. Returns a function that removes the subscriptions.
 */
export function installKick<TInput>(world: World<TInput>, options: KickOptions): () => void {
  const { moves, tracks, damage, reactions, move: kickId, sizeOf } = options;
  const w: World<never> = world;
  const kick = moves.get(kickId);
  const template = kick?.damage;
  if (kick === undefined || kick.hitbox === null || template == null) {
    throw new Error(`the kick move "${kickId}" is missing, or has no hitbox or damage`);
  }
  const offs = [
    world.events.on(ActionPhaseChanged, ({ entity, move, phase }) => {
      if (move !== kickId || phase !== 'active') return;
      const facing = facingOf(w, entity);
      const shape = worldImpactShape(w, entity, kick, moveTrack(kick, tracks), facing);
      if (shape !== undefined) kickDoors(w, entity, kick, shape, facing);
    }),
    world.events.on(doorBlocked, ({ entity: door, by, slammedBy }) => {
      if (slammedBy === undefined || !w.has(by, HealthComponent)) return;
      const doorAt = placed(w, door);
      const bodyAt = placed(w, by);
      // Along the floor, from the door's middle to the body (never a zero length).
      const dx = bodyAt.x - doorAt.x;
      const dz = bodyAt.z - doorAt.z;
      const length = Math.max(hypot(dx, dz), 1e-6);
      damage.apply(w, by, {
        ...template,
        impulse: { x: 0, y: 0, z: 0 },
        instigator: slammedBy,
        source: door,
        direction: { x: dx / length, y: 0, z: dz / length },
      });
    }),
    world.events.on(MoveStruck, ({ attacker, move, target, result }) => {
      if (move !== kickId || result === null || result.died) return;
      if (result.tags.includes('blocked') || sizeOf(w, target) !== KICK_KNOCKBACK_SIZE) return;
      applyHitReaction(
        w,
        target,
        {
          kind: 'knockback',
          direction: reactionOf(w, target)?.direction ?? 'front',
          impulse: result.packet.impulse,
          instigator: attacker,
          source: result.packet.source,
        },
        reactions,
      );
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
