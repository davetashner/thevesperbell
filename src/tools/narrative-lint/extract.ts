// Pulls the text and the references out of one narrative content file for the narrative lint
// (mw-e39.24). Every string carries the 1-based line of the file it starts on, found by searching the
// raw text for the string's JSON encoding in document order, so the lint can say "file:line".

/** `player` text is shown in the game; `author` text is a design note (notes, registry descriptions). */
export type TextKind = 'player' | 'author';

export interface TextSpan {
  readonly kind: TextKind;
  readonly value: string;
  readonly line: number;
}

/** A content id a file names in a field that holds one (`fact`, `npc`, `item`, `quest`, `scene`...). */
export type RefField = 'fact' | 'npc' | 'item' | 'quest' | 'place';

export interface RefSpan {
  readonly field: RefField;
  readonly value: string;
  readonly line: number;
}

export interface GateSpan {
  /** `option` or `entry`. */
  readonly what: 'option' | 'entry';
  readonly id: string;
  readonly line: number;
  /** The `when` condition, or undefined when ungated. */
  readonly when: unknown;
}

export interface VariantsSpan {
  readonly keys: readonly string[];
  readonly line: number;
}

export interface Extracted {
  readonly texts: readonly TextSpan[];
  readonly refs: readonly RefSpan[];
  readonly gates: readonly GateSpan[];
  readonly variants: readonly VariantsSpan[];
}

const PLAYER_KEYS = new Set(['text', 'label', 'title', 'summary', 'journal', 'body', 'pages']);
const AUTHOR_KEYS = new Set(['notes', 'note']);
const REF_KEYS: Readonly<Record<string, RefField>> = {
  fact: 'fact',
  npc: 'npc',
  item: 'item',
  quest: 'quest',
  scene: 'place',
  location: 'place',
  place: 'place',
};

/** A file the lint reads: dialogue, quest, rumour, narration, book, note, inscription, description, fact or NPC. */
export const isNarrativeSource = (path: string): boolean =>
  /(^|\/)(dialogue|quest|rumor|narration|book|note|inscription|description|fact)\/[^/]+\.json$/.test(path) ||
  /(^|\/)creature\/npc-[^/]+\.json$/.test(path);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const prop = (record: Record<string, unknown>, key: string): unknown => record[key];

/** Whether `condition` (anywhere inside it) is a `playerClass` check for `playerClass`. */
export function gatesOnClass(condition: unknown, playerClass: string): boolean {
  if (Array.isArray(condition)) return condition.some((c) => gatesOnClass(c, playerClass));
  if (!isRecord(condition)) return false;
  if (prop(condition, 'kind') === 'playerClass' && prop(condition, 'class') === playerClass) {
    return true;
  }
  return Object.values(condition).some((c) => gatesOnClass(c, playerClass));
}

/** Extracts the narrative text, references, class gates and variant maps of one file. */
export function extract(path: string, raw: string): Extracted {
  const texts: TextSpan[] = [];
  const refs: RefSpan[] = [];
  const gates: GateSpan[] = [];
  const variants: VariantsSpan[] = [];
  const authorDir = /(^|\/)(fact|creature)\//.test(path);
  let pos = 0;
  let line = 1;

  /** The line `value` (a string or key) starts on, moving the cursor forward. */
  const lineOf = (needle: string): number => {
    const at = raw.indexOf(needle, pos);
    if (at < 0) return line;
    for (let i = pos; i < at; i++) if (raw.charCodeAt(i) === 10) line++;
    pos = at + needle.length;
    return line;
  };

  const strings = (value: unknown, kind: TextKind): void => {
    if (typeof value === 'string') {
      texts.push({ kind, value, line: lineOf(JSON.stringify(value)) });
    } else if (Array.isArray(value)) {
      for (const item of value) strings(item, kind);
    } else if (isRecord(value)) {
      for (const item of Object.values(value)) strings(item, kind);
    }
  };

  const walk = (node: unknown, gate?: GateSpan['what']): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, gate);
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, value] of Object.entries(node)) {
      lineOf(JSON.stringify(key));
      if (key === 'id' && gate !== undefined && typeof value === 'string') {
        gates.push({
          what: gate,
          id: value,
          line: lineOf(JSON.stringify(value)),
          when: prop(node, 'when'),
        });
        continue;
      }
      const field = REF_KEYS[key];
      if (field !== undefined && typeof value === 'string') {
        refs.push({ field, value, line: lineOf(JSON.stringify(value)) });
      } else if (key === 'variants' && isRecord(value)) {
        variants.push({ keys: Object.keys(value), line });
        strings(value, 'player');
      } else if (key === 'options' || key === 'entries') {
        walk(value, key === 'options' ? 'option' : 'entry');
      } else if (AUTHOR_KEYS.has(key) || (key === 'description' && authorDir)) {
        strings(value, 'author');
      } else if (PLAYER_KEYS.has(key) || key === 'description') {
        strings(value, 'player');
      } else {
        walk(value);
      }
    }
  };

  walk(JSON.parse(raw));
  return { texts, refs, gates, variants };
}
