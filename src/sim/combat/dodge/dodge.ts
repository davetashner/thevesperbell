// Dodge roll and backstep (mw-e04.8): the souls-like escape whose honest invulnerability frames make
// dangerous enemies fair. Timing, cost, i-frames and travel are move data (`dodge-roll`, `backstep`,
// src/content/data/move); these rules pick the move, steer its root motion and answer "is this entity
// invulnerable right now?".
//
// Choosing. For an entity the ActionFrame drives (it has an ActionInput), a press of the dodge
// action with a direction held (the ActionFrame's move vector, after
// the deadzone) requests the roll, travelling that way relative to the entity's facing — the camera,
// or the lock-on target once lock-on exists (the `facing` option supplies it). With no direction held
// it requests the backstep, away from the facing. The request goes through the action timeline like
// any move, so it is buffered, waits for a dodge cancel window, and pays stamina when it starts.
//
// Motion. A move with `motion` travels `distance` metres spread evenly over its active ticks, along
// the direction committed on its first tick ("input": the direction held at the press that asked for
// it, or the facing when none was; "backward": away from the facing). On its other ticks it stands
// still. Each world tick moves distance / active for every active move tick the timeline ran on it,
// so motion follows the entity's local time: hit-stop freezes a roll in place, and a slowed roll
// still covers exactly its distance (in steps, on the ticks its move advances). The character controller turns the velocity into movement
// (`CharacterInput.motion`), so walls stop a roll and ledges drop it; the i-frames run on regardless.
//
// I-frames. While the running move's tick is inside its `flags.iframes` range, the entity is
// invulnerable: the hit-volume system (hits/system.ts) and the creature attack executor, given
// `invulnerabilityRule` (combat/invulnerability.ts: these i-frames or wake-up i-frames), turn every
// hit on it into DodgedHit instead of damage, so no damage, poise or hit reaction follows. For the player
// the range's length is scaled by the difficulty's `dodgeWindow` (rounded, at least one tick, never
// past the move's last tick); every other entity uses the authored range.
//
// Tick order: the dodge input system runs before the action timeline (so a press starts on its own
// tick), the dodge motion system after it and before the character controller, and the hit-volume
// system after the timeline. On a tick where dodge and a bound attack are both pressed the timeline's
// most-recent-request rule applies: the attack, requested later in the tick, wins.

import type { MoveTable, RuntimeMotion, RuntimeMove, TickRange } from '@content/index';
import type { EntityId } from '../../core/component';
import type { System, World } from '../../core/world';
import { actionFrameOf, type ActionVector } from '../../input/action-frame';
import type { Vec3 } from '../../stimulus/shapes';
import type { LoadClass } from '../../inventory/equipment';
import { PlayerCombatantComponent } from '../damage/components';
import type { InvulnerabilityRule } from '../hits/system';
import { ActionInputComponent, ActionTimelineComponent } from '../timeline/components';
import { requestMove } from '../timeline/timeline';
import { DodgeComponent, type Dodge } from './components';

/** Where `entity` faces (unit horizontal, world): what dodge input is relative to. */
export type DodgeFacing = (world: World<never>, entity: EntityId) => Vec3 | undefined;

/** Facing when none is given: world −z (the player's look yaw 0). */
export const DEFAULT_FACING: Vec3 = Object.freeze({ x: 0, y: 0, z: -1 });

/**
 * The moves a dodge press starts for each armor load class (mw-e04.16, ADR-0003), where they differ
 * from the entity's own `roll` and `backstep`. Light, Medium and Heavy roll the lengths the ADR
 * lists; Overloaded stumbles (no roll, no i-frames) for both presses.
 */
export type LoadDodgeMoves = Readonly<
  Partial<Record<LoadClass, { readonly roll?: string; readonly backstep?: string }>>
>;

export const DEFAULT_LOAD_DODGES: LoadDodgeMoves = Object.freeze({
  light: { roll: 'dodge-roll-light' },
  medium: { roll: 'dodge-roll-medium' },
  heavy: { roll: 'dodge-roll-heavy' },
  overloaded: { roll: 'dodge-stumble', backstep: 'dodge-stumble' },
});

const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

function facingOf(facing: DodgeFacing | undefined, world: World<never>, entity: EntityId): Vec3 {
  return facing?.(world, entity) ?? DEFAULT_FACING;
}

/**
 * The world direction of input `move` (x right, y forward) relative to unit horizontal `facing`,
 * normalised; null when no direction is held. Directions never carry −0 (they are snapshotted).
 */
export function inputDirection(move: ActionVector, facing: Vec3): Vec3 | null {
  const { x, y } = move;
  if (x === 0 && y === 0) return null;
  // Right of the facing: the facing turned a quarter clockwise, seen from above.
  const dx = -facing.z * x + facing.x * y;
  const dz = facing.x * x + facing.z * y;
  const len = Math.sqrt(dx * dx + dz * dz);
  return Object.freeze({ x: dx / len + 0, y: 0, z: dz / len + 0 });
}

function store(world: World<never>, entity: EntityId, dodge: Dodge): void {
  world.set(entity, DodgeComponent, Object.freeze(dodge));
}

function requireDodge(world: World<never>, entity: EntityId): Dodge {
  const dodge = world.get(entity, DodgeComponent);
  if (dodge === undefined) throw new Error(`entity ${String(entity)} has no dodge`);
  return dodge;
}

/**
 * Asks `entity` to dodge with input `move` held, relative to `facing`: the roll that way, or the
 * backstep when no direction is held (see the file header). Returns the move requested. Throws when
 * the entity has no dodge or no action timeline.
 */
export function requestDodge(
  world: World<never>,
  entity: EntityId,
  move: ActionVector,
  facing: Vec3 = DEFAULT_FACING,
  load?: { readonly loadClass: LoadClass; readonly moves?: LoadDodgeMoves },
): string {
  const dodge = requireDodge(world, entity);
  const requested = inputDirection(move, facing);
  const variant =
    load === undefined ? undefined : (load.moves ?? DEFAULT_LOAD_DODGES)[load.loadClass];
  const id =
    requested === null ? (variant?.backstep ?? dodge.backstep) : (variant?.roll ?? dodge.roll);
  requestMove(world, entity, id);
  store(world, entity, { ...dodge, requested });
  return id;
}

/** Options of the dodge systems. */
export interface DodgeOptions {
  /** Where each entity faces (camera or lock-on); defaults to world −z. */
  readonly facing?: DodgeFacing;
  /**
   * The armor load class of an entity (mw-e04.16); undefined = none worn, and the entity rolls
   * its own `roll` and `backstep`. Absent = nobody's load matters.
   */
  readonly loadClass?: (world: World<never>, entity: EntityId) => LoadClass | undefined;
  /** Moves per load class; defaults to DEFAULT_LOAD_DODGES. */
  readonly loadMoves?: LoadDodgeMoves;
}

/**
 * Turns the tick's dodge presses into dodge requests for every entity the ActionFrame drives (one
 * with an ActionInput, like the timeline's own bindings), a dodge and an action timeline. Add it
 * before the action timeline system.
 */
export function dodgeInputSystem<TInput>(options: DodgeOptions = {}): System<TInput> {
  return {
    name: 'dodge-input',
    run: ({ world, inputs }) => {
      const frame = actionFrameOf(inputs);
      if (frame?.dodge.pressed !== true) return;
      const w: World<never> = world;
      const driven = w.query(DodgeComponent, ActionInputComponent, ActionTimelineComponent);
      for (const entity of driven.ids()) {
        const loadClass = options.loadClass?.(w, entity);
        requestDodge(
          w,
          entity,
          frame.move,
          facingOf(options.facing, w, entity),
          loadClass === undefined
            ? undefined
            : { loadClass, ...(options.loadMoves !== undefined && { moves: options.loadMoves }) },
        );
      }
    },
  };
}

function lookup(moves: MoveTable, id: string): RuntimeMove {
  const move = moves.get(id);
  if (move === undefined) throw new Error(`move "${id}" is not in the dodge's move table`);
  return move;
}

/** The direction a move with `motion` commits to on its first tick (see the file header). */
function commit(dodge: Dodge, motion: RuntimeMotion, facing: Vec3): Vec3 {
  if (motion.direction === 'backward') {
    return Object.freeze({ x: -facing.x + 0, y: 0, z: -facing.z + 0 });
  }
  return dodge.requested ?? facing;
}

/** Options of the dodge motion system. */
export interface DodgeMotionOptions extends DodgeOptions {
  /** Every move an entity may perform (the action timeline's table). */
  readonly moves: MoveTable;
}

/**
 * Commits and steers root motion for every entity with a dodge and an action timeline: sets
 * `Dodge.velocity` for this tick (see the file header). Add it after the action timeline system and
 * before whatever moves the entity (the character controller reads the velocity).
 */
export function dodgeMotionSystem<TInput>(options: DodgeMotionOptions): System<TInput> {
  const { moves } = options;
  return {
    name: 'dodge-motion',
    run: ({ world, clock }) => {
      const w: World<never> = world;
      w.query(DodgeComponent, ActionTimelineComponent).forEach((entity, dodge, timeline) => {
        const { current } = timeline;
        const data = current === null ? null : lookup(moves, current.move).motion;
        if (current === null || data === null) {
          if (dodge.motion !== null || dodge.velocity !== null) {
            store(w, entity, { ...dodge, motion: null, velocity: null });
          }
          return;
        }
        const move = lookup(moves, current.move);
        let { requested } = dodge;
        let previous = dodge.motion;
        if (previous?.startedAt !== current.startedAt || previous.move !== current.move) {
          const direction = commit(dodge, data, facingOf(options.facing, w, entity));
          previous = { move: move.id, startedAt: current.startedAt, direction, moveTick: -1 };
          requested = null;
        }
        // Move ticks this world tick ran (0 while frozen, 2 at double speed), counting active ones.
        const first = Math.max(previous.moveTick + 1, move.activeFrom);
        const last = Math.min(current.tick, move.recoveryFrom - 1);
        const active = Math.max(0, last - first + 1);
        const speed = (data.distance / move.active) * clock.hz * active;
        const { direction } = previous;
        const velocity =
          active === 0
            ? ZERO
            : Object.freeze({ x: direction.x * speed + 0, y: 0, z: direction.z * speed + 0 });
        const motion = Object.freeze({ ...previous, moveTick: current.tick });
        store(w, entity, { ...dodge, requested, motion, velocity });
      });
    },
  };
}

/**
 * The i-frame range of `move` with the difficulty's `dodgeWindow` multiplier applied (1 leaves it as
 * authored; see the file header), or null when the move has none.
 */
export function iframesOf(move: RuntimeMove, dodgeWindow = 1): TickRange | null {
  const { iframes } = move;
  if (iframes === null || dodgeWindow === 1) return iframes;
  const length = Math.max(1, Math.round((iframes.to - iframes.from + 1) * dodgeWindow));
  return Object.freeze({
    from: iframes.from,
    to: Math.min(iframes.from + length - 1, move.totalTicks - 1),
  });
}

/**
 * Whether `entity` is invulnerable this tick: its running move's tick is inside the move's i-frames
 * (scaled by `dodgeWindow` for the player). Needs the damage components registered (the hit-volume
 * system requires them too); false without a timeline or while idle.
 */
export function isInvulnerable(world: World<never>, entity: EntityId, moves: MoveTable): boolean {
  const current = world.get(entity, ActionTimelineComponent)?.current ?? null;
  if (current === null) return false;
  const player = world.has(entity, PlayerCombatantComponent);
  const range = iframesOf(lookup(moves, current.move), player ? world.difficulty.dodgeWindow : 1);
  return range !== null && current.tick >= range.from && current.tick <= range.to;
}

/**
 * The invulnerability rule for the hit-volume system: i-frames of the running move (`isInvulnerable`).
 * Register the action timeline components too, and run the timeline before the hit volumes.
 */
export function iframeRule(moves: MoveTable): InvulnerabilityRule {
  return (world, entity) => isInvulnerable(world, entity, moves);
}
