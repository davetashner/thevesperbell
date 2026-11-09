import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/game-content';
import { tintColour, tintedEffectId, tintEffect } from './tint.ts';

describe('spell VFX tint (mw-e29.10)', () => {
  it('a light grey becomes the tint, white stays white-hot, black stays black', () => {
    expect(tintColour('#BFBFBF', '#FF7A1A')).toBe('#FF7A1A');
    expect(tintColour('#FFFFFF', '#FF7A1A')).toBe('#FFFFFF');
    expect(tintColour('#000000', '#FF7A1A')).toBe('#000000');
  });

  it('keeps brightness ordering: a darker grey is a darker tint, a near-white lifts towards white', () => {
    const dark = tintColour('#606060', '#8B5CF6');
    const light = tintColour('#E0E0E0', '#8B5CF6');
    const channel = (hex: string, i: number) =>
      Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
    expect(channel(dark, 2)).toBeLessThan(channel('#8B5CF6', 2));
    expect(channel(light, 0)).toBeGreaterThan(channel('#8B5CF6', 0));
  });

  it('derives a stable id and recolours every emitter, constant and keyed curves alike', () => {
    expect(tintedEffectId('vfx-x', '#FF7A1A')).toBe('vfx-x~ff7a1a');
    const effects = loadGameContent().all('vfx-effect');
    const source = effects.find((e) => e.id === 'vfx-spell-release-burst');
    if (source === undefined) throw new Error('missing effect');
    const tinted = tintEffect(source, '#FF7A1A');
    expect(tinted.id).toBe('vfx-spell-release-burst~ff7a1a');
    expect(tinted.emitters).toHaveLength(source.emitters.length);
    const colours = JSON.stringify(tinted.emitters);
    expect(colours).not.toContain('#9A9A9A'); // the neutral greys are gone
    expect(colours).toContain('#FFFFFF'); // the white-hot start stays
    expect(colours).toContain('#E06B17'); // the faded end is the tint, darkened
    const constant = {
      ...source,
      emitters: source.emitters.map((e) => ({ ...e, color: '#BFBFBF' })),
    };
    expect(tintEffect(constant, '#102030').emitters.map((e) => e.color)).toEqual(
      source.emitters.map(() => '#102030'),
    );
  });
});
