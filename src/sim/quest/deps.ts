// What a quest's conditions read (mw-e23.2): the dependency index that lets the runtime re-evaluate
// only the quests a change can affect. A condition is walked once, at registration; each leaf kind
// names what it depends on. Leaves that read things nobody announces (gold, the clock, disposition,
// the player's class) and kinds this module does not know (extensions) are `polled`: re-evaluated
// every few ticks instead of on a change, so an unknown kind is slow to react but never wrong.

import type { LogicNode } from '../logic/types';

export interface QuestDependencies {
  readonly facts: Set<string>;
  readonly items: Set<string>;
  readonly capabilities: Set<string>;
  /** Quests whose state or objectives the condition reads. */
  readonly quests: Set<string>;
  polled: boolean;
}

export function emptyDependencies(): QuestDependencies {
  return {
    facts: new Set(),
    items: new Set(),
    capabilities: new Set(),
    quests: new Set(),
    polled: false,
  };
}

/** Adds what `condition` (validated logic) reads to `into`. */
export function collectDependencies(condition: LogicNode, into: QuestDependencies): void {
  switch (condition.kind) {
    case 'all':
    case 'any':
      for (const child of condition['of'] as readonly LogicNode[]) collectDependencies(child, into);
      return;
    case 'not':
      collectDependencies(condition['condition'] as LogicNode, into);
      return;
    case 'fact':
    case 'factCmp':
      into.facts.add(condition['fact'] as string);
      return;
    case 'hasItem':
      into.items.add(condition['item'] as string);
      return;
    case 'hasCapability':
      into.capabilities.add(condition['capability'] as string);
      return;
    case 'questState':
    case 'objectiveState':
      into.quests.add(condition['quest'] as string);
      return;
    default:
      into.polled = true;
  }
}
