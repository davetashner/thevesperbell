// Melee strikes (mw-e04.6): the glue that turns an action timeline's moves into swept hitboxes and
// then into damage. For every fighter that can open hitboxes (it has the hitbox component, given at
// setup with `giveHitboxes`):
//
// - when one of its moves enters its active phase, the move's hitbox opens on the move's socket track
//   (`hitboxFromMove`), committed to the fighter's facing; the hit-volume system (mw-e04.2), run after
//   the timeline in the same tick, sweeps it on each active tick, so a 12/4/18 move started on tick 0
//   can strike on ticks 12–15 only;
// - when a move ends early (cancelled or interrupted), its hitbox closes;
// - each HitboxHit of such a hitbox becomes one damage packet from the move's damage template
//   (`hitPacket`: direction, region and region multiplier from the hit; the template's impulse turned
//   from the attacker's frame into the world), tagged `unblockable` for an unblockable move and
//   `parryable` for a parryable one, and is applied through the damage model — where the shield rule
//   (guard.ts) and the parry rule (combat/parry) meet it — then reported as MoveStruck with its result
//   (the creature attack executor adds an attack's extra packets from there, mw-e04.20).
//
// Hitbox ids are move ids, so the knight's `sword-light-2` is also the hitbox that struck. A charged
// move released part-way (mw-e04.13) strikes with its damage and world impact lerped by its charge
// level (`effectiveMove`), so a half-charged heavy hits between a heavy and a full charge.
//
// World impact (mw-e03.11): a move with a `worldImpact` also strikes the world through the one
// stimulus API when it enters its active phase: its hitbox, placed at the middle of the swing, applies
// one stimulus per kind of hit it lists (blunt, slash, pierce J; force N·s along the swing's facing),
// attributed to the attacker, with no falloff, sparing the attacker itself. Whatever the shape reaches
// reacts by its own properties — an old wall weak to blunt crumbles under the knight's heavy overhead
// — and no code here knows what a wall is. A shove with a `maxWeight` (the shield bash's 60 kg,
// mw-e04.14) moves only things that light; heavier ones resist it (the stimulus's ImpactResisted).

import type { MoveTable, RuntimeMove } from '@content/index';
import type { EntityId } from '../../core/component';
import type { World } from '../../core/world';
import { composePose, placeShape, type GeomShape } from '../../geom';
import { at } from '../../geom/vec';
import { hypot } from '../../math';
import { BREAK_TYPES } from '../../properties/spec';
import type { StimulusShape, Vec3 } from '../../stimulus/shapes';
import { applyStimulus, StimulusQueueComponent } from '../../stimulus/stimulus';
import { rotateToWorld } from '../attacks/frame';
import type { DamageModel } from '../damage/model';
import { DAMAGE_TAGS } from '../damage/packet';
import { closeHitboxes, HitboxComponent, openHitbox } from '../hits/components';
import { HitboxHit } from '../hits/events';
import type { SocketTrack } from '../hits/components';
import {
  entityFrame,
  hitboxFromMove,
  hitPacket,
  moveTrack,
  type SocketTrackLookup,
} from '../hits/system';
import { effectiveMove } from '../timeline/charge';
import { ActionEnded, ActionPhaseChanged } from '../timeline/events';
import { facingOf } from './components';
import { MoveStruck } from './events';

/** What melee strikes need. */
export interface MeleeStrikeOptions {
  /** Every move the fighters may perform (`compileMoves`). */
  readonly moves: MoveTable;
  /** The socket tracks their hitboxes sweep along (`compileSocketTracks`). */
  readonly tracks: SocketTrackLookup;
  /** The damage model hits resolve through (with `shieldGuard()` registered for blocks). */
  readonly damage: DamageModel;
}

/**
 * Wires melee strikes into `world` (see the file header). Register the hit-volume, damage, timeline
 * and melee components first, and add the hit-volume system after the action timeline. Returns a
 * function that removes the subscriptions.
 */
export function installMeleeStrikes<TInput>(
  world: World<TInput>,
  options: MeleeStrikeOptions,
): () => void {
  const { moves, tracks, damage } = options;
  const w: World<never> = world;
  const offs = [
    world.events.on(ActionPhaseChanged, ({ entity, move: id, phase }) => {
      if (phase !== 'active' || !w.has(entity, HitboxComponent)) return;
      const move = moves.get(id);
      if (move?.hitbox == null) return;
      const track = moveTrack(move, tracks);
      const facing = facingOf(w, entity);
      openHitbox(w, entity, hitboxFromMove(move, track, facing));
      strikeWorld(w, entity, effectiveMove(w, moves, entity, move), track, facing);
    }),
    world.events.on(ActionEnded, ({ entity, move, reason }) => {
      if (reason !== 'completed' && w.has(entity, HitboxComponent)) {
        closeHitboxes(w, entity, move);
      }
    }),
    world.events.on(HitboxHit, (hit) => {
      const listed = moves.get(hit.hitbox);
      if (listed === undefined) return;
      // A released charge (mw-e04.13) hits with its numbers lerped by its charge level.
      const move = effectiveMove(w, moves, hit.attacker, listed);
      const template = move.damage;
      if (template === null) return;
      const tags = [
        ...template.tags,
        ...(move.unblockable ? [DAMAGE_TAGS.unblockable] : []),
        ...(move.parryable ? [DAMAGE_TAGS.parryable] : []),
      ];
      const impulse = rotateToWorld(template.impulse, hit.direction);
      const result = damage.apply(w, hit.target, hitPacket(hit, { ...template, impulse, tags }));
      w.events.emit(MoveStruck, {
        tick: hit.tick,
        attacker: hit.attacker,
        move: move.id,
        target: hit.target,
        result: result ?? null,
      });
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** A placed hitbox as a stimulus shape (a turned box becomes its bounding sphere). */
function stimulusShapeOf(shape: GeomShape): StimulusShape {
  if (shape.kind !== 'box') return shape;
  const { x, y, z } = shape.halfExtents;
  return { kind: 'sphere', center: shape.center, radius: hypot(x, y, z) };
}

/**
 * Where `move`'s swing lands in the world: its hitbox at the middle of the swing, as `attacker`
 * facing `facing` has it (a stimulus shape). Undefined for a move without a hitbox, an unplaced
 * attacker or a world without stimuli.
 */
export function worldImpactShape(
  world: World<never>,
  attacker: EntityId,
  move: RuntimeMove,
  track: SocketTrack,
  facing: Vec3,
): StimulusShape | undefined {
  if (move.hitbox === null || !world.isRegistered(StimulusQueueComponent)) return undefined;
  const frame = entityFrame(world, attacker, facing);
  if (frame === undefined) return undefined;
  const key = at(track.keys, Math.min(Math.ceil(move.active / 2), track.keys.length - 1));
  return stimulusShapeOf(placeShape(move.hitbox.shape, composePose(frame, key)));
}

/**
 * Applies `move`'s world impact for `attacker` facing `facing` (see the file header). Returns how many
 * stimuli it queued: none for a move without one, an unplaced attacker or a world without stimuli.
 */
export function strikeWorld(
  world: World<never>,
  attacker: EntityId,
  move: RuntimeMove,
  track: SocketTrack,
  facing: Vec3,
): number {
  const impact = move.worldImpact;
  if (impact === undefined) return 0;
  const shape = worldImpactShape(world, attacker, move, track, facing);
  if (shape === undefined) return 0;
  let queued = 0;
  for (const element of BREAK_TYPES) {
    const intensity = impact[element] ?? 0;
    const applied = applyStimulus(world, {
      shape,
      element,
      intensity,
      falloff: 'none',
      source: attacker,
      sparesSource: true,
      ...(element === 'force' && { direction: facing }),
      ...(element === 'force' && impact.maxWeight !== undefined && { maxWeight: impact.maxWeight }),
    });
    if (applied) queued += 1;
  }
  return queued;
}
