// Validation of the logic DSL and content references inside a quest (mw-e23.1). The content schema
// (src/content/types/quest.ts) checks the structure of a quest; the conditions and effects it holds
// are the shared logic DSL, which lives here in the sim, so this module validates them: kinds,
// fields and, with a reference checker, the content ids they and the objectives name (items, NPCs,
// facts, dialogues, capabilities). Objective ids of the quest itself are always checked. Issues
// carry JSON pointers into the quest file.

import type { QuestDef, QuestObjective } from '../../content/types/quest';
import {
  validateLogicCondition,
  validateLogicEffects,
  type LogicIssue,
  type LogicRef,
  type LogicRefChecker,
} from '../logic';

export interface QuestLogicIssue {
  /** RFC 6901 pointer into the quest file. */
  readonly pointer: string;
  readonly message: string;
}

/** `of[1].condition` or `[0].x` → `/of/1/condition` or `/0/x`. */
function pointerOf(path: string): string {
  return [...path.matchAll(/\[(\d+)\]|([^.[\]]+)/g)].map((m) => `/${m[1] ?? m[0]}`).join('');
}

/** The content ids an objective's params name, as logic references. */
export function objectiveRefs(objective: QuestObjective): LogicRef[] {
  switch (objective.kind) {
    case 'haveItem':
      return [{ type: 'item', id: objective.params.item.id }];
    case 'deliverItem':
      return [
        { type: 'item', id: objective.params.item.id },
        { type: 'npc', id: objective.params.npc.id },
      ];
    case 'fact':
      return [{ type: 'fact', id: objective.params.fact }];
    case 'entityState':
      return [{ type: 'npc', id: objective.params.creature.id }];
    case 'talkTo':
      return [{ type: 'npc', id: objective.params.npc.id }];
    case 'dialogueNode':
      return [{ type: 'dialogue', id: objective.params.dialogue }];
    case 'learnCapability':
      return [{ type: 'capability', id: objective.params.capability }];
    case 'enterArea':
    case 'event':
      return [];
  }
}

/**
 * Every problem with the conditions, effects and references of `quest`: unknown kinds, bad fields,
 * objectives of this quest that do not exist and, when `references` is given, unresolved content
 * ids (including those the objectives name).
 */
export function validateQuestLogic(
  quest: QuestDef,
  references?: LogicRefChecker,
): QuestLogicIssue[] {
  const issues: QuestLogicIssue[] = [];
  const own = new Set(quest.objectives.map((o) => `${quest.id}/${o.id}`));
  const check: LogicRefChecker = (ref) => {
    if (ref.type === 'objective' && ref.id.startsWith(`${quest.id}/`) && !own.has(ref.id)) {
      return `unknown objective "${ref.id.slice(quest.id.length + 1)}" of this quest`;
    }
    return references?.(ref);
  };
  const add = (base: string, found: readonly LogicIssue[]): void => {
    for (const { path, message } of found)
      issues.push({ pointer: base + pointerOf(path), message });
  };
  const condition = (base: string, data: unknown): void => {
    if (data === undefined) return;
    const result = validateLogicCondition(data, { references: check });
    if (!result.ok) add(base, result.issues);
  };
  const effects = (base: string, data: unknown): void => {
    if (data === undefined) return;
    const result = validateLogicEffects(data, { references: check });
    if (!result.ok) add(base, result.issues);
  };

  condition('/startWhen', quest.startWhen);
  quest.objectives.forEach((objective, i) => {
    const at = `/objectives/${String(i)}`;
    condition(`${at}/activeWhen`, objective.activeWhen);
    for (const ref of objectiveRefs(objective)) {
      const problem = references?.(ref);
      if (problem !== undefined) issues.push({ pointer: `${at}/params`, message: problem });
    }
  });
  quest.resolutions.forEach((resolution, i) => {
    condition(`/resolutions/${String(i)}/when`, resolution.when);
    effects(`/resolutions/${String(i)}/effects`, resolution.effects);
  });
  quest.failures.forEach((failure, i) => {
    condition(`/failures/${String(i)}/when`, failure.when);
    effects(`/failures/${String(i)}/effects`, failure.effects);
  });
  return issues;
}
