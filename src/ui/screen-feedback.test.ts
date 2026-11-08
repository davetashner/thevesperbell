// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ScreenFeedback, VIGNETTE_MAX_OPACITY } from './screen-feedback';

describe('ScreenFeedback (mw-e29.5)', () => {
  it('starts hidden, inert and out of the accessibility tree', () => {
    const overlay = new ScreenFeedback();
    expect(overlay.element.hidden).toBe(true);
    expect(overlay.element.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.element.style.pointerEvents).toBe('none');
  });

  it('shows the vignette as opacity and the grade as a saturate filter', () => {
    const overlay = new ScreenFeedback();
    overlay.update({ vignette: 0.4, desaturation: 0.35 });
    expect(overlay.element.hidden).toBe(false);
    expect(overlay.element.dataset['vignette']).toBe('0.40');
    expect(overlay.element.style.opacity).toBe((0.4 * VIGNETTE_MAX_OPACITY).toFixed(2));
    expect(overlay.element.dataset['desaturation']).toBe('0.35');
    overlay.update({ vignette: 3, desaturation: -1 });
    expect(overlay.element.dataset['vignette']).toBe('1.00');
    expect(overlay.element.dataset['desaturation']).toBe('0.00');
    overlay.update({ vignette: 0, desaturation: 0 });
    expect(overlay.element.hidden).toBe(true);
  });

  it('writes nothing for an unchanged frame', () => {
    const overlay = new ScreenFeedback();
    overlay.update({ vignette: 0.2, desaturation: 0 });
    overlay.element.style.opacity = 'tampered';
    overlay.update({ vignette: 0.2, desaturation: 0 });
    expect(overlay.element.style.opacity).toBe('tampered');
  });
});
