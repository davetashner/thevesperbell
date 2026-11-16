import { describe, expect, it } from 'vitest';
import { npcLabel, npcPortrait, speakerNameResolver, speakerPortraitResolver } from './portraits';

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

describe('mw-2ute: speaker display names', () => {
  const dialogue = {
    speakers: [
      { id: 'mags', npc: { id: 'npc-mags' } },
      { id: 'miner', npc: { id: 'npc-townsfolk-miner' } },
      { id: 'voice', name: 'A Hollow Voice' },
      { id: 'bare', npc: { id: 'ottilie' }, name: 'Ottilie Marsh' },
    ],
  };
  const resolve = speakerNameResolver((id) => (id === 'd' ? dialogue : undefined));

  it('AC-1: an NPC speaker is labelled with the creature name, not the local id', () => {
    expect(resolve('d', 'mags')).toBe('Mags');
    expect(resolve('d', 'miner')).toBe('Townsfolk miner');
  });

  it('AC-2: a speaker with its own name keeps it', () => {
    expect(resolve('d', 'voice')).toBe('A Hollow Voice');
    expect(resolve('d', 'bare')).toBe('Ottilie Marsh');
  });

  it('AC-3: narrator, player, unknown speakers and unknown dialogues keep their id', () => {
    expect(resolve('d', 'narrator')).toBe('narrator');
    expect(resolve('d', 'player')).toBe('player');
    expect(resolve('d', 'ghost')).toBe('ghost');
    expect(resolve('missing', 'mags')).toBe('mags');
  });

  it('AC-4: npcLabel drops the npc prefix and capitalises', () => {
    expect(npcLabel('npc-mags')).toBe('Mags');
    expect(npcLabel('ottilie')).toBe('Ottilie');
  });
});
