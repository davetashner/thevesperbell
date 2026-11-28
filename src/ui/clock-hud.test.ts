// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ClockHud } from './clock-hud';

describe('the clock HUD (mw-e27.13)', () => {
  it('shows the text and phase it is given and writes only when they change', () => {
    const hud = new ClockHud();
    expect(hud.element.dataset['testid']).toBe('clock-hud');
    hud.update({ text: 'Day 1 · 06:00', phase: 'dawn' });
    expect(hud.element.textContent).toBe('Day 1 · 06:00');
    expect(hud.element.dataset['phase']).toBe('dawn');
    // An unchanged model touches nothing; a changed one writes.
    hud.element.textContent = 'tampered';
    hud.update({ text: 'Day 1 · 06:00', phase: 'dawn' });
    expect(hud.element.textContent).toBe('tampered');
    hud.update({ text: 'Day 2 · 06:00', phase: 'night' });
    expect(hud.element.textContent).toBe('Day 2 · 06:00');
    expect(hud.element.dataset['phase']).toBe('night');
  });
});
