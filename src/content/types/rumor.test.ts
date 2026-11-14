// mw-e39.23: the rumour type and the harbour rumours 13-18, the harbour in-world texts and their
// evidence tags. Per-entry tests name their AC so `pnpm content:coverage` credits every entry.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gameContentSources, loadGameContent } from '../game-content.ts';
import { glossary } from '../narrative/glossary.ts';
import { describeContent, markExercised } from '../testing.ts';
import { rumorSchema, rumourPool, type Rumor } from './rumor.ts';
import { noteSchema } from './readable.ts';

const BIBLE = readFileSync('docs/narrative/story-bible.md', 'utf8').replace(/\n\s+/g, ' ');
const content = loadGameContent();
const rumours = content.all('rumor') as readonly Rumor[];
const glossaryIds = new Set(
  [
    ...glossary.characters,
    ...glossary.places,
    ...glossary.creatures,
    ...glossary.terms,
    ...glossary.texts,
  ].map((e) => e.id),
);
const questIds = new Set(content.all('quest').map((q) => q.id));
const sourceOf = (path: string): string => {
  const found = gameContentSources().find((s) => s.path.endsWith(path));
  if (found === undefined) throw new Error(`no content file ${path}`);
  return found.text;
};

const base = {
  id: 'rumor-99-test',
  notes: 'Test.',
  region: 'harbour',
  source: ['npc-nell'],
  truth: 'true',
  target: 'place-bay-nine',
  text: 'A rumour.',
  secondHand: { teller: 'npc-dot', text: 'A rumour, second-hand.' },
};
const problems = (value: unknown) =>
  (rumorSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('rumour schema', () => {
  it('accepts a true harbour rumour with a second-hand line', () => {
    expect(problems(base)).toEqual([]);
  });

  it('AC-4: a false rumour needs a debunk path, a true one may not have one', () => {
    expect(problems({ ...base, truth: 'false' })).toEqual([
      'debunk: a false rumour has a debunk path',
    ]);
    expect(
      problems({ ...base, truth: 'false', debunk: [{ via: 'ask', npc: 'npc-mags' }] }),
    ).toEqual([]);
    expect(problems({ ...base, debunk: [{ via: 'ask', npc: 'npc-mags' }] })).toEqual([
      'debunk: only a false or half-true rumour has a debunk path',
    ]);
  });

  it('AC-5: a harbour rumour needs a second-hand line; ids carry the bible number', () => {
    expect(problems({ ...base, secondHand: undefined })).toEqual([
      'secondHand: a harbour rumour has a second-hand line for the valley',
    ]);
    expect(problems({ ...base, id: 'rumor-x-test' })).toEqual([
      'id: a rumour id is `rumor-<nn>-<slug>`',
    ]);
  });

  it('rejects a target that is not a glossary or quest id, and over-long lines', () => {
    expect(problems({ ...base, target: 'bay-nine' }).length).toBe(1);
    expect(problems({ ...base, text: 'x'.repeat(241) }).length).toBe(1);
  });
});

describe('harbour rumours 13-18', () => {
  it('AC-1: there are six, numbered 13 to 18, each with a source and a truth value', () => {
    const numbers = rumours.map((r) => Number(/^rumor-(\d{2})-/.exec(r.id)?.[1])).sort();
    expect(numbers).toEqual([13, 14, 15, 16, 17, 18]);
    for (const r of rumours) {
      expect(r.region, r.id).toBe('harbour');
      expect(r.source.length, r.id).toBeGreaterThan(0);
      expect(['true', 'half', 'false']).toContain(r.truth);
    }
  });

  it('AC-1: the bible text of each rumour is the rumour (6.2)', () => {
    for (const r of rumours) expect(BIBLE, r.id).toContain(r.text);
  });

  describeContent('rumor', 'AC-1: source and target resolve to existing ids', (entry) => {
    for (const source of entry.source) expect(glossaryIds.has(source), source).toBe(true);
    expect(glossaryIds.has(entry.target) || questIds.has(entry.target), entry.target).toBe(true);
    // The valley teller is a real NPC too.
    expect(glossaryIds.has(entry.secondHand?.teller ?? 'npc-dot')).toBe(true);
  });

  describeContent(
    'rumor',
    'AC-1: tellers match the harbour dialogue that emits the rumour',
    (entry) => {
      const number = Number(/^rumor-(\d{2})-/.exec(entry.id)?.[1]);
      const dialogues = gameContentSources().filter((s) => s.path.includes('/data/dialogue/'));
      const told = dialogues.filter((s) =>
        new RegExp(
          `"rumor": ${String(number)},\\s*"source": "(npc-[a-z]+)"(?!,\\s*"secondHand")`,
        ).test(s.text),
      );
      for (const s of told) {
        const teller = new RegExp(
          `"rumor": ${String(number)},\\s*"source": "(npc-[a-z]+)"(?!,\\s*"secondHand")`,
        ).exec(s.text)?.[1];
        expect(entry.source, s.path).toContain(teller);
      }
    },
  );

  it('AC-4: the sea serpent (18) is false and can be debunked by diving or asking Mags', () => {
    const serpent = rumours.find((r) => r.id === 'rumor-18-sea-serpent');
    expect(serpent?.truth).toBe('false');
    expect(serpent?.debunk).toEqual([
      { via: 'dive', place: 'place-breakwater' },
      { via: 'ask', npc: 'npc-mags' },
    ]);
    expect(rumours.filter((r) => r.truth !== 'true').map((r) => r.id)).toEqual([
      'rumor-18-sea-serpent',
    ]);
    // Mags's debunk line exists in her dialogue.
    expect(sourceOf('/dialogue/mags-patient-ann.json')).toContain("It's a figurehead, love");
  });

  it('AC-5: never having been to Wendmouth, Dot offers only second-hand lines that mark nothing visited', () => {
    const heard = rumourPool(rumours, 'npc-dot', false);
    expect(heard.map((h) => h.id).sort()).toEqual(rumours.map((r) => r.id).sort());
    for (const h of heard) {
      expect(h.secondHand, h.id).toBe(true);
      expect(h.marksVisited, h.id).toBeUndefined();
    }
    // A first-hand source offers the rumour itself and marks its target; Dot says nothing once the
    // player has been to the harbour.
    expect(rumourPool(rumours, 'npc-mags', false).every((h) => !h.secondHand)).toBe(true);
    expect(rumourPool(rumours, 'npc-dot', true)).toEqual([]);
    // A valley rumour is never in the harbour pool, even from its own first-hand source.
    const valley = rumorSchema.parse({ ...base, region: 'valley' });
    expect(rumourPool([valley], 'npc-nell', false)).toEqual([]);
    expect(rumourPool([valley], 'npc-dot', false)).toEqual([]);
  });
});

describe('harbour texts and evidence tags', () => {
  const note = (id: string) => content.get('note', id);

  it('AC-2: the manifests and invoice carry the canon quantities and names (11.3)', ({ task }) => {
    for (const id of [
      'note-cargo-manifest-quell-copy',
      'note-foundry-invoice',
      'note-cargo-manifest',
    ]) {
      markExercised(task, 'note', id);
    }
    const honest = note('note-cargo-manifest-quell-copy').pages[0]?.text ?? '';
    expect(honest).toMatch(/Horn-coin, 40 pcs/);
    expect(honest).toMatch(/Carved stone \(ox-headed\), 3/);
    expect(honest).toMatch(/Name-stone, 1/);
    expect(note('note-foundry-invoice').pages[0]?.text).toMatch(/^40 brass trinkets/);
    const customs = note('note-cargo-manifest');
    expect(customs.author).toContain('E. Ardley');
    expect(customs.pages[0]?.text).toContain('Vane Deepworks');
    expect(customs.title).toContain('Gilded Tern');
  });

  it('AC-3: the honest manifest carries the evidence tag both Framed in Brass and The Crate for Mr. S read', ({
    task,
  }) => {
    markExercised(task, 'note', 'note-cargo-manifest-quell-copy');
    expect(note('note-cargo-manifest-quell-copy').evidence).toEqual(['evidence.honest-manifest']);
    const facts = new Set(content.all('fact').flatMap((g) => g.facts.map((f) => f.key)));
    expect(facts.has('evidence.honest-manifest')).toBe(true);
    // The Crate for Mr. S— reads and writes it; Cray accepts it as evidence for the Framed in Brass route.
    expect(sourceOf('/quest/quest-crate-for-mr-s.json')).toContain('"evidence.honest-manifest"');
    expect(sourceOf('/dialogue/cray-customs.json')).toContain('"evidence.honest-manifest"');
    expect(sourceOf('/dialogue/quell-harbor-agent.json')).toContain('"evidence.honest-manifest"');
  });

  it('AC-3: invoice and seal carry the evidence tags Cray reads', ({ task }) => {
    markExercised(task, 'note', 'note-foundry-invoice');
    markExercised(task, 'note', 'note-cargo-manifest');
    expect(note('note-foundry-invoice').evidence).toEqual(['evidence.foundry-invoice']);
    expect(note('note-cargo-manifest').evidence).toEqual(['evidence.dead-clerk-seal']);
    const cray = sourceOf('/dialogue/cray-customs.json');
    expect(cray).toContain('"evidence.foundry-invoice"');
    expect(cray).toContain('"evidence.dead-clerk-seal"');
  });

  it('every evidence tag is a registered fact', () => {
    const facts = new Set(content.all('fact').flatMap((g) => g.facts.map((f) => f.key)));
    for (const entry of content.all('note')) {
      for (const tag of entry.evidence ?? [])
        expect(facts.has(tag), `${entry.id} ${tag}`).toBe(true);
    }
  });

  it('the evidence field only takes evidence.* facts', () => {
    const text = { text: 'x' };
    const n = {
      id: 'note-x',
      title: 'x',
      notes: 'x',
      locations: ['place-bay-nine'],
      pages: [text],
    };
    expect(noteSchema.safeParse({ ...n, evidence: ['evidence.honest-manifest'] }).success).toBe(
      true,
    );
    expect(noteSchema.safeParse({ ...n, evidence: ['crate.intercepted'] }).success).toBe(false);
    expect(noteSchema.safeParse({ ...n, evidence: [] }).success).toBe(false);
  });

  it('the sealed letter of Mr. S— has one readable line and keeps the buyer unnamed', ({
    task,
  }) => {
    markExercised(task, 'note', 'note-sealed-letter-line');
    const letter = note('note-sealed-letter-line');
    expect(letter.damaged).toBe(true);
    expect(letter.locations).toEqual(['place-bay-nine']);
    const text = letter.pages[0]?.text ?? '';
    expect(
      text
        .replace(/\[illegible\]|\[missing\]/g, '')
        .trim()
        .split(/(?<=\.)\s+/),
    ).toHaveLength(2);
    expect(text).not.toMatch(/Mr\. S[a-z]/);
  });

  it('the Lantern Court notice and Kestrel Lock toll board are written and placed in the harbour', ({
    task,
  }) => {
    markExercised(task, 'note', 'note-lantern-court-notice');
    markExercised(task, 'inscription', 'inscription-kestrel-lock-toll-board');
    expect(note('note-lantern-court-notice').locations).toContain('place-customs-house');
    expect(content.get('inscription', 'inscription-kestrel-lock-toll-board').locations).toEqual([
      'place-kestrel-lock',
    ]);
  });
});
