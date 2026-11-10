// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  installUiStyles,
  luminance,
  PALETTE,
  UI_STYLE_ID,
  UI_TOKENS,
  uiStyleSheet,
} from '@ui/tokens';

describe('UI tokens (style bible §9)', () => {
  it('body text on panels meets WCAG AAA (≥ 7:1)', () => {
    const text = UI_TOKENS['ui-color-text'] ?? '';
    expect(contrastRatio(text, UI_TOKENS['ui-color-panel'] ?? '')).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(text, UI_TOKENS['ui-color-panel-raised'] ?? '')).toBeGreaterThanOrEqual(7);
    // Hovered / focused buttons: ink on hearth.
    expect(contrastRatio(text, UI_TOKENS['ui-color-accent'] ?? '')).toBeGreaterThanOrEqual(7);
  });

  it('the focus ring contrasts ≥ 3:1 with the panels it is drawn on (AC-3)', () => {
    const ring = UI_TOKENS['ui-color-focus'] ?? '';
    expect(contrastRatio(ring, PALETTE.parchment)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(ring, PALETTE.cream)).toBeGreaterThanOrEqual(3);
  });

  it('every token is declared on .vb-ui and font sizes follow --ui-text-scale', () => {
    const css = uiStyleSheet();
    for (const name of Object.keys(UI_TOKENS)) expect(css).toContain(`--${name}:`);
    expect(css).toContain('calc(1 * var(--ui-font-size) * var(--ui-text-scale))');
    expect(css).toContain("[data-motion='reduce'] { --ui-motion-scale: 0; }");
  });

  it('AC-4: body text is 16px, rising to 18px at 1080p, and no font size is rem-fixed', () => {
    expect(UI_TOKENS['ui-font-size']).toBe('max(16px, 1.6667vh)');
    expect(1080 * 0.016667).toBeGreaterThanOrEqual(18);
    expect(uiStyleSheet()).not.toMatch(/font-size: [\d.]+rem/);
  });

  it('the dyslexia font and the text backdrop are token driven, and tabs wrap', () => {
    const css = uiStyleSheet();
    expect(css).toContain(".vb-ui[data-font='dyslexia']");
    expect(css).toContain('--ui-text-backdrop-opacity');
    expect(css).toContain("[role='tablist'] { display: flex; flex-wrap: wrap;");
    expect(css).toContain('.vb-tabpanel[hidden] { display: none; }');
    // Narrow layouts (phone width, or large text): pickups keep a readable width, the shop stacks rows.
    expect(css).toContain('max-width: max(min(22em, 45%), min(14em,');
    expect(css).toContain('@container (max-width: 30em)');
    expect(css.indexOf('@container (max-width: 30em)')).toBeGreaterThan(
      css.indexOf('.vb-shop-item {'),
    );
  });

  it('installs the stylesheet once', () => {
    installUiStyles(document);
    installUiStyles(document);
    expect(document.querySelectorAll(`#${UI_STYLE_ID}`)).toHaveLength(1);
  });

  it('computes WCAG luminance and contrast', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#FFFFFF')).toBeCloseTo(1);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21);
    expect(() => luminance('red')).toThrow(RangeError);
  });
});
