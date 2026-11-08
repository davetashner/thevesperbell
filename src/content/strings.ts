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
  'caption.direction.ahead': 'ahead',
  'caption.direction.ahead-right': 'ahead right',
  'caption.direction.right': 'right',
  'caption.direction.behind-right': 'behind right',
  'caption.direction.behind': 'behind',
  'caption.direction.behind-left': 'behind left',
  'caption.direction.left': 'left',
  'caption.direction.ahead-left': 'ahead left',
} as const;

/** Every string by key. */
export const UI_STRINGS: Readonly<Record<string, string>> = CAPTION_STRINGS;

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
