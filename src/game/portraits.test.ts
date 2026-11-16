import { describe, expect, it } from 'vitest';
import { npcPortrait, speakerPortraitResolver } from './portraits';

const creatures = [
  { id: 'npc-mags', presentation: { portrait: 'portrait-npc-mags-bargewoman' } },
  { id: 'npc-plain', presentation: {} },
];

describe('mw-e37.433: portraits of characters', () => {
  it('npcPortrait finds a creature portrait, and nothing for no art, a stranger or no npc', () => {
    expect(npcPortrait(creatures, 'npc-mags')).toBe('portrait-npc-mags-bargewoman');
    expect(npcPortrait(creatures, 'npc-plain')).toBeUndefined();
    expect(npcPortrait(creatures, 'npc-nobody')).toBeUndefined();
    expect(npcPortrait(creatures, undefined)).toBeUndefined();
  });

  it('a speaker resolves through its dialogue to the NPC creature portrait', () => {
    const resolve = speakerPortraitResolver(
      (id) =>
        id === 'chat'
          ? { speakers: [{ id: 'mags', npc: { id: 'npc-mags' } }, { id: 'narrator' }] }
          : undefined,
      creatures,
    );
    expect(resolve('chat', 'mags')).toBe('portrait-npc-mags-bargewoman');
    expect(resolve('chat', 'narrator')).toBeUndefined();
    expect(resolve('chat', 'ghost')).toBeUndefined();
    expect(resolve('other', 'mags')).toBeUndefined();
  });
});
