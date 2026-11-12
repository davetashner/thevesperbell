// mw-e39.28: every character in the canon glossary resolves to an `npc-*` creature, because dialogue
// speakers resolve through creature content (docs/narrative/content-conventions.md, ids).

import { describe, expect, it } from 'vitest';
import { loadGameContent } from '../game-content.ts';
import { glossary } from './glossary.ts';

const content = loadGameContent();

describe('npc roster (mw-e39.28)', () => {
  it('AC-1: every glossary character resolves to a creature with the same id', () => {
    const missing = glossary.characters
      .map((c) => c.id)
      .filter((id) => !content.has('creature', id));
    expect(missing).toEqual([]);
  });

  it('AC-2: every npc-* creature is an npc that makes no attacks', () => {
    const npcs = content.all('creature').filter((c) => c.id.startsWith('npc-'));
    expect(npcs.length).toBeGreaterThanOrEqual(glossary.characters.length);
    for (const c of npcs) {
      expect(c.tags, c.id).toContain('npc');
      expect(c.attacks, c.id).toEqual([]);
    }
  });
});
