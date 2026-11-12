// Option tags (mw-e22.6): what an option's gating condition says about who can pick it, as the UI
// shows it ("[Thief] I couldn't help noticing your ledger doesn't add up", "[Detect Magic]", "[Show
// the signet ring]"). Tags are derived from the option's `when`, never written by hand: a
// `playerClass` condition gives a class tag (the class's `dialogueTag`), `hasCapability` a capability
// tag (the capability id) and `hasItem` an item tag (the item id plus its icon id). Conditions are
// walked through `all` and `any`; anything under `not` is skipped, because "not a thief" is not a
// calling card. Names, icons and the "[...]" frame are the UI's: it localizes `labelKey`.
//
// Visibility is the option's own `showWhenLocked`, default false: an option the player does not
// qualify for is hidden, so a knight never sees the thief's lines unless a designer opts in.

import type { LogicNode } from '../logic';

export const DIALOGUE_TAG_KINDS = ['class', 'capability', 'item'] as const;
export type DialogueTagKind = (typeof DIALOGUE_TAG_KINDS)[number];

/** One tag on an option. */
export interface DialogueTag {
  readonly kind: DialogueTagKind;
  /** The class, capability or item id the condition names. */
  readonly id: string;
  /** The tag: the class's `dialogueTag` (`thief`), or the capability or item id. */
  readonly tag: string;
  /** Localization key of the tag's display name: `dialogue.tag.<kind>.<id>`. */
  readonly labelKey: string;
  /** Item tags: the item's icon asset id, when the item is known. */
  readonly icon?: string;
}

/** Where tag data comes from; content lookups, so the sim never reads content directly. */
export interface TagSources {
  /** The `dialogueTag` of a class. Unknown class: the class id is used. */
  classTag?(classId: string): string | undefined;
  /** The icon asset id of an item. */
  itemIcon?(itemId: string): string | undefined;
}

/** Every positive `playerClass`, `hasCapability` and `hasItem` of a condition, in order, once each. */
function gates(condition: LogicNode, found: { kind: DialogueTagKind; id: string }[]): void {
  switch (condition.kind) {
    case 'all':
    case 'any':
      for (const child of condition['of'] as readonly LogicNode[]) gates(child, found);
      return;
    case 'not':
      return;
    case 'playerClass':
      found.push({ kind: 'class', id: condition['class'] as string });
      return;
    case 'hasCapability':
      found.push({ kind: 'capability', id: condition['capability'] as string });
      return;
    case 'hasItem':
      found.push({ kind: 'item', id: condition['item'] as string });
      return;
  }
}

/** The class, capability and item gates of `condition` (deduplicated, in reading order). */
export function conditionGates(
  condition: LogicNode | undefined,
): readonly { kind: DialogueTagKind; id: string }[] {
  const found: { kind: DialogueTagKind; id: string }[] = [];
  if (condition !== undefined) gates(condition, found);
  return found.filter(
    (gate, i) => found.findIndex((other) => other.kind === gate.kind && other.id === gate.id) === i,
  );
}

/** The tags an option with condition `when` carries. */
export function deriveOptionTags(
  when: LogicNode | undefined,
  sources: TagSources = {},
): readonly DialogueTag[] {
  return conditionGates(when).map(({ kind, id }) => {
    const labelKey = `dialogue.tag.${kind}.${id}`;
    if (kind === 'class') return { kind, id, tag: sources.classTag?.(id) ?? id, labelKey };
    if (kind === 'capability') return { kind, id, tag: id, labelKey };
    const icon = sources.itemIcon?.(id);
    return { kind, id, tag: id, labelKey, ...(icon !== undefined && { icon }) };
  });
}
