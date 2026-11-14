// The narrative lint (mw-e39.24, pnpm narrative:lint). It checks story content (dialogue, quests,
// rumours, notes, inscriptions, descriptions, facts, NPC entries) against the canon glossary
// (src/content/narrative/glossary.json, transcribed from docs/narrative/story-bible.md):
//
//   errors   name           a proper name one edit away from a glossary name ("Mirella", "Kettlebach")
//            canon-number   a canon figure that disagrees with bible 11.3 (the Long Vespers, the bounty...)
//            dangling-ref   a fact, NPC, item, quest, scene or place id nothing declares
//   warnings class-gate     a `-<class>` option or entry id with no matching `playerClass` condition
//            class-variants a `variants` map with no `all` fallback
//            tone           modern slang or fourth-wall phrasing in player text
//            spelling       American spelling in player text (in-game text is British-leaning)
//
// The checks are pure functions of (sources, env); cli.ts wires them to the real content. Emit
// `event` names are deliberately never checked: hooks are intentionally unconsumed.

import type { ContentSource } from '@content/loader';
import { NARRATIVE_CLASSES, missingClassVariants } from '@content/narrative/class-variants';
import type { Glossary } from '@content/narrative/glossary';
import { extract, gatesOnClass, isNarrativeSource, type TextSpan } from './extract';

export type LintLevel = 'error' | 'warning';
export type LintCheck =
  'name' | 'canon-number' | 'dangling-ref' | 'class-gate' | 'class-variants' | 'tone' | 'spelling';

export interface LintIssue {
  readonly level: LintLevel;
  readonly check: LintCheck;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

export interface LintReport {
  readonly files: number;
  readonly errors: readonly LintIssue[];
  readonly warnings: readonly LintIssue[];
}

/** What the lint can resolve: registered facts and the ids game content declares. */
export interface LintEnv {
  readonly glossary: Glossary;
  readonly fact: (key: string) => boolean;
  readonly npc: (id: string) => boolean;
  readonly item: (id: string) => boolean;
  readonly quest: (id: string) => boolean;
  readonly scene: (id: string) => boolean;
}

// ---------------------------------------------------------------- names

const words = (text: string): string[] => text.match(/\p{L}[\p{L}'’]*/gu) ?? [];
const stem = (word: string): string => word.replace(/['’]s$/i, '').replace(/^[-'’]+|[-'’]+$/g, '');

/** Edit distance, with adjacent swaps counting as one edit. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  const cell = (i: number, j: number): number => Number(d[i]?.[j]);
  for (let j = 1; j <= b.length; j++) d[0]?.push(j);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(cell(i - 1, j) + 1, cell(i, j - 1) + 1, cell(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, cell(i - 2, j - 2) + 1);
      }
      d[i]?.push(best);
    }
  }
  return cell(a.length, b.length);
}

/** Longest edit distance still counted as a near-miss for a word of `length` letters. */
const nearLimit = (length: number): number => (length >= 8 ? 2 : 1);
/** Words shorter than this are not compared: one edit turns "Hale" or "Fitch" into too many ordinary words ("Fetch"). */
const MIN_NAME_LETTERS = 6;

interface NameIndex {
  /** Lower-case name word to its spelling in the glossary. */
  readonly vocab: ReadonlyMap<string, string>;
}

function nameIndex(glossary: Glossary): NameIndex {
  const vocab = new Map<string, string>();
  const entries = [
    ...glossary.characters,
    ...glossary.places,
    ...glossary.creatures,
    ...glossary.terms,
    ...glossary.texts,
  ];
  for (const entry of entries) {
    for (const word of words(entry.name.replace(/\([^)]*\)/g, ''))) {
      const clean = stem(word);
      if (clean.length >= 4 && /^[A-Z]/.test(clean)) vocab.set(clean.toLowerCase(), clean);
    }
  }
  return { vocab };
}

/** Capitalised words of `spans` that are one or two edits from a glossary name word. */
function nearMisses(
  spans: readonly TextSpan[],
  index: NameIndex,
  ordinary: ReadonlySet<string>,
): { span: TextSpan; word: string; suggestion: string }[] {
  const found: { span: TextSpan; word: string; suggestion: string }[] = [];
  for (const span of spans) {
    for (const raw of words(span.value)) {
      const word = stem(raw);
      const shouting = word === word.toUpperCase();
      if (word.length < MIN_NAME_LETTERS || !(/^[A-Z]/.test(word) || shouting)) continue;
      const lower = word.toLowerCase();
      const singular = lower.endsWith('s') ? lower.slice(0, -1) : lower;
      if (index.vocab.has(lower) || index.vocab.has(singular)) continue;
      if (ordinary.has(lower) || ordinary.has(singular)) continue;
      for (const candidate of [lower, singular]) {
        const hit = [...index.vocab].find(
          ([name]) =>
            name.length >= MIN_NAME_LETTERS &&
            editDistance(candidate, name) <= nearLimit(name.length),
        );
        if (hit !== undefined) {
          found.push({ span, word, suggestion: hit[1] });
          break;
        }
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------- canon numbers

const UNITS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/** The whole number a numeral or number word ("61", "sixty-one", "three hundred") names. */
export function parseNumber(token: string): number | undefined {
  const text = token.toLowerCase();
  if (/^\d+$/.test(text)) return Number(text);
  const [head = '', ...rest] = text.split(' ');
  const hundreds = rest[0] === 'hundred';
  const parts = head.split('-');
  const values = parts.map((p) => UNITS[p]);
  if (values.some((v) => v === undefined) || parts.length > 2) return undefined;
  const total = (values as number[]).reduce((a, b) => a + b, 0);
  return hundreds ? total * 100 : total;
}

interface NumberRule {
  /** Glossary number id whose `quote` the message cites. */
  readonly cite: string;
  /** What the sentence is about. */
  readonly subject: RegExp;
  /** The unit that follows the number, as a regex source. */
  readonly unit: string;
  readonly allowed: readonly number[];
  /** Furthest, in characters, the quantity may sit from the subject and still be about it. */
  readonly near?: number;
}

/** Bible 11.3 as rules: a quantity is judged by the nearest subject in its sentence. */
const NUMBER_RULES: readonly NumberRule[] = [
  { cite: 'long-vespers-years-ago', subject: /\bvespers\b/gi, unit: 'years? ago', allowed: [61] },
  { cite: 'priory-age', subject: /\bpriory\b/gi, unit: 'years? ago', allowed: [300] },
  { cite: 'mooring-watch-abandoned', subject: /\bmooring/gi, unit: 'years? ago', allowed: [40] },
  { cite: 'silver-struck', subject: /\bsilver\b/gi, unit: 'years? ago', allowed: [35] },
  {
    cite: 'river-trade-age',
    subject: /\b(?:charter|kestrel lock|river trade|stone mine)\b/gi,
    unit: 'years? ago',
    allowed: [250],
  },
  { cite: 'oswin-father-clapper', subject: /\bclapper\b/gi, unit: 'years? ago', allowed: [80] },
  { cite: 'breach-months-ago', subject: /\bbreach/gi, unit: 'months? ago', allowed: [2, 3] },
  {
    cite: 'disappearance-weeks',
    subject: /\b(?:disappear\w*|vanish\w*|missing)\b/gi,
    unit: 'weeks?',
    allowed: [3],
  },
  {
    cite: 'bounty',
    subject: /\b(?:bounty|reward)\b/gi,
    unit: 'crowns?',
    allowed: [500, 800],
    near: 20,
  },
  { cite: 'tansy-age', subject: /\btansy\b/gi, unit: 'years? old', allowed: [12] },
  {
    cite: 'vane-generations',
    subject: /\b(?:vanes?|deepworks)\b/gi,
    unit: 'generations?',
    allowed: [5],
  },
];

const NUMBER_TOKEN = '([a-z0-9]+(?:-[a-z]+)?(?: hundred)?)';

function canonNumberIssues(
  span: TextSpan,
  file: string,
  glossary: Glossary,
  report: (issue: LintIssue) => void,
): void {
  const quotes = new Map(glossary.numbers.map((n) => [n.id, n.quote]));
  for (const sentence of span.value.split(/(?<=[.!?])\s+/)) {
    const subjects = NUMBER_RULES.map((rule) =>
      [...sentence.matchAll(rule.subject)].map((m) => m.index),
    );
    NUMBER_RULES.forEach((rule, ruleIndex) => {
      const unit = new RegExp(`\\b${NUMBER_TOKEN}\\s+${rule.unit}\\b`, 'gi');
      for (const match of sentence.matchAll(unit)) {
        const value = parseNumber(String(match[1]));
        if (value === undefined) continue;
        const distanceTo = (i: number): number =>
          Math.min(
            ...subjects
              .slice(i, i + 1)
              .flat()
              .map((at) => Math.abs(at - match.index)),
            1e9,
          );
        const mine = distanceTo(ruleIndex);
        if (mine > (rule.near ?? 80)) continue;
        if (NUMBER_RULES.some((_, i) => i !== ruleIndex && distanceTo(i) < mine)) continue;
        if (rule.allowed.includes(value)) continue;
        report({
          level: 'error',
          check: 'canon-number',
          file,
          line: span.line,
          message: `"${match[0]}" contradicts canon: story bible 11.3 says "${String(quotes.get(rule.cite))}" (${rule.cite})`,
        });
      }
    });
  }
}

// ---------------------------------------------------------------- tone and spelling

const TONE: readonly (readonly [string, string])[] = [
  [
    'modern slang',
    '\\b(?:okay|ok|cool|awesome|dude|guys|lol|kinda|gonna|wanna|no worries|my bad|epic|vibe|vibes|hang out|chill out)\\b',
  ],
  [
    'fourth wall',
    '\\b(?:quest log|video game|the game|npcs?|player character|hit points|xp|experience points|level up|respawn|cutscene|health bar|save point|tutorial|click|press [a-z]\\b|controller|keyboard|mouse)\\b',
  ],
];

/** American spelling to the British-leaning spelling in-game text uses (bible 11.1, conventions). */
const BRITISH: Readonly<Record<string, string>> = {
  armor: 'armour',
  color: 'colour',
  honor: 'honour',
  favor: 'favour',
  neighbor: 'neighbour',
  harbor: 'harbour',
  labor: 'labour',
  flavor: 'flavour',
  humor: 'humour',
  savior: 'saviour',
  behavior: 'behaviour',
  vapor: 'vapour',
  splendor: 'splendour',
  valor: 'valour',
  rumor: 'rumour',
  candor: 'candour',
  odor: 'odour',
  clamor: 'clamour',
  parlor: 'parlour',
  center: 'centre',
  theater: 'theatre',
  fiber: 'fibre',
  meager: 'meagre',
  saber: 'sabre',
  somber: 'sombre',
  specter: 'spectre',
  luster: 'lustre',
  defense: 'defence',
  offense: 'offence',
  pretense: 'pretence',
  gray: 'grey',
  cozy: 'cosy',
  plow: 'plough',
  mold: 'mould',
  jewelry: 'jewellery',
  traveler: 'traveller',
  catalog: 'catalogue',
};
const AMERICAN = new RegExp(
  `\\b(${Object.keys(BRITISH).join('|')})(s|ed|ing|ful|less|ite)?\\b`,
  'gi',
);

function textIssues(span: TextSpan, file: string, report: (issue: LintIssue) => void): void {
  for (const [kind, source] of TONE) {
    for (const match of span.value.matchAll(new RegExp(source, 'gi'))) {
      report({
        level: 'warning',
        check: 'tone',
        file,
        line: span.line,
        message: `${kind} phrase "${match[0]}" breaks the setting's voice (content conventions)`,
      });
    }
  }
  for (const match of span.value.matchAll(AMERICAN)) {
    const british = `${String(BRITISH[String(match[1]).toLowerCase()])}${match[2] ?? ''}`;
    report({
      level: 'warning',
      check: 'spelling',
      file,
      line: span.line,
      message: `American spelling "${match[0]}": in-game text is British-leaning, use "${british}"`,
    });
  }
}

// ---------------------------------------------------------------- the lint

/** `npc-`, `place-` and `species-` ids written out in notes must exist in the glossary or content. */
const ID_TOKEN = /\b(npc|place|species)-[a-z0-9]+(?:-[a-z0-9]+)*\b/g;

/** Lints every narrative file among `sources`; other content files are ignored. */
export function lintNarrative(sources: readonly ContentSource[], env: LintEnv): LintReport {
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  const add = (issue: LintIssue): void => {
    (issue.level === 'error' ? errors : warnings).push(issue);
  };
  const files = sources
    .filter((source) => isNarrativeSource(source.path))
    .map((source) => ({ path: source.path, ...extract(source.path, source.text) }));

  const index = nameIndex(env.glossary);
  const ordinary = new Set<string>();
  for (const file of files) {
    for (const span of file.texts) {
      for (const word of words(span.value)) {
        if (/^[a-z]/.test(word)) ordinary.add(stem(word).toLowerCase());
      }
    }
  }
  const glossaryIds = new Set(
    [...env.glossary.characters, ...env.glossary.places, ...env.glossary.creatures].map(
      (e) => e.id,
    ),
  );
  const places = new Set(env.glossary.places.map((p) => p.id));

  for (const file of files) {
    for (const miss of nearMisses(file.texts, index, ordinary)) {
      add({
        level: 'error',
        check: 'name',
        file: file.path,
        line: miss.span.line,
        message: `"${miss.word}" looks like a misspelling of "${miss.suggestion}" (canon glossary)`,
      });
    }
    for (const span of file.texts) {
      canonNumberIssues(span, file.path, env.glossary, add);
      if (span.kind === 'player') textIssues(span, file.path, add);
      for (const match of span.value.matchAll(ID_TOKEN)) {
        const id = match[0];
        if (!glossaryIds.has(id) && !env.npc(id)) {
          add({
            level: 'error',
            check: 'dangling-ref',
            file: file.path,
            line: span.line,
            message: `"${id}" is not a known character, place or species id`,
          });
        }
      }
    }
    for (const ref of file.refs) {
      const known: Readonly<Record<typeof ref.field, (id: string) => boolean>> = {
        fact: env.fact,
        npc: env.npc,
        item: env.item,
        quest: env.quest,
        place: (id) => env.scene(id) || places.has(id),
      };
      if (!known[ref.field](ref.value)) {
        add({
          level: 'error',
          check: 'dangling-ref',
          file: file.path,
          line: ref.line,
          message: `${ref.field === 'place' ? 'location' : ref.field} "${ref.value}" does not exist`,
        });
      }
    }
    for (const gate of file.gates) {
      const playerClass = NARRATIVE_CLASSES.find((c) => gate.id.endsWith(`-${c}`));
      if (playerClass !== undefined && !gatesOnClass(gate.when, playerClass)) {
        add({
          level: 'warning',
          check: 'class-gate',
          file: file.path,
          line: gate.line,
          message: `${gate.what} "${gate.id}" ends in "-${playerClass}" but has no playerClass "${playerClass}" condition`,
        });
      }
    }
    for (const variants of file.variants) {
      const missing = variants.fallback
        ? NARRATIVE_CLASSES.filter((c) => !variants.keys.includes(c))
        : missingClassVariants(Object.fromEntries(variants.keys.map((k) => [k, 'x'])));
      if (missing.length > 0 && variants.fallback) {
        add({
          level: 'warning',
          check: 'class-variants',
          file: file.path,
          line: variants.line,
          message: `class beat has no variant for: ${missing.join(', ')} (they see the generic text)`,
        });
      } else if (missing.length > 0) {
        add({
          level: 'warning',
          check: 'class-variants',
          file: file.path,
          line: variants.line,
          message: `variants has no "all" fallback and no text for: ${missing.join(', ')}`,
        });
      }
    }
  }
  return { files: files.length, errors, warnings };
}
