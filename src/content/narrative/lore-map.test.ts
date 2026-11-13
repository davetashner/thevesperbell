// mw-e39.13 AC-4: the Long Vespers, Horn's role and the bell each have at least three independent
// sources (a book, an object, a person) in the lore map, and every listed source really speaks of it.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '../game-content.ts';
import raw from './lore-map.json';

const content = loadGameContent();

interface Source {
  readonly kind: 'book' | 'object' | 'person';
  readonly id: string;
}

/** What a source says, as one string. */
function textOf(source: Source): string {
  if (source.kind === 'book') {
    return content
      .get('book', source.id)
      .pages.map((page) => page.text)
      .join('\n');
  }
  if (source.kind === 'object') {
    const type = source.id.startsWith('note-') ? 'note' : 'inscription';
    return content
      .get(type, source.id)
      .pages.map((page) => page.text)
      .join('\n');
  }
  return JSON.stringify(content.get('dialogue', source.id));
}

const topics = Object.entries(raw.topics) as [
  string,
  { label: string; pattern: string; sources: Source[] },
][];

describe('lore map (mw-e39.13)', () => {
  it('AC-4: covers the Long Vespers, Horn and the bell', () => {
    expect(topics.map(([id]) => id)).toEqual(['long-vespers', 'horn', 'bell']);
  });

  for (const [id, topic] of topics) {
    describe(id, () => {
      it('AC-4: has at least three distinct sources, one book, one object and one person', () => {
        expect(topic.sources.length).toBeGreaterThanOrEqual(3);
        expect(new Set(topic.sources.map((s) => s.id)).size).toBe(topic.sources.length);
        for (const kind of ['book', 'object', 'person']) {
          expect(topic.sources.some((s) => s.kind === kind)).toBe(true);
        }
      });

      for (const source of topic.sources) {
        it(`AC-4: ${source.kind} ${source.id} mentions it`, () => {
          expect(textOf(source)).toMatch(new RegExp(topic.pattern, 'i'));
        });
      }
    });
  }
});
