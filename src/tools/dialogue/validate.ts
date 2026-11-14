// Dialogue validation for CI (mw-e22.8, pnpm dialogue:validate). Per dialogue file it runs, in order:
// the schema (structure, dangling targets, speakers: src/content/dialogue-source.ts), the logic DSL
// (kinds, fields and, with a reference checker built from game content, item/quest/fact/capability/
// class/NPC/objective ids: validateDialogueLogic), the graph (reachability, exits, unsatisfiable
// choices, loops with no way out, text length: validateDialogueGraph) and the class-options hint
// (dialogueWarnings). The persuasion table's conditions get the same logic check. Every finding names
// the file, node id and line. Errors fail CI; warnings print and exit 0.
// Rumor ids are not checked yet: there is no rumor content type (the `rumor` reference passes).

import {
  describeDialogueIssue,
  validateDialogueText,
  type DialogueFileIssue,
} from '@content/dialogue-source';
import type { ContentSource } from '@content/loader';
import { factIndex, lookupFact, type GameContent } from '@content/index';
import {
  dialogueWarnings,
  refCheckerFor,
  validateDialogueGraph,
  validateDialogueLogic,
  validatePersuasionRules,
  type PersuasionRules,
} from '@sim/dialogue';
import type { LogicRefChecker } from '@sim/logic';

export interface DialogueValidationEnv {
  /** Longest line or option text before a warning. */
  readonly maxTextLength: number;
  /** Resolves content ids named by conditions and effects; omit to skip reference checks. */
  readonly references?: LogicRefChecker | undefined;
}

export interface DialogueReport {
  /** Dialogue files validated. */
  readonly dialogues: number;
  readonly errors: readonly DialogueFileIssue[];
  readonly warnings: readonly DialogueFileIssue[];
}

/** Whether `path` is a dialogue file (`…/dialogue/<id>.json`). */
export const isDialogueSource = (path: string): boolean =>
  /(^|\/)dialogue\/[^/]+\.json$/.test(path);

/** Whether `path` is the persuasion table (`…/persuasion/persuasion.json`). */
export const isPersuasionSource = (path: string): boolean =>
  /(^|\/)persuasion\/persuasion\.json$/.test(path);

/** A reference checker over the ids `content` declares. */
export function contentReferences(content: GameContent): LogicRefChecker {
  const facts = factIndex(content.all('fact'));
  return refCheckerFor({
    item: (id) => content.has('item', id),
    capability: (id) => content.has('capability', id),
    class: (id) => content.has('class', id),
    quest: (id) => content.has('quest', id),
    npc: (id) => content.has('creature', id),
    fact: (key) => lookupFact(facts, key) !== undefined,
    objective: (id) => {
      const [quest = '', objective = ''] = id.split('/');
      return (
        content.has('quest', quest) &&
        content.get('quest', quest).objectives.some((o) => o.id === objective)
      );
    },
  });
}

/** Validates every dialogue file (and the persuasion table) among `sources`. */
export function validateDialogues(
  sources: readonly ContentSource[],
  env: DialogueValidationEnv,
): DialogueReport {
  const errors: DialogueFileIssue[] = [];
  const warnings: DialogueFileIssue[] = [];
  let dialogues = 0;
  for (const { path, text } of sources) {
    if (isPersuasionSource(path)) {
      const rules = JSON.parse(text) as Pick<PersuasionRules, 'modifiers'>;
      for (const issue of validatePersuasionRules(rules, env.references)) {
        errors.push(describeDialogueIssue(path, text, issue));
      }
      continue;
    }
    if (!isDialogueSource(path)) continue;
    dialogues++;
    const result = validateDialogueText(path, text);
    if (!result.ok) {
      errors.push(...result.issues);
      continue;
    }
    const { dialogue } = result;
    const graph = validateDialogueGraph(dialogue, { maxTextLength: env.maxTextLength });
    for (const issue of validateDialogueLogic(dialogue, env.references)) {
      errors.push(describeDialogueIssue(path, text, issue));
    }
    for (const issue of graph.errors) errors.push(describeDialogueIssue(path, text, issue));
    for (const issue of graph.warnings) warnings.push(describeDialogueIssue(path, text, issue));
    for (const issue of dialogueWarnings(dialogue)) {
      warnings.push(describeDialogueIssue(path, text, issue));
    }
  }
  return { dialogues, errors, warnings };
}
