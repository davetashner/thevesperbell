// What the dialogue screen says (mw-e22.10): the runtime hands over localization keys and ids (a
// locked option's `logic.condition.hasItem` with its fields, a tag's `dialogue.tag.class.thief`, a
// check's difficulty label and score lines); this turns them into the English the player reads, from
// the UI string table (src/content/strings.ts). Ids with no string read as words ("miners-tally-stick"
// becomes "miners tally stick").

import { formatString, hasString } from '@content/index';
import type { DialogueBoxOdds, DialogueBoxOutcome, DialogueBoxTag } from '@ui/index';
import type { CheckBreakdown, DialogueTag, LogicDescription } from '@sim/index';

/** Placeholder glyphs for tag kinds until the tag icons land (mw-e37.137). */
export const TAG_GLYPHS = Object.freeze({ class: '◆', capability: '✦', item: '▣' });

/** `miners-tally-stick` as "miners tally stick". */
export function humanize(id: string): string {
  return id.replaceAll('-', ' ');
}

/** "Fair" for `fair`: first letter up. */
const capital = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** One field of a condition as the player reads it: an operator in words, an id as words. */
function fieldText(name: string, value: string | number | boolean): string {
  if (name === 'op' && typeof value === 'string' && hasString(`logic.op.${value}`)) {
    return formatString(`logic.op.${value}`);
  }
  return typeof value === 'string' ? humanize(value) : String(value);
}

/** A locked option's reason, e.g. "Needs miners tally stick" (a nested condition reads as its parts). */
export function reasonText(description: LogicDescription): string {
  const many = description.params['count'];
  const key = typeof many === 'number' && many > 1 ? `${description.key}.many` : description.key;
  if (!hasString(key)) return formatString('logic.condition.unknown');
  const params = Object.fromEntries(
    Object.entries(description.params).map(([name, value]) => [name, fieldText(name, value)]),
  );
  const parts = description.children.map(reasonText).join(', ');
  return formatString(key, { ...params, parts });
}

/** An option tag as the box shows it: a placeholder glyph and "[Thief]". */
export function tagView(tag: DialogueTag): DialogueBoxTag {
  const known = hasString(tag.labelKey) ? formatString(tag.labelKey) : humanize(tag.tag);
  return {
    kind: tag.kind,
    glyph: TAG_GLYPHS[tag.kind],
    label: formatString('dialogue.tag.format', { label: capital(known) }),
  };
}

const approachName = (approach: string): string => formatString(`dialogue.approach.${approach}`);

/** "Persuade: fair" for a choice that leads to a check, before the player commits. */
export function oddsView(check: CheckBreakdown): DialogueBoxOdds {
  return {
    level: check.label,
    label: formatString('dialogue.odds', {
      approach: approachName(check.approach),
      label: formatString(`dialogue.difficulty.${check.label}`),
    }),
  };
}

const signed = (value: number): string => (value > 0 ? `+${String(value)}` : String(value));

/** The score line of one modifier, e.g. "Base +4" or "Disposition (friendly) +2". */
function modifierLine(modifier: CheckBreakdown['modifiers'][number]): string {
  const sourceKey = `dialogue.modifier.${modifier.source}`;
  const label = modifier.label;
  const named = hasString(sourceKey) ? formatString(sourceKey, { label }) : label;
  return formatString('dialogue.outcome.modifier', {
    label: capital(named),
    value: signed(modifier.value),
  });
}

/** What a check came to, with the score that decided it. */
export function outcomeView(breakdown: CheckBreakdown): DialogueBoxOutcome {
  const approach = approachName(breakdown.approach);
  return {
    success: breakdown.success,
    title: formatString(
      breakdown.success ? 'dialogue.outcome.success' : 'dialogue.outcome.failure',
      {
        approach,
      },
    ),
    lines: [
      ...breakdown.modifiers.map(modifierLine),
      formatString('dialogue.outcome.total', {
        score: String(breakdown.score),
        difficulty: String(breakdown.difficulty),
      }),
    ],
  };
}
