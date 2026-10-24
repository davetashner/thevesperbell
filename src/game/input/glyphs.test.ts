import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, DEFAULT_PAD_BINDINGS, rebind, unbind } from './bindings';
import { PAD_BUTTONS } from './gamepad';
import { codeLabel, inputGlyph, UNBOUND_GLYPH, XBOX_GLYPHS } from './glyphs';

const defaults = { keyboardMouse: DEFAULT_BINDINGS, gamepad: DEFAULT_PAD_BINDINGS };

describe('input glyphs (mw-e02.9)', () => {
  it('AC-5: the gamepad shows Xbox glyphs, the keyboard its key names', () => {
    expect(inputGlyph('interact', 'gamepad', defaults)).toBe('X');
    expect(inputGlyph('interact', 'keyboardMouse', defaults)).toBe('E');
    expect(inputGlyph('jump', 'gamepad', defaults)).toBe('A');
    expect(inputGlyph('jump', 'keyboardMouse', defaults)).toBe('Space');
    expect(inputGlyph('primaryAttack', 'gamepad', defaults)).toBe('RB');
    expect(inputGlyph('primaryAttack', 'keyboardMouse', defaults)).toBe('Left click');
    expect(inputGlyph('sprint', 'keyboardMouse', defaults)).toBe('Shift');
    expect(inputGlyph('pause', 'gamepad', defaults)).toBe('Menu');
    expect(inputGlyph('move', 'gamepad', defaults)).toBe('Left stick');
    expect(inputGlyph('move', 'keyboardMouse', defaults)).toBe('WASD');
    expect(inputGlyph('look', 'gamepad', defaults)).toBe('Right stick');
    expect(inputGlyph('look', 'keyboardMouse', defaults)).toBe('Mouse');
  });

  it('AC-5: glyphs follow remapped bindings, and say when an action is unbound', () => {
    const remapped = rebind(unbind(DEFAULT_PAD_BINDINGS, 'spellWheel'), 'cycleTarget', 'PadGuide');
    if (!remapped.ok) throw new Error('conflict');
    const bindings = { ...defaults, gamepad: remapped.bindings };
    expect(inputGlyph('cycleTarget', 'gamepad', bindings)).toBe('Xbox');
    expect(inputGlyph('cycleTarget', 'gamepad', defaults)).toBe(UNBOUND_GLYPH);
    const arrows = {
      ...defaults,
      keyboardMouse: unbind(
        unbind(unbind(unbind(DEFAULT_BINDINGS, 'moveForward'), 'moveBack'), 'moveLeft'),
        'moveRight',
      ),
    };
    expect(inputGlyph('move', 'keyboardMouse', arrows)).toBe('Up/Left/Down/Right');
  });

  it('labels every pad button and common keys', () => {
    for (const code of PAD_BUTTONS) expect(codeLabel(code)).toBe(XBOX_GLYPHS[code]);
    expect(codeLabel('PadUp')).toBe('D-pad Up');
    expect(codeLabel('Digit3')).toBe('3');
    expect(codeLabel('Escape')).toBe('Esc');
    expect(codeLabel('ControlRight')).toBe('Ctrl');
    expect(codeLabel('AltLeft')).toBe('Alt');
    expect(codeLabel('Mouse4')).toBe('Mouse 5');
    expect(codeLabel('F5')).toBe('F5');
  });
});
