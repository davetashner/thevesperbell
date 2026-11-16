import { describe, expect, it } from 'vitest';
import { buildDeckGrating } from './deck-grating';

describe('deck grating (render only)', () => {
  it('stands on y = 0, centred, 1.3 m by 1.0 m and 0.3 m high, with painted vertices', () => {
    const { geometry } = buildDeckGrating();
    const box = geometry.boundingBox;
    expect(box?.min.y).toBeCloseTo(0, 5);
    expect(box?.max.y).toBeCloseTo(0.3, 5);
    expect((box?.max.x ?? 0) - (box?.min.x ?? 0)).toBeCloseTo(1.3, 5);
    expect((box?.max.z ?? 0) - (box?.min.z ?? 0)).toBeCloseTo(1.0, 5);
    expect((box?.max.x ?? 0) + (box?.min.x ?? 0)).toBeCloseTo(0, 5);
    expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count);
  });
});
