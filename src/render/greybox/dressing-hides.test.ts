import { describe, expect, it } from 'vitest';
import { hiddenByDressing, paintFor, revealedFrom } from './dressing-hides';

const box = {
  min: { x: 30, y: -6, z: 106 },
  max: { x: 40, y: 14, z: 138 },
  climbables: false,
  inside: false,
};
const hull = { hides: box };
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

  it('never hides an affordance the dressing does not redraw, and a dressing without a box hides nothing', () => {
    expect(hiddenByDressing(part('climbable', 120), [hull])).toBe(false);
    expect(hiddenByDressing(part('blocking', 120), [{ hides: undefined }])).toBe(false);
    expect(hiddenByDressing(part('blocking', 120), [])).toBe(false);
  });

  it('hides a climbable only when the box says the dressing draws its own ladder', () => {
    const ladders = { hides: { ...box, climbables: true } };
    expect(hiddenByDressing(part('climbable', 120), [ladders])).toBe(true);
    expect(hiddenByDressing(part('climbable', 142), [ladders])).toBe(false);
  });

  it('never hides an interactive or a hazard', () => {
    const everything = { hides: { ...box, climbables: true } };
    for (const purpose of ['interactive', 'hazard'] as const) {
      expect(hiddenByDressing({ ...part('blocking', 120), purpose }, [everything])).toBe(false);
    }
  });

  it('draws the hidden parts again only for a camera inside an `inside` box', () => {
    const hold = { hides: { ...box, inside: true } };
    const at = (x: number, y: number, z: number) => ({ x, y, z });
    expect(revealedFrom(at(35, 0, 120), hold)).toBe(true);
    expect(revealedFrom(at(35, 0, 120), hull)).toBe(false);
    expect(revealedFrom(at(35, 0, 120), { hides: undefined })).toBe(false);
    for (const out of [at(29, 0, 120), at(41, 0, 120), at(35, -7, 120), at(35, 15, 120)]) {
      expect(revealedFrom(out, hold)).toBe(false);
    }
    expect(revealedFrom(at(35, 0, 105), hold)).toBe(false);
    expect(revealedFrom(at(35, 0, 139), hold)).toBe(false);
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
