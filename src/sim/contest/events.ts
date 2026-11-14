// Events the contest runner emits (mw-e40.5) for the UI, audio, the crowd and anything that reacts
// to a contest. Names are never renamed (telemetry keys).

import { defineEvent } from '../core/events';

export const CONTEST_OUTCOMES = ['won', 'lost', 'disqualified', 'forfeit'] as const;
export type ContestOutcome = (typeof CONTEST_OUTCOMES)[number];

export interface ContestStartedEvent {
  readonly contest: string;
  /** The rivals' ids; the player (`player`) is always in. */
  readonly participants: readonly string[];
}

export interface ContestStanding {
  /** `player` or a participant id. */
  readonly id: string;
  readonly score: number;
  /** The tick the score last changed to its current value (the tie-break); null: never scored. */
  readonly reachedAt: number | null;
}

export interface ContestEndedEvent {
  readonly contest: string;
  readonly outcome: ContestOutcome;
  /** The player's placement, 1 first. A disqualified or forfeiting player places last. */
  readonly placement: number;
  readonly score: number;
  readonly standings: readonly ContestStanding[];
  /** An outcome effect batch that refused (`kind:reason`); the contest still ended. */
  readonly refused?: string;
}

export interface ContestCheatDetectedEvent {
  readonly contest: string;
  readonly cheat: string;
  /** The creature that perceived it. */
  readonly watcher: string;
  readonly disqualified: boolean;
}

export const ContestStarted = defineEvent<ContestStartedEvent>('contest.started');
export const ContestEnded = defineEvent<ContestEndedEvent>('contest.ended');
export const ContestCheatDetected = defineEvent<ContestCheatDetectedEvent>('contest.cheatDetected');
