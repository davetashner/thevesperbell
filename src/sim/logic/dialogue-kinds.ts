// Condition kinds only dialogue needs (mw-e22.3), registered through the DSL's extension registry
// instead of the built-ins: `dialogue.visitedCount` reads how often a node (or option) of a
// dialogue was visited, so an NPC can greet a stranger and a regular differently and a topic can
// be exhausted. The dialogue runtime (mw-e22.5) supplies the numbers as the `dialogue` service on
// the logic context; without it nothing has been visited. The registry is built on first use, so
// importing this module changes nothing.

import { z } from 'zod';
import { compareNumbers, createLogicRegistry, LOGIC_COMPARISONS } from './builtins';
import type { LogicRegistry } from './registry';
import type { LogicContext } from './types';

/** Key of the dialogue runtime's service on `LogicContext.services`. */
export const DIALOGUE_SERVICE = 'dialogue';

/** What the dialogue runtime tells conditions about the conversation history. */
export interface DialogueVisits {
  /**
   * How many times node or option `id` was visited with the NPC being talked to; `dialogue` names
   * another dialogue, default the current one.
   */
  visitCount(id: string, dialogue?: string): number;
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const id = z.string().regex(ID, 'expected a kebab-case id such as "first-meeting"');

/** The visit count `context` reports for `id`; 0 when no dialogue is running. */
function visitCount(context: LogicContext, node: string, dialogue: string | undefined): number {
  const visits = context.services?.[DIALOGUE_SERVICE] as DialogueVisits | undefined;
  return visits?.visitCount(node, dialogue) ?? 0;
}

/** Registers the dialogue kinds into `registry`. */
export function registerDialogueKinds(registry: LogicRegistry): void {
  registry.registerCondition({
    kind: 'dialogue.visitedCount',
    schema: z.strictObject({
      id,
      dialogue: id.optional(),
      op: z.enum(LOGIC_COMPARISONS),
      value: z.int().min(0),
    }),
    evaluate: (node, context) =>
      compareNumbers(node.op, visitCount(context, node.id, node.dialogue), node.value),
    refs: (node) => (node.dialogue === undefined ? [] : [{ type: 'dialogue', id: node.dialogue }]),
  });
}

let shared: LogicRegistry | undefined;

/** The registry dialogue content is validated and run with: built-ins plus the dialogue kinds. */
export function dialogueLogicRegistry(): LogicRegistry {
  if (shared === undefined) {
    shared = createLogicRegistry();
    registerDialogueKinds(shared);
  }
  return shared;
}
