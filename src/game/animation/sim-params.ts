// Sim → animation parameters (mw-e02.20): reads, never writes, an entity's sim state into the
// parameters animation graphs name (ANIM_PARAMETERS, src/content/types/anim-graph.ts). The action
// timeline (mw-e04.4) supplies the move in progress, its phase and verb, the hit-reaction lock and
// the entity's local time scale; the hit-reaction rules (mw-e04.7) the reaction the sim chose and
// the side it came from; a locomotion reader supplies speed, turn rate, grounded and, where the
// sim publishes one, the locomotion state and vertical speed (the player's CharacterLocomotion,
// mw-e02.6, via `characterLocomotion`; a creature's mover; or the testbed's demo rigs).

import type { ANIM_GUARD_PHASES, AnimParameterName, MoveTable, MoveVerb } from '@content/index';
import {
  ActionTimelineComponent,
  GuardComponent,
  HitReactionComponent,
  isBlocking,
  locomotionOf,
  phaseAt,
  type ActionPhase,
  type EntityId,
  type LocomotionState,
} from '@sim/index';
import type { AnimParamValue } from '@render/animation/index';
import type { SimView } from '../loop/render-sync';

type GuardPhase = (typeof ANIM_GUARD_PHASES)[number];

/** What a locomotion reader reports for one entity. */
export interface LocomotionSample {
  /** Horizontal speed, m/s. */
  readonly speed: number;
  /** Yaw rate, rad/s. */
  readonly turnRate: number;
  readonly grounded: boolean;
  /** The sim's locomotion state (mw-e02.6); absent = none published. */
  readonly state?: LocomotionState;
  /** Vertical speed, m/s (positive rising); absent = 0. */
  readonly verticalSpeed?: number;
}

/** Reads an entity's locomotion from the sim (undefined when it has none). */
export type LocomotionReader = (view: SimView, entity: EntityId) => LocomotionSample | undefined;

/**
 * Reads a character's published locomotion (CharacterLocomotion, mw-e02.6): the sim's own state,
 * speeds and turn rate, read-only. Undefined for entities without it.
 */
export const characterLocomotion: LocomotionReader = (view, entity) => {
  const snapshot = locomotionOf(view, entity);
  if (snapshot === undefined) return undefined;
  const { state, speed, turnRate, grounded, verticalSpeed } = snapshot;
  return { state, speed, turnRate, grounded, verticalSpeed };
};

/** The move in progress at one sim step. */
export interface ActionStep {
  readonly move: string;
  /** The move's clip id (presentation.anim). */
  readonly clip: string;
  /** The world tick it started on: identifies this run of the move. */
  readonly key: number;
  /** Its move tick at this step. */
  readonly tick: number;
  readonly activeFrom: number;
  readonly totalTicks: number;
  readonly phase: ActionPhase;
  readonly verb: MoveVerb;
}

/** An entity's animation parameters at one sim step. */
export interface SimAnimSample {
  readonly values: Readonly<Partial<Record<AnimParameterName, AnimParamValue>>>;
  readonly timeScale: number;
  readonly action: ActionStep | null;
}

/** Reads an entity's animation parameters at the current sim step. */
export type SimAnimReader = (view: SimView, entity: EntityId) => SimAnimSample | undefined;

export interface SimAnimSource {
  /** The move table the action timeline runs (compileMoves of the content's moves). */
  readonly moves: MoveTable;
  /** Speed, turn rate and grounded; without one the entity stands still. */
  readonly locomotion?: LocomotionReader;
  /**
   * Read the sim's chosen hit reaction and its side into `hitReaction`/`hitDirection` (mw-e04.7);
   * the world must register HitReactionComponent. Without it both read none.
   */
  readonly reactions?: boolean;
  /**
   * Whether the world runs the action timeline (registers its components); defaults to true. A
   * world without it (a movement-only player) reads as never acting, at time scale 1.
   */
  readonly timeline?: boolean;
  /**
   * Read the shield's phase from the entity's GuardComponent into `guard` (raising while the shield
   * comes up, held once it blocks, lowering for LOWERING_TICKS after it drops); without it `guard`
   * reads none. The world must register GuardComponent. Read only: animation never touches the guard.
   */
  readonly guard?: boolean;
}

/** How long, in ticks (0.25 s), the `guard` parameter reads lowering after a shield drops. */
export const LOWERING_TICKS = 15;

/**
 * A reader of the sim-published parameters (the world must register the action timeline
 * components): speed/turnRate/grounded/locomotion/verticalSpeed from `locomotion`, and
 * acting/actionPhase/actionVerb/hitReact plus the time scale and running move from the entity's
 * action timeline (idle and time scale 1 without one), and hitReaction/hitDirection from its hit
 * reaction when `reactions` is set (none otherwise). Undefined when the entity is gone.
 */
export function simAnimReader(source: SimAnimSource): SimAnimReader {
  // The tick each entity's shield was last seen up, for the lowering window.
  const lastUp = new Map<EntityId, number>();
  const guardPhase = (view: SimView, entity: EntityId): GuardPhase => {
    if (source.guard !== true || !view.isRegistered(GuardComponent)) return 'none';
    const guard = view.get(entity, GuardComponent);
    if (guard?.raisedAt != null) {
      lastUp.set(entity, view.tick);
      return isBlocking(guard, view.tick) ? 'held' : 'raising';
    }
    const was = lastUp.get(entity);
    if (was !== undefined && view.tick - was <= LOWERING_TICKS) return 'lowering';
    lastUp.delete(entity);
    return 'none';
  };
  return (view, entity) => {
    if (!view.isAlive(entity)) return undefined;
    const motion = source.locomotion?.(view, entity);
    const timeline =
      source.timeline === false ? undefined : view.get(entity, ActionTimelineComponent);
    const current = timeline?.current ?? null;
    const reaction =
      source.reactions === true ? view.get(entity, HitReactionComponent)?.current : null;
    const move = current === null ? undefined : source.moves.get(current.move);
    const action: ActionStep | null =
      current === null || move === undefined
        ? null
        : {
            move: move.id,
            clip: move.presentation.anim,
            key: current.startedAt,
            tick: current.tick,
            activeFrom: move.activeFrom,
            totalTicks: move.totalTicks,
            phase: phaseAt(move, current.tick),
            verb: move.verb,
          };
    const values: Partial<Record<AnimParameterName, AnimParamValue>> = {
      speed: motion?.speed ?? 0,
      turnRate: motion?.turnRate ?? 0,
      grounded: motion?.grounded ?? true,
      locomotion: motion?.state ?? 'none',
      verticalSpeed: motion?.verticalSpeed ?? 0,
      acting: action !== null,
      actionPhase: action?.phase ?? 'none',
      actionVerb: action?.verb ?? 'none',
      hitReact: current === null && (timeline?.lockTicks ?? 0) > 0,
      hitReaction: reaction?.kind ?? 'none',
      hitDirection: reaction?.direction ?? 'none',
      guard: guardPhase(view, entity),
    };
    return { values, timeScale: timeline?.timeScale ?? 1, action };
  };
}
