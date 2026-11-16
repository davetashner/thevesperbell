import { describe, expect, it } from 'vitest';
import { hiddenByDressing, paintFor } from './dressing-hides';

const hull = {
  hides: { min: { x: 30, y: -6, z: 106 }, max: { x: 40, y: 14, z: 138 } },
};
const part = (purpose: 'blocking' | 'walkable' | 'climbable', cz: number) => ({
  purpose,
  min: { x: 34, y: 0, z: cz - 1 },
  max: { x: 36, y: 2, z: cz + 1 },
});

describe('dressing hides (render only)', () => {
  it('hides blocking and walkable parts whose centre lies in the box', () => {
    expect(hiddenByDressing(part('blocking', 120), [hull])).toBe(true);
    expect(hiddenByDressing(part('walkable', 120), [hull])).toBe(true);
  });

  it('keeps parts centred outside the box, even when they reach into it', () => {
    expect(hiddenByDressing(part('blocking', 142), [hull])).toBe(false);
    expect(hiddenByDressing(part('blocking', 138.5), [hull])).toBe(false);
  });

  it('never hides an affordance, and a dressing without a box hides nothing', () => {
    expect(hiddenByDressing(part('climbable', 120), [hull])).toBe(false);
    expect(hiddenByDressing(part('blocking', 120), [{ hides: undefined }])).toBe(false);
    expect(hiddenByDressing(part('blocking', 120), [])).toBe(false);
  });

  it('a paint box textures blocking parts centred inside it, and nothing else', () => {
    const cabin = {
      min: { x: 30, y: 1, z: 137 },
      max: { x: 40, y: 6, z: 147 },
      texture: 'tex-bulkhead-pine-01',
    };
    expect(paintFor(part('blocking', 142), [cabin])).toBe('tex-bulkhead-pine-01');
    expect(paintFor(part('blocking', 120), [cabin])).toBeUndefined();
    expect(paintFor(part('walkable', 142), [cabin])).toBeUndefined();
    expect(paintFor(part('blocking', 142), [])).toBeUndefined();
  });
});
