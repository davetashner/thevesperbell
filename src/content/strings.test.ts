import { describe, expect, it } from 'vitest';
import { formatString, hasString, UI_STRINGS } from './strings.ts';

describe('string table (mw-e28.14)', () => {
  it('fills placeholders, leaving unknown ones and unknown keys as written', () => {
    expect(formatString('caption.format', { sound: 'Footsteps', direction: 'behind left' })).toBe(
      '[Footsteps, behind left]',
    );
    expect(formatString('caption.format', { sound: 'X' })).toBe('[X, {direction}]');
    expect(formatString('caption.nope')).toBe('caption.nope');
    expect(hasString('caption.nope')).toBe(false);
    expect(hasString('toString')).toBe(false);
  });

  it('has a direction string for each of the 8 caption sectors', () => {
    const directions = Object.keys(UI_STRINGS).filter((k) => k.startsWith('caption.direction.'));
    expect(directions).toHaveLength(8);
  });
});
