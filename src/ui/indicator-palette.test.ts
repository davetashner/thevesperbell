// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  ADJACENT_INDICATORS,
  awarenessColour,
  INDICATOR_PALETTE_IDS,
  INDICATOR_PALETTES,
  isIndicatorPaletteId,
  parseHex,
  seenContrast,
  seenLuminance,
  setIndicatorPalette,
  type Deficiency,
} from '@ui/indicator-palette';
import { uiStyleSheet } from '@ui/tokens';

const DEFICIENCIES: readonly Deficiency[] = ['deuteranopia', 'protanopia', 'tritanopia'];
const AWARENESS_BACKDROP = 0x3a322a;

describe('indicator palette presets (mw-e31.8)', () => {
  it('AC-2: under its own simulated deficiency, adjacent bar colours differ by at least 3:1', () => {
    for (const id of DEFICIENCIES) {
      const tokens = INDICATOR_PALETTES[id].tokens;
      for (const [a, b] of ADJACENT_INDICATORS) {
        const ratio = seenContrast(parseHex(tokens[a] ?? ''), parseHex(tokens[b] ?? ''), id);
        expect(ratio, `${id}: ${a} | ${b}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('AC-2: every preset also holds up under the other two deficiencies', () => {
    for (const id of DEFICIENCIES) {
      for (const seen of DEFICIENCIES) {
        for (const [a, b] of ADJACENT_INDICATORS) {
          const tokens = INDICATOR_PALETTES[id].tokens;
          expect(
            seenContrast(parseHex(tokens[a] ?? ''), parseHex(tokens[b] ?? ''), seen),
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('AC-2: alert marker colours stand out from their backdrop by 3:1 under each deficiency', () => {
    for (const id of DEFICIENCIES) {
      for (const [state, colour] of Object.entries(INDICATOR_PALETTES[id].awareness)) {
        for (const seen of DEFICIENCIES) {
          expect(
            seenContrast(colour, AWARENESS_BACKDROP, seen),
            `${id} ${state} as ${seen}`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('the default preset overrides nothing and awarenessColour falls back for it', () => {
    expect(INDICATOR_PALETTES.default.tokens).toEqual({});
    expect(awarenessColour('default', 'combat')).toBeUndefined();
    expect(awarenessColour('protanopia', 'combat')).toBe(0xff6a45);
    expect(awarenessColour('protanopia', 'unaware')).toBeUndefined();
  });

  it('recognises preset ids', () => {
    for (const id of INDICATOR_PALETTE_IDS) expect(isIndicatorPaletteId(id)).toBe(true);
    expect(isIndicatorPaletteId('sepia')).toBe(false);
  });

  it('sets, switches and clears a preset on the root', () => {
    const root = document.createElement('div');
    setIndicatorPalette(root, 'deuteranopia');
    expect(root.dataset['palette']).toBe('deuteranopia');
    expect(root.style.getPropertyValue('--ui-color-health')).toBe('#ca5431');
    setIndicatorPalette(root, 'tritanopia');
    expect(root.style.getPropertyValue('--ui-color-mana')).toBe('#1d747a');
    setIndicatorPalette(root, 'default');
    expect(root.dataset['palette']).toBeUndefined();
    expect(root.style.getPropertyValue('--ui-color-health')).toBe('');
  });

  it('simulation leaves greys alone and changes saturated colours', () => {
    expect(seenLuminance(0xffffff)).toBeCloseTo(1);
    expect(seenLuminance(0x808080, 'deuteranopia')).toBeCloseTo(seenLuminance(0x808080), 2);
    expect(seenLuminance(0xff0000, 'protanopia')).toBeLessThan(seenLuminance(0xff0000) * 0.6);
  });
});

describe('colour is not the only cue (mw-e31.8)', () => {
  const css = uiStyleSheet();
  it('AC-1: each bar kind but health has its own pattern, and no two share one', () => {
    const patterns = ['stamina', 'mana', 'breath', 'poise'].map((kind) => {
      const match = new RegExp(`\\.vb-meter\\[data-kind='${kind}'\\]::after \\{([^}]*)\\}`).exec(
        css,
      );
      expect(match, kind).not.toBeNull();
      return match?.[1]?.trim();
    });
    expect(new Set(patterns).size).toBe(4);
  });

  it('damage taken carries a minus sign and an unaffordable spell cost is struck through', () => {
    expect(css).toContain(".vb-damage-number[data-kind='taken']::before { content: '\\2212'; }");
    expect(css).toMatch(/unaffordable'\] \.vb-spell-slot-cost \{[^}]*line-through/);
  });
});
