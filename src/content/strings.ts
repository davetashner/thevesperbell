// The English string table for UI text keyed by localisation key (mw-e28.14). Content refers to
// text by key only (a cue rule's `caption: "caption.footsteps"`), so a translation replaces this
// table without touching content. Other tables (item names, class cards) join it as their screens
// land; until then they carry their own English fallbacks.
//
// Strings may hold `{name}` placeholders, filled by `formatString`.

/** Sound caption strings (mw-e28.14). `caption.format` wraps a sound and its direction. */
const CAPTION_STRINGS = {
  'caption.format': '[{sound}, {direction}]',
  'caption.footsteps': 'Footsteps',
  'caption.telegraph': 'Attack incoming',
  'caption.telegraph-unblockable': 'Unblockable attack incoming',
  'caption.alert-bark': 'Alert bark',
  'caption.noise-rattle': 'Rattling',
  'caption.door-open': 'Door opening',
  'caption.door-close': 'Door closing',
  'caption.breaking': 'Something breaking',
  'caption.clue.chime-low': 'Low chime',
  'caption.clue.chime-mid': 'Mid chime',
  'caption.clue.chime-high': 'High chime',
  'caption.clue.chime-wrong': 'Wrong chime',
  'caption.clue.chime-solved': 'Bright chime',
  'caption.direction.ahead': 'ahead',
  'caption.direction.ahead-right': 'ahead right',
  'caption.direction.right': 'right',
  'caption.direction.behind-right': 'behind right',
  'caption.direction.behind': 'behind',
  'caption.direction.behind-left': 'behind left',
  'caption.direction.left': 'left',
  'caption.direction.ahead-left': 'ahead left',
} as const;

/**
 * Dialogue screen strings (mw-e22.10): the locked-option reasons (`logic.condition.<kind>`, filled
 * from the condition's fields), option tags, persuasion odds and outcomes, and the box's hints.
 */
const DIALOGUE_STRINGS = {
  'logic.condition.fact': 'Requires {fact}',
  'logic.condition.factCmp': 'Requires {fact} {op} {value}',
  'logic.condition.hasItem': 'Needs {item}',
  'logic.condition.hasItem.many': 'Needs {count} x {item}',
  'logic.condition.hasCapability': 'Needs the {capability} ability',
  'logic.condition.playerClass': 'For the {class} only',
  'logic.condition.disposition': 'Needs {npc} to feel {op} {value}',
  'logic.condition.questState': 'Quest {quest} must be {state}',
  'logic.condition.objectiveState': 'Objective {objective} of {quest} must be {state}',
  'logic.condition.gold': 'Needs gold {op} {value}',
  'logic.condition.timeOfDay': 'Only between {from} and {to}',
  'logic.condition.dialogue.visitedCount': 'Needs {id} discussed {op} {value} times',
  'logic.condition.all': '{parts}',
  'logic.condition.any': 'Any of: {parts}',
  'logic.condition.not': 'Not: {parts}',
  'logic.condition.unknown': 'Requirement not met',
  'logic.op.eq': 'exactly',
  'logic.op.neq': 'other than',
  'logic.op.gt': 'above',
  'logic.op.gte': 'at least',
  'logic.op.lt': 'below',
  'logic.op.lte': 'at most',
  'dialogue.tag.format': '[{label}]',
  'dialogue.tag.class.knight': 'Knight',
  'dialogue.tag.class.archer': 'Archer',
  'dialogue.tag.class.sorcerer': 'Sorcerer',
  'dialogue.tag.class.thief': 'Thief',
  'dialogue.approach.persuade': 'Persuade',
  'dialogue.approach.intimidate': 'Intimidate',
  'dialogue.approach.deceive': 'Deceive',
  'dialogue.approach.charm': 'Charm',
  'dialogue.odds': '{approach}: {label}',
  'dialogue.difficulty.easy': 'easy',
  'dialogue.difficulty.fair': 'fair',
  'dialogue.difficulty.hard': 'hard',
  'dialogue.difficulty.impossible': 'impossible',
  'dialogue.outcome.success': '{approach} worked',
  'dialogue.outcome.failure': '{approach} failed',
  'dialogue.outcome.modifier': '{label} {value}',
  'dialogue.outcome.total': 'Score {score} against {difficulty}',
  'dialogue.modifier.base': 'Base',
  'dialogue.modifier.disposition': 'Disposition ({label})',
  'dialogue.history.divider': 'Conversation with {speaker}',
  'dialogue.ui.line': 'Enter to continue',
  'dialogue.ui.choice': 'Up and Down or 1 to 9 to choose, Enter to confirm',
  'dialogue.ui.history': 'H for history',
  'dialogue.ui.historyButton': 'History',
  'dialogue.ui.historyOpen': 'H or Esc to close history',
  'dialogue.ui.historyTitle': 'History',
  'dialogue.ui.historyEmpty': 'Nothing said yet.',
  'dialogue.ui.replies': 'Replies',
  'dialogue.ui.locked': 'Locked',
} as const;

/** Every string by key. */
export const UI_STRINGS: Readonly<Record<string, string>> = {
  ...CAPTION_STRINGS,
  ...DIALOGUE_STRINGS,
};

/** Whether `key` has a string. */
export function hasString(key: string): boolean {
  return Object.hasOwn(UI_STRINGS, key);
}

/** The string for `key`, with `{name}` placeholders filled from `params`; an unknown key reads as itself. */
export function formatString(key: string, params: Readonly<Record<string, string>> = {}): string {
  // hasString just proved the key is there
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const template = hasString(key) ? UI_STRINGS[key]! : key;
  return template.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) => params[name] ?? whole);
}
