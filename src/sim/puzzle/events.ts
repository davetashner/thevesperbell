// Puzzle events (mw-e15.3): what the game, audio, UI, quests and telemetry hear of a puzzle. The sim
// emits them on the world's event bus as the lifecycle moves; nothing here is state (the state lives
// in the puzzle's `puzzle.state` component and the facts it writes).

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';

/** The lifecycle of a puzzle: where it is between "nobody has seen it" and "done". */
export const PUZZLE_STATES = ['dormant', 'discovered', 'in-progress', 'solved', 'failed'] as const;

export type PuzzleState = (typeof PUZZLE_STATES)[number];

/** What `attribution` says when no declared solution fits what the player did. */
export const UNDECLARED = 'undeclared';

/** A puzzle changed state (every transition; the events below say why). */
export interface PuzzleStateChange {
  readonly puzzle: string;
  readonly from: PuzzleState;
  readonly to: PuzzleState;
  readonly tick: number;
}
export const puzzleStateChanged = defineEvent<PuzzleStateChange>('puzzleStateChanged');

/** The player found the puzzle: entered its discovery volume, used its trigger or first touched it. */
export interface PuzzleDiscovered {
  readonly puzzle: string;
  readonly tick: number;
}
export const puzzleDiscovered = defineEvent<PuzzleDiscovered>('puzzleDiscovered');

/** A puzzle's goal came true: outputs have fired (once, unless it is repeatable). */
export interface PuzzleSolved {
  readonly puzzle: string;
  readonly tick: number;
  /** The declared solution the capability trail fits, or `undeclared`. */
  readonly attribution: string;
  /** Capabilities used while it was open, in order of first use. */
  readonly trail: readonly string[];
}
export const puzzleSolved = defineEvent<PuzzleSolved>('puzzleSolved');

/**
 * A puzzle was solved by a route none of its declared solutions describes: designers want to hear
 * (telemetry, and the dev log). Fires with `puzzleSolved`, never alone.
 */
export const puzzleSolvedUndeclared = defineEvent<PuzzleSolved>('puzzleSolvedUndeclared');

/** A repeatable puzzle's goal stopped holding, so it is open again. */
export interface PuzzleUnsolved {
  readonly puzzle: string;
  readonly tick: number;
}
export const puzzleUnsolved = defineEvent<PuzzleUnsolved>('puzzleUnsolved');

/** A critical entity of the puzzle is gone, so it can no longer be solved as built. */
export interface PuzzleFailed {
  readonly puzzle: string;
  readonly tick: number;
  /** Scene spawn ids of the critical entities lost. */
  readonly lost: readonly string[];
}
export const puzzleFailed = defineEvent<PuzzleFailed>('puzzleFailed');

/** The reward hook: a puzzle's reward id fires once, the first time it is solved. */
export interface PuzzleRewarded {
  readonly puzzle: string;
  readonly reward: string;
  readonly tick: number;
}
export const puzzleRewarded = defineEvent<PuzzleRewarded>('puzzleRewarded');

/**
 * An actor used a capability (cast a spell, picked a lock, climbed a sheer face): the puzzle
 * runtime's capability trail. Spell casts are bridged automatically; other systems emit it when they
 * learn to. `target` is the entity it was used on, when known.
 */
export interface CapabilityUsed {
  readonly actor: EntityId;
  readonly capability: string;
  readonly target?: EntityId | undefined;
  readonly tick: number;
}
export const capabilityUsed = defineEvent<CapabilityUsed>('capabilityUsed');

/** How a puzzle came back from a loss: a critical entity respawned, the mechanisms reset, an out-of-bounds return. */
export const PUZZLE_RECOVERY_KINDS = ['respawn', 'reset', 'out-of-bounds'] as const;
export type PuzzleRecoveryKind = (typeof PUZZLE_RECOVERY_KINDS)[number];

/**
 * A puzzle recovered (mw-e15.7): a lost critical entity reappeared at its source (`respawn`), a reset
 * trigger returned the mechanisms to their authored state (`reset`), or a critical object that fell
 * out of the level was put back where it began (`out-of-bounds`). Telemetry and audio listen.
 */
export interface PuzzleRecovered {
  readonly puzzle: string;
  readonly tick: number;
  readonly kind: PuzzleRecoveryKind;
  /** Scene spawn id of the entity put back (respawn, out-of-bounds); empty for a reset. */
  readonly entity: string;
}
export const puzzleRecovered = defineEvent<PuzzleRecovered>('puzzleRecovered');
