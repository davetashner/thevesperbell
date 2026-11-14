// The quest logic host (mw-e23.2): the adapter that backs the logic DSL's quest conditions and
// effects (`questState`, `objectiveState`, `startQuest`, `completeObjective`, `resolveQuest`,
// `failQuest`) with the quest runtime and delegates everything else (facts, items, gold,
// disposition, events) to the host the game already has. Dialogue, shops and quests themselves all
// run their effect batches against this one host, so a batch that starts a quest and gives its item
// is one atomic change: its checkpoint covers both.

import type {
  LogicCheckpoint,
  LogicFailure,
  LogicHost,
  LogicObjectiveState,
  LogicQuestState,
} from '../logic/types';
import { composeCheckpoints } from '../logic/compose';

/** What the adapter needs from the runtime. */
export interface QuestOps {
  questState(quest: string): LogicQuestState;
  objectiveState(quest: string, objective: string): LogicObjectiveState;
  startQuest(quest: string): LogicFailure | undefined;
  completeObjective(quest: string, objective: string): LogicFailure | undefined;
  resolveQuest(quest: string, resolution: string | undefined): LogicFailure | undefined;
  failQuest(quest: string): LogicFailure | undefined;
  /** Opens an undo point over the quest state. */
  openBatch(): LogicCheckpoint;
}

/** `base` with its quest conditions and effects served by `ops`. */
export function questLogicHost(base: LogicHost, ops: QuestOps): LogicHost {
  return {
    facts: base.facts,
    services: base.services,
    itemCount: (item) => base.itemCount(item),
    hasCapability: (capability) => base.hasCapability(capability),
    playerClass: () => base.playerClass(),
    disposition: (npc) => base.disposition(npc),
    gold: () => base.gold(),
    minuteOfDay: () => base.minuteOfDay(),
    questState: (quest) => ops.questState(quest),
    objectiveState: (quest, objective) => ops.objectiveState(quest, objective),
    checkpoint: () => composeCheckpoints(base.checkpoint(), ops.openBatch()),
    setFact: (key, value) => base.setFact(key, value),
    giveItem: (item, count) => base.giveItem(item, count),
    takeItem: (item, count) => base.takeItem(item, count),
    adjustGold: (delta) => base.adjustGold(delta),
    adjustDisposition: (npc, delta) => base.adjustDisposition(npc, delta),
    startQuest: (quest) => ops.startQuest(quest),
    completeObjective: (quest, objective) => ops.completeObjective(quest, objective),
    resolveQuest: (quest, resolution) => ops.resolveQuest(quest, resolution),
    failQuest: (quest) => ops.failQuest(quest),
    learnCapability: (capability) => base.learnCapability(capability),
    emit: (event, data) => {
      base.emit(event, data);
    },
    revealRumor: (rumor) => {
      base.revealRumor(rumor);
    },
  };
}
