// mw-e39.16: the narration type and the opening, first-night, barge and ending text. The ending logic
// (every combination of the seven ending facts) is in tests/integration/epilogue-text.test.ts.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '../game-content.ts';
import { describeContent } from '../testing.ts';
import {
  endingCard,
  epilogueSlide,
  findSequence,
  HEADLINE_ENDINGS,
  HORNED_SHADOW_BEAT,
  narrationSchema,
  PAGE_MAX_WORDS,
  SLIDE_MAX_WORDS,
  wordCount,
  type Narration,
} from './narration.ts';

const content = loadGameContent();
const all = content.all('narration') as readonly Narration[];

const slide = (id: string, extra: object = {}) => ({
  id,
  endings: ['vespers-rung'],
  facts: [],
  pages: [{ text: 'A slide.' }],
  ...extra,
});
const base = (kind: string, sequences: object[], id = 'narration-test') => ({
  id,
  kind,
  notes: 'Test.',
  sequences,
});
const problems = (value: unknown) =>
  (narrationSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('narration schema', () => {
  it('accepts an epilogue slide and a first-night sequence', () => {
    expect(problems(base('epilogue', [slide('a-slide')]))).toEqual([]);
    expect(
      problems(
        base('first-night', [
          { id: 'v', pages: [{ text: 'Go.' }, { text: 'Look.', beat: HORNED_SHADOW_BEAT }] },
        ]),
      ),
    ).toEqual([]);
  });

  it('AC-3: a slide is at most 60 words, any other page at most 90', () => {
    const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
    expect(
      problems(base('epilogue', [slide('s', { pages: [{ text: words(SLIDE_MAX_WORDS) }] })])),
    ).toEqual([]);
    expect(
      problems(base('epilogue', [slide('s', { pages: [{ text: words(SLIDE_MAX_WORDS + 1) }] })])),
    ).toEqual(['sequences.0.pages.0.text: at most 60 words']);
    expect(
      problems(base('barge', [{ id: 'b', pages: [{ text: words(PAGE_MAX_WORDS) }] }])),
    ).toEqual([]);
    expect(
      problems(base('barge', [{ id: 'b', pages: [{ text: words(PAGE_MAX_WORDS + 1) }] }])),
    ).toEqual(['sequences.0.pages.0.text: at most 90 words']);
    expect(wordCount('  two   words ')).toBe(2);
  });

  it('AC-2: a first-night sequence must end on the horned-shadow beat', () => {
    expect(
      problems(
        base('first-night', [{ id: 'v', pages: [{ text: 'Go.', beat: 'x' }, { text: 'Look.' }] }]),
      ),
    ).toEqual(['sequences.0.pages: a first-night sequence ends on the horned-shadow beat']);
  });

  it('a slide names its endings and facts and is one page; the id is narration-<slug> and sequences are unique', () => {
    expect(problems(base('ending', [slide('x', { endings: undefined })]))).toEqual([
      'sequences.0.endings: an ending card or slide names the endings it appears in',
    ]);
    expect(
      problems(base('epilogue', [slide('x', { pages: [{ text: 'A.' }, { text: 'B.' }] })])),
    ).toEqual(['sequences.0.pages: an ending card or slide is one page']);
    expect(problems(base('epilogue', [slide('x', { facts: undefined })]))).toEqual([
      'sequences.0.facts: a slide names the facts that choose it',
    ]);
    expect(problems(base('epilogue', [slide('x')], 'epilogue-test'))).toEqual([
      'id: a narration id is `narration-<slug>`',
    ]);
    expect(problems(base('epilogue', [slide('x'), slide('x')]))).toEqual([
      'sequences.1.id: duplicate sequence id "x"',
    ]);
    expect(problems(base('epilogue', [slide('x', { facts: ['Bad Key'] })]))).toHaveLength(1);
  });
});

describe('narration lookups', () => {
  it('finds a sequence by kind and id, an epilogue slide by objective id and an ending card by ending', () => {
    expect(findSequence(all, 'barge', 'downriver-to-wendmouth')?.pages.length).toBeGreaterThan(0);
    expect(findSequence(all, 'barge', 'no-such-sequence')).toBeUndefined();
    expect(findSequence(all, 'title', 'vr-bread-at-the-gate')).toBeUndefined();
    expect(epilogueSlide(all, 'vr-bread-at-the-gate')).toMatch(/bread at the mine gate/);
    expect(epilogueSlide(all, 'no-such-slide')).toBeUndefined();
    expect(endingCard(all, 'long-vespers')?.title).toBe('The Long Vespers');
    expect(endingCard([], 'long-vespers')).toBeUndefined();
  });
});

describe('opening, first night, barge and ending text', () => {
  it('the title card, arrival, first night, barge, ending and epilogue files all exist', () => {
    expect(all.map((n) => n.kind).sort()).toEqual([
      'arrival',
      'barge',
      'ending',
      'epilogue',
      'first-night',
      'title',
    ]);
  });

  it('AC-2: the first night has the followed, lost-her and blocked-by-wolves variants, each ending on the horned shadow', () => {
    const night = all.find((n) => n.kind === 'first-night');
    expect(night?.sequences.map((s) => s.id)).toEqual([
      'followed',
      'lost-her',
      'blocked-by-wolves',
    ]);
    for (const sequence of night?.sequences ?? []) {
      const last = sequence.pages[sequence.pages.length - 1];
      expect(last?.beat, sequence.id).toBe(HORNED_SHADOW_BEAT);
      expect(last?.text, sequence.id).toMatch(/horn/i);
    }
  });

  it('the arrival names the bounty (500 crowns, then 800) and the first night starts at the Sleeping Ox', () => {
    const arrival = all.find((n) => n.kind === 'arrival');
    const text = (id: string) =>
      arrival?.sequences
        .find((s) => s.id === id)
        ?.pages.map((p) => p.text)
        .join(' ') ?? '';
    expect(text('bounty-board')).toMatch(/Five hundred crowns/);
    expect(text('bounty-board')).toMatch(/Vane/);
    expect(text('bounty-board-raised')).toMatch(/Eight hundred crowns/);
    expect(text('the-last-room')).toMatch(/Sleeping Ox/);
    expect(text('the-last-room')).toMatch(/Tansy/);
  });

  it('the barge ride is a day down and two days up, towed (bible 11.3)', () => {
    const barge = all.find((n) => n.kind === 'barge');
    const text = (id: string) =>
      barge?.sequences
        .find((s) => s.id === id)
        ?.pages.map((p) => p.text)
        .join(' ') ?? '';
    expect(text('downriver-to-wendmouth')).toMatch(/By evening/);
    expect(text('upriver-to-briar-glen')).toMatch(/twice as long/);
    expect(text('upriver-to-briar-glen')).toMatch(/Two days/);
  });

  it('AC-3: the title card tells the player where they are and what is happening', () => {
    const title = all.find((n) => n.kind === 'title')?.sequences[0];
    expect(title?.title).toBe('The Vesper Bell');
    expect(title?.pages.map((p) => p.text).join(' ')).toMatch(/Sixty-one years ago/);
  });

  it('there is one ending card for each of the four headline endings', () => {
    const cards = all.find((n) => n.kind === 'ending')?.sequences.map((s) => s.id);
    expect(cards).toEqual([...HEADLINE_ENDINGS]);
  });

  it('The Long Vespers ends on a doorway, not a grave (bible 4.4)', () => {
    const text = epilogueSlide(all, 'lv-wake-in-the-cradle') ?? '';
    expect(text).toMatch(/Oi\. You're the only one up\. Everyone's snoring\. Fix it\./);
    expect(text).toMatch(/door stands open/);
    expect(text).not.toMatch(/grave|dead|die/i);
  });

  describeContent('narration', 'AC-3: every page is within its word limit', (entry) => {
    const limit =
      entry.kind === 'ending' || entry.kind === 'epilogue' ? SLIDE_MAX_WORDS : PAGE_MAX_WORDS;
    for (const sequence of entry.sequences) {
      for (const page of sequence.pages) {
        expect(wordCount(page.text), sequence.id).toBeLessThanOrEqual(limit);
      }
    }
  });
});
