import { describe, expect, it } from 'vitest';
import { glossary } from '@content/narrative/glossary';
import { editDistance, lintNarrative, parseNumber, type LintEnv } from './lint';
import { extract, gatesOnClass, isNarrativeSource } from './extract';

const FILE = 'src/content/data/dialogue/talk.json';
const env: LintEnv = {
  glossary,
  fact: (key) => ['tansy.saved', 'hale.jailed'].includes(key),
  npc: (id) => ['npc-hale', 'npc-mirela'].includes(id),
  item: (id) => id === 'bread-loaf',
  quest: (id) => id === 'quest-real',
  scene: (id) => id === 'briar-glen-green',
};

/** A dialogue file whose one line says `text` (written over several lines, so line numbers matter). */
const talk = (
  text: string,
  extra: Record<string, unknown> = {},
): { path: string; text: string } => ({
  path: FILE,
  text: JSON.stringify(
    {
      id: 'talk',
      speakers: [{ id: 'm', npc: 'npc-mirela' }],
      entries: [{ id: 'main', node: 'hello' }],
      nodes: [{ id: 'hello', kind: 'line', speaker: 'm', text, end: true }],
      ...extra,
    },
    null,
    2,
  ),
});
const lint = (text: string, extra: Record<string, unknown> = {}) =>
  lintNarrative([talk(text, extra)], env);
const messages = (issues: readonly { message: string }[]) => issues.map((i) => i.message);

describe('narrative lint: names', () => {
  it('AC-1: "Mirella" is an error naming file and line and suggesting "Mirela"', () => {
    const { errors } = lint('Welcome to the Stacks. Ask Mirella about the shelves.');
    expect(errors).toEqual([
      {
        level: 'error',
        check: 'name',
        file: FILE,
        line: 20,
        message: '"Mirella" looks like a misspelling of "Mirela" (canon glossary)',
      },
    ]);
  });

  it('AC-1: "Kettlebach", plurals, possessives and shouting are near-misses too', () => {
    expect(messages(lint('Kettlebach rules.').errors)[0]).toContain('"Kettleback"');
    expect(messages(lint("Kettlebach's kitchen.").errors)).toHaveLength(1);
    expect(messages(lint('The Kettlebachs.').errors)).toHaveLength(1);
    expect(messages(lint('MIRELLA!').errors)).toHaveLength(1);
    expect(messages(lint('Brannock swore.').errors)[0]).toContain('"Brannoc"');
  });

  it('AC-1: correct names, ordinary words, short names and lower case are not flagged', () => {
    const text =
      "Mirela, Kettleback's own Briar Glen. Fetch it, Fitch. The thorn stood. Hales and a briar. Standing in line; a stand-in.";
    expect(lint(text).errors).toEqual([]);
  });

  it('AC-1: a capitalised word that is ordinary elsewhere in the corpus is not a near-miss', () => {
    const files = [
      talk('Mirella spoke.'),
      { ...talk('a mirella is a flower.'), path: 'a/dialogue/x.json' },
    ];
    expect(lintNarrative(files, env).errors).toEqual([]);
  });

  it('AC-1: names in author notes are checked too', () => {
    expect(lint('Hello.', { notes: 'Mirella is the bookseller.' }).errors).toHaveLength(1);
  });

  it('measures edit distance with swaps as one edit', () => {
    expect(editDistance('mirela', 'mirela')).toBe(0);
    expect(editDistance('mirela', 'mirella')).toBe(1);
    expect(editDistance('mirela', 'mirlea')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('narrative lint: canon numbers', () => {
  it('AC-2: "sixty years ago" for the Long Vespers cites bible 11.3', () => {
    const { errors } = lint('The Long Vespers was sixty years ago, they say.');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ check: 'canon-number', file: FILE, level: 'error' });
    expect(errors[0]?.message).toBe(
      '"sixty years ago" contradicts canon: story bible 11.3 says "61 years ago" (long-vespers-years-ago)',
    );
  });

  it('AC-2: digits, hyphenated and hundred forms are read; the canon value passes', () => {
    expect(lint('The Long Vespers was 62 years ago.').errors).toHaveLength(1);
    expect(lint('The Long Vespers, sixty-two years ago.').errors).toHaveLength(1);
    expect(lint('The priory was raised three hundred years ago.').errors).toHaveLength(0);
    expect(lint('The priory stood two hundred years ago.').errors).toHaveLength(1);
    expect(lint('The Long Vespers was sixty-one years ago.').errors).toEqual([]);
    expect(lint('The Long Vespers was 61 years ago.').errors).toEqual([]);
  });

  it('AC-2: the bounty, the breach, Tansy and the rest follow bible 11.3', () => {
    expect(lint('A bounty of 500 crowns, raised to 800 crowns.').errors).toEqual([]);
    expect(lint('There is a bounty of 600 crowns.').errors).toHaveLength(1);
    expect(lint('Four hundred crowns now, and the bounty after.').errors).toEqual([]);
    expect(lint('The breach was three months ago.').errors).toEqual([]);
    expect(lint('The breach was nine months ago.').errors).toHaveLength(1);
    expect(lint('Six went missing for three weeks.').errors).toEqual([]);
    expect(lint('They vanished for five weeks.').errors).toHaveLength(1);
    expect(lint('Tansy is twelve years old.').errors).toEqual([]);
    expect(lint('Tansy is nine years old.').errors).toHaveLength(1);
    expect(lint("Mooring's Watch emptied forty years ago.").errors).toEqual([]);
    expect(lint("Mooring's Watch emptied fifty years ago.").errors).toHaveLength(1);
    expect(lint('Silver was struck twenty years ago.').errors).toHaveLength(1);
    expect(lint('The Vanes have run it for five generations.').errors).toEqual([]);
    expect(lint('The Vanes have run it for seven generations.').errors).toHaveLength(1);
  });

  it('AC-2: the nearest subject owns the quantity, and far or unrelated numbers are ignored', () => {
    expect(
      lint('The priory, built sixty years ago, outlived the Vespers 61 years ago.').errors,
    ).toHaveLength(1);
    expect(
      lint(
        'The Long Vespers ended, and the people of the glen kept their lamps lit through all the long dark nights that followed, and the hall has stood here ninety years ago.',
      ).errors,
    ).toEqual([]);
    expect(lint('I walked for lots years ago and many weeks.').errors).toEqual([]);
    expect(lint('Nothing here but twelve crowns.').errors).toEqual([]);
  });

  it('parses number words', () => {
    expect(parseNumber('61')).toBe(61);
    expect(parseNumber('Sixty-one')).toBe(61);
    expect(parseNumber('three hundred')).toBe(300);
    expect(parseNumber('lots')).toBeUndefined();
    expect(parseNumber('one-two-three')).toBeUndefined();
  });
});

describe('narrative lint: dangling references', () => {
  const nodes = (extraNode: Record<string, unknown>) => ({
    nodes: [
      { id: 'hello', kind: 'line', speaker: 'm', text: 'Hi.', next: 'more' },
      { id: 'more', kind: 'effect', effects: [extraNode], end: true },
    ],
  });

  it('AC-3: a non-existent fact or location ID is a dangling-reference error', () => {
    const fact = lint('Hi.', nodes({ kind: 'setFact', fact: 'ghost.fact', value: true }));
    expect(fact.errors).toEqual([
      expect.objectContaining({
        check: 'dangling-ref',
        message: 'fact "ghost.fact" does not exist',
        file: FILE,
      }),
    ]);
    expect(fact.errors[0]?.line).toBeGreaterThan(1);
    const place = lint('Hi.', nodes({ kind: 'teleport', location: 'place-nowhere' }));
    expect(messages(place.errors)).toEqual(['location "place-nowhere" does not exist']);
  });

  it('AC-3: NPC, item and quest ids are resolved too; known ids pass', () => {
    const bad = lint(
      'Hi.',
      nodes({ kind: 'x', npc: 'npc-ghost', item: 'gold-pie', quest: 'quest-fake' }),
    );
    expect(messages(bad.errors)).toEqual([
      'npc "npc-ghost" does not exist',
      'item "gold-pie" does not exist',
      'quest "quest-fake" does not exist',
    ]);
    const good = lint(
      'Hi.',
      nodes({
        kind: 'x',
        fact: 'tansy.saved',
        npc: 'npc-hale',
        item: 'bread-loaf',
        quest: 'quest-real',
        scene: 'briar-glen-green',
        place: 'place-briar-glen',
      }),
    );
    expect(good.errors).toEqual([]);
  });

  it('AC-3: emit event names are hooks and are never dangling', () => {
    expect(
      lint('Hi.', nodes({ kind: 'emit', event: 'smith.repair-armour', data: { npc: 'npc-hale' } }))
        .errors,
    ).toEqual([]);
  });

  it('AC-3: npc, place and species ids written in notes must exist', () => {
    const { errors } = lint('Hi.', {
      notes:
        'Talks to npc-hale and npc-nobody near place-briar-glen, place-nowhere, species-forgotten.',
    });
    expect(messages(errors)).toEqual([
      '"npc-nobody" is not a known character, place or species id',
      '"place-nowhere" is not a known character, place or species id',
    ]);
    expect(lint('Hi.', { notes: 'See npc-mirela.' }).errors).toEqual([]);
  });
});

describe('narrative lint: warnings', () => {
  it('AC-4: a banned-tone phrase is a warning with the matched phrase', () => {
    const { errors, warnings } = lint('Okay, dude, check your quest log. No worries.');
    expect(errors).toEqual([]);
    expect(warnings.map((w) => w.check)).toEqual(['tone', 'tone', 'tone', 'tone']);
    expect(messages(warnings)).toEqual([
      'modern slang phrase "Okay" breaks the setting\'s voice (content conventions)',
      'modern slang phrase "dude" breaks the setting\'s voice (content conventions)',
      'modern slang phrase "No worries" breaks the setting\'s voice (content conventions)',
      'fourth wall phrase "quest log" breaks the setting\'s voice (content conventions)',
    ]);
    expect(warnings[0]).toMatchObject({ level: 'warning', file: FILE, line: 20 });
  });

  it('AC-4: tone is not checked in author notes or registry descriptions', () => {
    expect(lint('Hi.', { notes: 'Okay, this is a quest log note.' }).warnings).toEqual([]);
    const fact = {
      path: 'src/content/data/fact/x.json',
      text: JSON.stringify({ facts: [{ key: 'a.b', description: 'Set when the player clicks.' }] }),
    };
    expect(lintNarrative([fact], env).warnings).toEqual([]);
  });

  it('AC-4: American spelling in player text is a warning suggesting the British form', () => {
    const { errors, warnings } = lint('Polish your armor, Rumors say the color of honored gray.');
    expect(errors).toEqual([]);
    expect(messages(warnings)).toEqual([
      'American spelling "armor": in-game text is British-leaning, use "armour"',
      'American spelling "Rumors": in-game text is British-leaning, use "rumours"',
      'American spelling "color": in-game text is British-leaning, use "colour"',
      'American spelling "honored": in-game text is British-leaning, use "honoured"',
      'American spelling "gray": in-game text is British-leaning, use "grey"',
    ]);
    expect(lint('British armour and colour.').warnings).toEqual([]);
  });

  it('a -<class> option or entry id needs the matching playerClass condition', () => {
    const gate = (cls: string) => ({ kind: 'playerClass', class: cls });
    const { warnings } = lint('Hi.', {
      entries: [
        { id: 'first-knight', node: 'hello', when: gate('knight') },
        { id: 'first-thief', node: 'hello' },
      ],
      nodes: [
        {
          id: 'hello',
          kind: 'choice',
          options: [
            { id: 'oath-knight', text: 'I swear.', when: gate('knight'), next: 'hello' },
            {
              id: 'oath-archer',
              text: 'I swear.',
              when: { kind: 'all', of: [gate('thief')] },
              next: 'hello',
            },
            { id: 'tracks-sorcerer', text: 'Tracks?', next: 'hello' },
            { id: 'plain', text: 'Plain.', next: 'hello' },
          ],
        },
      ],
    });
    expect(messages(warnings)).toEqual([
      'entry "first-thief" ends in "-thief" but has no playerClass "thief" condition',
      'option "oath-archer" ends in "-archer" but has no playerClass "archer" condition',
      'option "tracks-sorcerer" ends in "-sorcerer" but has no playerClass "sorcerer" condition',
    ]);
    expect(warnings.every((w) => w.check === 'class-gate')).toBe(true);
  });

  it('a variants map with no "all" fallback warns for the classes it skips', () => {
    const file = {
      path: 'src/content/data/rumor/rumor-01-x.json',
      text: JSON.stringify(
        { id: 'x', variants: { knight: 'K.', thief: 'T.' }, other: { variants: { all: 'A.' } } },
        null,
        2,
      ),
    };
    const { warnings } = lintNarrative([file], env);
    expect(warnings).toEqual([
      expect.objectContaining({
        check: 'class-variants',
        line: 3,
        message: 'variants has no "all" fallback and no text for: archer, sorcerer',
      }),
    ]);
  });
});

describe('narrative lint: scope and extraction', () => {
  it('only narrative files are read', () => {
    expect(isNarrativeSource('src/content/data/dialogue/a.json')).toBe(true);
    expect(isNarrativeSource('src/content/data/fact/a.json')).toBe(true);
    expect(isNarrativeSource('src/content/data/creature/npc-hale.json')).toBe(true);
    expect(isNarrativeSource('src/content/data/creature/forgotten-miner.json')).toBe(false);
    expect(isNarrativeSource('src/content/data/scene/a.json')).toBe(false);
    const report = lintNarrative(
      [{ path: 'src/content/data/scene/a.json', text: '{"text": "Mirella"}' }, talk('Hi.')],
      env,
    );
    expect(report).toEqual({ files: 1, errors: [], warnings: [] });
  });

  it('finds line numbers through repeated text, escapes and nested arrays', () => {
    const raw =
      '{\n  "a": { "text": "same" },\n  "pages": ["same", "caf\\u00e9"],\n  "text": "later"\n}';
    const found = extract('x/note/n.json', raw);
    expect(found.texts.map((t) => [t.value, t.line, t.kind])).toEqual([
      ['same', 2, 'player'],
      ['same', 3, 'player'],
      ['café', 3, 'player'],
      ['later', 4, 'player'],
    ]);
    const absent = extract('x/note/n.json', '{"text": "x"}'.replace('"x"', '"y"'));
    expect(absent.texts[0]?.line).toBe(1);
  });

  it('ignores numbers and nulls under text keys, and text with no letters', () => {
    const found = extract('x/note/n.json', '{"text": 5, "pages": [null, "12 34"]}');
    expect(found.texts.map((t) => t.value)).toEqual(['12 34']);
    expect(lint('12 34 !').errors).toEqual([]);
  });

  it('descriptions are author text under fact and creature, player text elsewhere', () => {
    const fact = extract('x/fact/f.json', '{"description": "d"}');
    const rumor = extract('x/rumor/r.json', '{"description": "d"}');
    expect(fact.texts[0]?.kind).toBe('author');
    expect(rumor.texts[0]?.kind).toBe('player');
  });

  it('gatesOnClass looks through arrays and nested conditions', () => {
    expect(gatesOnClass([{ kind: 'playerClass', class: 'thief' }], 'thief')).toBe(true);
    expect(
      gatesOnClass({ kind: 'not', condition: { kind: 'playerClass', class: 'thief' } }, 'knight'),
    ).toBe(false);
    expect(gatesOnClass('x', 'thief')).toBe(false);
    expect(gatesOnClass(undefined, 'thief')).toBe(false);
  });
});
