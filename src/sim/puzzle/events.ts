// Puzzle events (mw-e15.3): what the game, audio, UI, quests and telemetry hear of a puzzle. The sim
// emits them on the world's event bus as the lifecycle moves; nothing here is state (the state lives
// in the puzzle's `puzzle.state` component and the facts it writes).

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';

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

/**
 * A hint tier of a puzzle's ladder fired (mw-e15.11): the player has been stuck long enough, or failed
 * often enough. The sim only says so; the game shows `bark` (the player character mutters it), pulses
 * the `entities` (UI beads draw it), and a `rumour` fact was set for dialogue to pick up. Fires once
 * per tier, never for a solved puzzle, never when hints are off.
 */
export interface PuzzleHint {
  readonly puzzle: string;
  /** The tier's index in the ladder, from 0. */
  readonly tier: number;
  readonly tick: number;
  /** The text chosen for the player's capabilities (a class variant, else the tier's own); absent: none. */
  readonly bark?: string | undefined;
  /** The capability whose variant text was chosen; absent when the tier's own text was. */
  readonly variant?: string | undefined;
  /** Scene spawn ids to pulse. */
  readonly highlight: readonly string[];
  /** The entities of `highlight` that exist now. */
  readonly entities: readonly EntityId[];
  /** The declared fact set true (an NPC rumour unlocked); absent: none. */
  readonly rumour?: string | undefined;
}
export const puzzleHint = defineEvent<PuzzleHint>('puzzleHint');

/** Trail ids of read clues start with this. */
export const CLUE_PREFIX = 'clue.';

/** The capability id a read clue adds to a puzzle's trail: `clue.<item id>`. */
export const clueCapability = (item: string): string => `${CLUE_PREFIX}${item}`;

/**
 * A readable item bound to a puzzle was read (mw-e15.5): its text is a clue to `puzzle`, so the
 * puzzle's trail gains `clue.<item>` and a later solve can credit the book. One event per bound
 * puzzle. The reader (a scroll read, the book reader of mw-e07.9) emits it through `readClue`.
 */
export interface ClueRead {
  readonly actor: EntityId;
  /** The readable item's definition id. */
  readonly item: string;
  readonly puzzle: string;
  readonly tick: number;
}
export const clueRead = defineEvent<ClueRead>('clueRead');

/** Announces that `actor` read `item`, a clue to each of `puzzles` (the item's `clueFor`). */
export function readClue(
  world: World<never>,
  actor: EntityId,
  item: string,
  puzzles: readonly string[],
): void {
  for (const puzzle of puzzles)
    world.events.emit(clueRead, { actor, item, puzzle, tick: world.tick });
}
