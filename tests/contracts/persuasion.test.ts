// Contract between layers (mw-e22.7): the persuasion table is content (src/content/types/persuasion.ts)
// and the sim evaluates it (src/sim/dialogue/persuasion.ts). Content may import the sim only as types,
// so this check lives outside src/: both sides name the same bands, the shipped table passes the sim's
// logic validation against real content ids, and a thief really does lie better than a knight.

import { describe, expect, it } from 'vitest';
import { loadGameContent, PERSUASION_BANDS, PERSUASION_ID } from '@content/index';
import { NPC_BANDS, createPersuasion, validatePersuasionRules, MemoryLogicHost } from '@sim/index';

describe('persuasion contract (mw-e22.7)', () => {
  it('e22.7: content and the sim name the same NPC bands', () => {
    expect([...PERSUASION_BANDS]).toEqual([...NPC_BANDS]);
  });

  it('e22.7: the shipped table passes the sim logic validation with class references resolved', () => {
    const content = loadGameContent();
    const table = content.get('persuasion', PERSUASION_ID);
    const issues = validatePersuasionRules(table, (ref) =>
      ref.type === 'class' && content.all('class').every((c) => c.id !== ref.id)
        ? `unknown class "${ref.id}"`
        : undefined,
    );
    expect(issues).toEqual([]);
  });

  it('e22.7: the shipped table scores a thief above a knight for deceive, equal otherwise', () => {
    const table = loadGameContent().get('persuasion', PERSUASION_ID);
    const { preview } = createPersuasion({ rules: table });
    const request = (cls: string) => ({
      dialogue: 'd',
      npc: 'n',
      target: 'n',
      node: {
        id: 'c',
        kind: 'check',
        approach: 'deceive',
        difficulty: 8,
        modifiers: [],
        success: 'a',
        failure: 'b',
      } as never,
      context: new MemoryLogicHost({ playerClass: cls }),
    });
    expect(preview(request('thief')).score).toBeGreaterThan(preview(request('knight')).score);
    expect(preview(request('knight')).score).toBe(preview(request('archer')).score);
  });
});
