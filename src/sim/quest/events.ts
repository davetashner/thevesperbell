// Events the quest runtime emits (mw-e23.2) for the journal, telemetry and anything that reacts to
// a quest moving on. They are queued while a batch is open and published only after it committed, so
// a rolled-back change announces nothing. Names are never renamed (telemetry keys).

import { defineEvent } from '../core/events';
import type { LogicObjectiveState } from '../logic/types';

export interface QuestStartedEvent {
  readonly quest: string;
}

export interface QuestStageEvent {
  readonly quest: string;
  readonly stage: string;
}

export interface QuestObjectiveEvent {
  readonly quest: string;
  readonly objective: string;
  readonly state: LogicObjectiveState;
}

export interface QuestResolvedEvent {
  readonly quest: string;
  /** The resolution that ended it; undefined when an effect resolved it without naming one. */
  readonly resolution: string | undefined;
}

export interface QuestFailedEvent {
  readonly quest: string;
  /** The failure that ended it; undefined when an effect failed it without naming one. */
  readonly failure: string | undefined;
}

/** A resolution or failure whose condition held but whose effects (or continuation) refused. */
export interface QuestRefusedEvent {
  readonly quest: string;
  /** `resolution:<id>` or `failure:<id>`. */
  readonly outcome: string;
  readonly reason: string;
}

export const QuestStarted = defineEvent<QuestStartedEvent>('quest.started');
export const QuestStageChanged = defineEvent<QuestStageEvent>('quest.stage');
export const QuestObjectiveChanged = defineEvent<QuestObjectiveEvent>('quest.objective');
export const QuestResolved = defineEvent<QuestResolvedEvent>('quest.resolved');
export const QuestFailed = defineEvent<QuestFailedEvent>('quest.failed');
export const QuestRefused = defineEvent<QuestRefusedEvent>('quest.refused');

/** Where a creature ended up, for `entityState` quest objectives (mw-e23.3). */
export interface CreatureOutcomeEvent {
  /** The creature's content id (not the entity). */
  readonly creature: string;
  readonly state: 'dead' | 'befriended' | 'fled' | 'subdued';
  /**
   * It is out of the way for good (fled for good, subdued and bound, befriended into leaving):
   * `entityState` objectives waiting for `removed` complete on it.
   */
  readonly gone: boolean;
}

/**
 * Emit it when a creature is removed from play by any means that is not a death (death is read from
 * `Died`; befriending from the disposition band): a flee that does not come back, a sleep spell that
 * holds, a trapdoor. Quests only listen; emitters need not know them.
 */
export const CreatureOutcome = defineEvent<CreatureOutcomeEvent>('creature.outcome');
