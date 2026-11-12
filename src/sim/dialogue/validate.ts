// Validation of the logic DSL inside a dialogue (mw-e22.3). The content schema
// (src/content/types/dialogue.ts) checks the structure of a dialogue; the conditions and effects it
// holds are the shared logic DSL, which lives here in the sim, so this module validates them: kinds
// (built-in or the dialogue extension), fields and, with a reference checker, the content ids they
// name. Issues carry JSON pointers into the dialogue file (src/content/dialogue-source.ts turns
// them into file, node id and line).

import type { DialogueDef } from '../../content/types/dialogue';
import { conditionGates } from './tags';
import { dialogueLogicRegistry } from '../logic/dialogue-kinds';
import {
  validateLogicCondition,
  validateLogicEffects,
  type LogicIssue,
  type LogicRef,
  type LogicRefChecker,
} from '../logic';

export interface DialogueLogicIssue {
  /** RFC 6901 pointer into the dialogue file. */
  readonly pointer: string;
  readonly message: string;
}

/** `of[1].condition` or `[0].x` → `/of/1/condition` or `/0/x`. */
export function pointerOf(path: string): string {
  return [...path.matchAll(/\[(\d+)\]|([^.[\]]+)/g)].map((m) => `/${m[1] ?? m[0]}`).join('');
}

/** Which content ids exist, per reference type; a type that is not listed is not checked. */
export type KnownIds = Readonly<Partial<Record<LogicRef['type'], (id: string) => boolean>>>;

/** A `LogicRefChecker` over `known`. */
export function refCheckerFor(known: KnownIds): LogicRefChecker {
  return (ref) => {
    const exists = known[ref.type];
    return exists === undefined || exists(ref.id) ? undefined : `unknown ${ref.type} "${ref.id}"`;
  };
}

/**
 * Every problem with the conditions and effects of `dialogue`: unknown kinds, bad fields and, when
 * `references` is given, unresolved content ids.
 */
export function validateDialogueLogic(
  dialogue: DialogueDef,
  references?: LogicRefChecker,
): DialogueLogicIssue[] {
  const issues: DialogueLogicIssue[] = [];
  const registry = dialogueLogicRegistry();
  const add = (base: string, found: readonly LogicIssue[]): void => {
    for (const { path, message } of found)
      issues.push({ pointer: base + pointerOf(path), message });
  };
  const condition = (base: string, data: unknown): void => {
    if (data === undefined) return;
    const result = validateLogicCondition(data, { registry, references });
    if (!result.ok) add(base, result.issues);
  };
  const effects = (base: string, data: unknown): void => {
    if (data === undefined) return;
    const result = validateLogicEffects(data, { registry, references });
    if (!result.ok) add(base, result.issues);
  };

  dialogue.entries.forEach((entry, i) => {
    condition(`/entries/${String(i)}/when`, entry.when);
  });
  dialogue.nodes.forEach((node, n) => {
    const at = `/nodes/${String(n)}`;
    switch (node.kind) {
      case 'choice':
        node.options.forEach((option, o) => {
          condition(`${at}/options/${String(o)}/when`, option.when);
          effects(`${at}/options/${String(o)}/effects`, option.effects);
        });
        break;
      case 'branch':
        node.routes.forEach((route, r) => {
          condition(`${at}/routes/${String(r)}/when`, route.when);
        });
        break;
      case 'check':
        node.modifiers.forEach((modifier, m) => {
          condition(`${at}/modifiers/${String(m)}/when`, modifier.when);
        });
        effects(`${at}/successEffects`, node.successEffects);
        effects(`${at}/failureEffects`, node.failureEffects);
        break;
      case 'effect':
        effects(`${at}/effects`, node.effects);
        break;
      case 'line':
      case 'jump':
      case 'end':
        break;
    }
  });
  return issues;
}

/** A finding that does not stop a dialogue from loading: a hint to the writer. */
export interface DialogueWarning {
  /** RFC 6901 pointer into the dialogue file. */
  readonly pointer: string;
  /** Machine-readable kind: `class-options-narrow`. */
  readonly code: string;
  readonly message: string;
}

/**
 * Warnings about `dialogue` (never errors, so the dialogue still loads): class-gated options that
 * serve fewer than two classes (mw-e22.6). A conversation with a [Thief] option and nothing for the
 * other three classes teaches players that classes are a one-off; give a second class its own way in.
 * No class options at all is fine.
 */
export function dialogueWarnings(dialogue: DialogueDef): DialogueWarning[] {
  const classes = new Set<string>();
  let first: string | undefined;
  dialogue.nodes.forEach((node, n) => {
    if (node.kind !== 'choice') return;
    node.options.forEach((option, o) => {
      for (const gate of conditionGates(option.when)) {
        if (gate.kind !== 'class') continue;
        classes.add(gate.id);
        first ??= `/nodes/${String(n)}/options/${String(o)}/when`;
      }
    });
  });
  if (first === undefined || classes.size >= 2) return [];
  return [
    {
      pointer: first,
      code: 'class-options-narrow',
      message: `dialogue "${dialogue.id}" has class-gated options for only one class (${[...classes].join(', ')}); give at least two classes a way in`,
    },
  ];
}
