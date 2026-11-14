// mw-e39.3: the canon glossary. AC-3 reads docs/narrative/story-bible.md itself, so a name, place,
// creature type or canon number the bible lists but the glossary lacks fails here with the bible's
// own words, and an entry added to the glossary appears once.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  glossary,
  glossarySchema,
  normaliseName,
  parseGlossary,
  type Glossary,
} from './glossary.ts';

const bible = readFileSync('docs/narrative/story-bible.md', 'utf8');

/** The text of one bible section: from its `##`/`###` heading to the next heading of any level. */
function sectionText(number: string): string {
  const lines = bible.split('\n');
  const start = lines.findIndex((line) =>
    new RegExp(`^#{2,3} ${number.replace('.', '\\.')}[ .]`).test(line),
  );
  expect(start, `bible section ${number} exists`).toBeGreaterThanOrEqual(0);
  const length = lines.slice(start + 1).findIndex((line) => /^#{2,3} |^---$/.test(line));
  return lines.slice(start, length < 0 ? undefined : start + 1 + length).join('\n');
}

/** Bold spans, joined across the line wraps the bible uses. */
const boldSpans = (text: string): string[] =>
  [...text.replace(/\n(?!\n)/g, ' ').matchAll(/\*\*([^*]+?)\*\*/g)].map((m) => (m[1] ?? '').trim());

const normalisedNames = (entries: readonly { name: string }[]): Set<string> =>
  new Set(entries.map((e) => normaliseName(e.name)));

const everyName = (g: Glossary): Set<string> =>
  new Set(
    [...g.characters, ...g.places, ...g.creatures, ...g.terms, ...g.texts].map((e) =>
      normaliseName(e.name),
    ),
  );

describe('glossary schema', () => {
  const valid = () => structuredClone(glossary) as unknown as Record<string, unknown[]>;
  const first = (g: Record<string, unknown[]>, key: string) =>
    g[key]?.[0] as Record<string, unknown>;

  it('accepts the shipped glossary', () => {
    expect(glossarySchema.safeParse(glossary).success).toBe(true);
  });

  const problems = (value: unknown): { path: string; message: string }[] =>
    (glossarySchema.safeParse(value).error?.issues ?? []).map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));

  it('rejects a duplicate id, naming the field and the section that has it', () => {
    const g = valid();
    first(g, 'places')['id'] = 'place-wendmouth';
    const [issue] = problems(g);
    expect(issue?.message).toBe('duplicate id "place-wendmouth" (also in places)');
    expect(issue?.path).toMatch(/^places\.\d+\.id$/);
  });

  it('rejects a duplicate name within a kind, ignoring case, articles and asides', () => {
    const g = valid();
    g['places'] = [
      ...(g['places'] ?? []),
      { ...first(g, 'places'), id: 'place-extra', name: 'briar glen (again)' },
    ];
    const [issue] = problems(g);
    expect(issue?.message).toBe('duplicate name "briar glen (again)" in places');
    expect(issue?.path).toMatch(/^places\.\d+\.name$/);
  });

  it('rejects an id with the wrong prefix and an unknown field', () => {
    const g = valid();
    first(g, 'characters')['id'] = 'mirela';
    expect(problems(g)[0]).toEqual({ path: 'characters.0.id', message: 'must start with npc' });
    const h = valid();
    first(h, 'characters')['nickname'] = 'x';
    expect(problems(h)[0]?.message).toMatch(/nickname/);
    expect(() => parseGlossary(h)).toThrow();
  });

  it('normaliseName drops asides, articles, case and trailing punctuation', () => {
    expect(normaliseName('The Bridgeward College (placeholder name, Briar Glen)')).toBe(
      'bridgeward college',
    );
    expect(normaliseName('A Traveller’s Account of the Glen')).toBe(
      'traveller’s account of the glen',
    );
    expect(normaliseName('Ages and sizes.')).toBe('ages and sizes');
  });
});

describe('glossary against the story bible', () => {
  it('AC-3: every principal NPC of 5.1 to 5.12 is present exactly once, by its heading', () => {
    const principals = glossary.characters.filter((c) => c.tier === 'principal');
    for (let n = 1; n <= 12; n++) {
      const heading = bible.split('\n').find((l) => l.startsWith(`### 5.${String(n)} `)) ?? '';
      const matches = principals.filter(
        (c) => c.section === `5.${String(n)}` && heading.includes(c.name),
      );
      expect(
        matches.map((c) => c.id),
        heading,
      ).toHaveLength(1);
    }
    expect(principals.filter((c) => Number(c.section.split('.')[1]) <= 12)).toHaveLength(12);
  });

  it('AC-3: every harbour principal of 5.13 is present exactly once', () => {
    const harbour = boldSpans(sectionText('5.13'))
      .filter((span) => span.includes(' — '))
      .map((span) => span.split(' — ')[0] ?? '');
    expect(harbour).toHaveLength(5);
    for (const span of harbour) {
      const matches = glossary.characters.filter(
        (c) => c.section === '5.13' && span.includes(c.name),
      );
      expect(
        matches.map((c) => c.id),
        span,
      ).toHaveLength(1);
    }
  });

  it('every minor named character of 5.14 to 5.17 is present exactly once', () => {
    const spans = [...boldSpans(sectionText('5.14')).flatMap((s) => s.split(', '))].filter(
      (s) => !s.startsWith('"Mr. S'),
    );
    expect(spans.length).toBeGreaterThanOrEqual(14);
    for (const span of spans) {
      const matches = glossary.characters.filter(
        (c) => c.section === '5.14' && span.includes(c.name),
      );
      expect(
        matches.map((c) => c.id),
        span,
      ).toHaveLength(1);
    }
    for (const n of ['5.15', '5.16', '5.17']) {
      const heading = sectionText(n);
      const found = glossary.characters.filter((c) => c.section === n && heading.includes(c.name));
      expect(found.length, `section ${n}`).toBeGreaterThanOrEqual(1);
    }
    expect(glossary.characters.filter((c) => c.section === '5.16').map((c) => c.id)).toEqual([
      'npc-garrick',
      'npc-rooke',
    ]);
  });

  it('AC-3: every location named in 3.5 is present exactly once', () => {
    // Bold spans of 3.5 that are not places: a guard post's body, a person, a heading's description.
    const notPlaces = new Set([
      'bridge watch',
      'robed figure under the bridge',
      'idris quillon',
      "captain hale's watch",
      'fighting',
      'archery',
    ]);
    const spans = boldSpans(sectionText('3.5'))
      .map(normaliseName)
      .filter((s) => !notPlaces.has(s));
    expect(spans.length).toBeGreaterThanOrEqual(12);
    const names = normalisedNames(glossary.places.filter((p) => p.section === '3.5'));
    for (const span of spans) expect(names.has(span), `3.5 place "${span}"`).toBe(true);
  });

  it('AC-3: the 3.6 Wendmouth places are present exactly once', () => {
    const checklist = [
      'The Stone Wharf',
      'The Customs House',
      'The Bonded Warehouse',
      'bay nine',
      'The Drowned Gull',
      'The Tidemarket',
      'The Undertow',
      'The Net Lofts',
      'The Breakwater',
    ];
    const text = sectionText('3.6');
    for (const place of checklist) {
      expect(text, `3.6 names ${place}`).toContain(`**${place}`);
      expect(
        glossary.places.filter((p) => normaliseName(p.name) === normaliseName(place)),
      ).toHaveLength(1);
    }
  });

  it('AC-3: every creature type of 8 is present exactly once, and there are ten', () => {
    const rows = sectionText('8')
      .split('\n')
      .filter((line) => line.startsWith('| **'))
      .map((line) => normaliseName(/\*\*([^*]+)\*\*/.exec(line)?.[1] ?? ''));
    expect(rows).toHaveLength(10);
    expect(glossary.creatures).toHaveLength(10);
    const names = glossary.creatures.map((c) => normaliseName(c.name));
    expect(names.sort()).toEqual([...rows].sort());
  });

  it('AC-3: every canon number in 11.3 is present exactly once', () => {
    const spans = boldSpans(sectionText('11.3').split('**Deliberately open')[0] ?? '');
    // Bold spans of 11.3 that are canon claims without a number, or labels, covered elsewhere.
    const notNumbers = new Set([
      'the last', // Horn is the last Hornfolk (a name fact, not a figure)
      'unnamed', // the empire's name is deliberately open
      'crown', // the empire's coin
      'optional', // Wendmouth is optional
      'no new creature types', // Wendmouth adds none (creature-type-count)
      'E. Ardley', // a name; see characters and "dead a year"
      'grandfather', // Harrow Vane's grandfather (silver-struck)
      'Ages and sizes.',
      'Counts (what downstream e39 items reference).',
    ]);
    const claimed = spans.filter((s) => !notNumbers.has(s));
    const entries = glossary.numbers;
    for (const span of new Set(claimed)) {
      const seen = claimed.filter((s) => s === span).length;
      const covered = entries
        .filter((n) => n.quote === span)
        .reduce((sum, n) => sum + (n.occurrences ?? 1), 0);
      expect(covered, `11.3 bold span "${span}" appears ${String(seen)} time(s)`).toBe(seen);
    }
    for (const entry of entries) {
      expect(claimed, `${entry.id} quotes 11.3`).toContain(entry.quote);
    }
  });

  it('the canon counts agree with the glossary tallies', () => {
    const value = (id: string) => glossary.numbers.find((n) => n.id === id)?.value;
    const principals = glossary.characters.filter((c) => c.tier === 'principal');
    expect(value('principal-count')).toBe(principals.filter((c) => c.section !== '5.13').length);
    expect(value('harbour-principal-count')).toBe(
      principals.filter((c) => c.section === '5.13').length,
    );
    expect(value('creature-type-count')).toBe(glossary.creatures.length);
  });

  it('every glossary term of 11.2 is present in the glossary', () => {
    const terms = sectionText('11.2')
      .split('\n')
      .filter((line) => line.startsWith('- **'))
      .map((line) => /\*\*([^*]+)\*\*/.exec(line)?.[1] ?? '');
    expect(terms.length).toBeGreaterThanOrEqual(40);
    const known = everyName(glossary);
    for (const term of terms)
      expect(known.has(normaliseName(term)), `11.2 term "${term}"`).toBe(true);
  });

  it('every in-world text of 7.2 is present exactly once', () => {
    const titles = sectionText('7.2')
      .split('\n')
      .filter((line) => line.startsWith('**'))
      .map((line) => normaliseName(/^\*\*([^*]+)\*\*/.exec(line)?.[1] ?? ''));
    expect(titles).toHaveLength(13);
    const listed = glossary.texts.filter((t) => t.section === '7.2');
    expect(listed.map((t) => normaliseName(t.name)).sort()).toEqual([...titles].sort());
  });

  it('every friend-below note of 7.5 is a registered text', () => {
    const notes = glossary.texts.filter((t) => t.section === '7.5');
    expect(notes.length).toBeGreaterThanOrEqual(6);
    expect(notes.length).toBeLessThanOrEqual(8);
    for (const t of notes) expect(t.id).toMatch(/^note-friend-below-/);
  });

  it('keeps each id and canonical NPC id unique across the whole file', () => {
    const ids = [
      ...glossary.characters,
      ...glossary.places,
      ...glossary.creatures,
      ...glossary.numbers,
      ...glossary.terms,
      ...glossary.texts,
    ].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
