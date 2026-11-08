import { describe, expect, it } from 'vitest';
import {
  autoSkin,
  bindRegion,
  fitSegments,
  restSegments,
  SKIN_INFLUENCES,
  type BoneSegment,
} from './auto-skin';
import { compileRig } from './library';
import { parseGraph, TEST_GRAPH } from './fixtures';

const LEG: BoneSegment = { head: [0, 1, 0], tail: [0, 0, 0] };
const ARM: BoneSegment = { head: [0, 1.5, 0], tail: [0.5, 1.5, 0] };

/** The weight a vertex gives `bone`, 0 when it is not among the kept influences. */
function weightOf(skin: ReturnType<typeof autoSkin>, vertex: number, bone: number): number {
  for (let i = 0; i < SKIN_INFLUENCES; i++) {
    if (skin.indices[vertex * SKIN_INFLUENCES + i] === bone) {
      return skin.weights[vertex * SKIN_INFLUENCES + i] ?? 0;
    }
  }
  return 0;
}

describe('restSegments', () => {
  it('runs each bone from its joint to the far end of its shape, in rest space', () => {
    const rig = compileRig(parseGraph(TEST_GRAPH));
    const segments = restSegments(rig);
    expect(segments).toHaveLength(rig.bones.length);
    // root is at [0, 1, 0]; legs hang 0.5 below it, arms rise 0.5 above it.
    expect(segments[0]?.head).toEqual([0, 1, 0]);
    expect(segments[1]?.head).toEqual([0, 0.5, 0]);
    expect(segments[2]?.head).toEqual([0, 1.5, 0]);
  });

  it('gives a long thin limb a wider radius than a torso bone, and a point none', () => {
    const rig = compileRig(parseGraph(TEST_GRAPH));
    const segments = restSegments(rig);
    for (const [i, def] of rig.defs.entries()) {
      const radius = segments[i]?.radius ?? -1;
      if (def.shape === undefined) {
        expect(radius).toBe(0);
        continue;
      }
      const side = Math.max(def.shape.size[0], def.shape.size[2]);
      const limb = def.shape.size[1] >= 3 * side;
      expect(radius).toBeCloseTo((side / 2) * (limb ? 1.8 : 1), 10);
    }
  });

  it('keeps a bone on the midline unrestricted and fences a side bone off the midline', () => {
    const rig = compileRig({
      id: 'side-rig',
      masks: {},
      skeleton: [
        { bone: 'root', parent: null, offset: [0, 1, 0] },
        {
          bone: 'arm-r',
          parent: 'root',
          offset: [0.3, 0, 0],
          shape: { size: [0.1, 0.4, 0.1], center: [0, -0.2, 0] },
        },
      ],
    } as unknown as Parameters<typeof compileRig>[0]);
    const segments = restSegments(rig);
    expect(segments[0]?.lateral).toBe(0);
    expect(segments[1]?.lateral).toBeCloseTo(0.27, 10);
  });

  it('makes a bone without a shape a point at its joint', () => {
    const rig = compileRig(parseGraph(TEST_GRAPH));
    const segments = restSegments(rig);
    const shapeless = rig.defs.findIndex((d) => d.shape === undefined);
    expect(shapeless).toBeGreaterThanOrEqual(0);
    expect(segments[shapeless]?.tail).toEqual(segments[shapeless]?.head);
  });
});

describe('fitSegments', () => {
  const index = new Map([
    ['torso', 0],
    ['arm', 1],
  ]);
  const TORSO: BoneSegment = { head: [0, 0, 0], tail: [0, 2, 0], radius: 0.2 };
  // The rig's arm hangs straight down at the torso's side.
  const RIG_ARM: BoneSegment = { head: [0.25, 1.5, 0], tail: [0.25, 0.5, 0], radius: 0.05 };

  it('overrides only the fields a fit names, on only the bones it names', () => {
    const fitted = fitSegments([TORSO, RIG_ARM], index, { arm: { tail: [0.5, 0.5, 0] } });
    expect(fitted[0]).toEqual(TORSO);
    expect(fitted[1]).toEqual({ head: [0.25, 1.5, 0], tail: [0.5, 0.5, 0], radius: 0.05 });
  });

  it('leaves the rig segments it was given untouched', () => {
    fitSegments([TORSO, RIG_ARM], index, { arm: { head: [9, 9, 9] } });
    expect(RIG_ARM.head).toEqual([0.25, 1.5, 0]);
  });

  it('rejects a fit for a bone the rig lacks, so a misspelt name is not silently skipped', () => {
    expect(() => fitSegments([TORSO, RIG_ARM], index, { tail: { radius: 1 } })).toThrow(/tail/);
  });

  it('keeps cloth hanging beside the rig arm on the torso once the arm is fitted to a mesh that hangs outboard', () => {
    // A tabard edge at x = 0.24, 0.9 m up: touching the rig's arm (at x = 0.25), so the arm owns it...
    const cloth = [0.24, 0.9, 0];
    const rig = autoSkin(cloth, [TORSO, RIG_ARM]);
    expect(weightOf(rig, 0, 1)).toBeGreaterThan(0.5);
    // ...but the mesh's arm hangs out at x = 0.45, and the cloth stays with the torso.
    const fitted = fitSegments([TORSO, RIG_ARM], index, {
      arm: { head: [0.45, 1.5, 0], tail: [0.45, 0.5, 0] },
    });
    const skin = autoSkin(cloth, fitted);
    expect(weightOf(skin, 0, 0)).toBeGreaterThan(0.95);
  });
});

describe('autoSkin', () => {
  it('binds a vertex mostly to the bone whose segment it sits on', () => {
    const skin = autoSkin([0.02, 0.5, 0, 0.3, 1.5, 0.01], [LEG, ARM]);
    expect(weightOf(skin, 0, 0)).toBeGreaterThan(0.95);
    expect(weightOf(skin, 1, 1)).toBeGreaterThan(0.95);
  });

  it('blends the two bones at a joint between them', () => {
    const skin = autoSkin([0.0, 1.25, 0], [LEG, ARM]);
    expect(weightOf(skin, 0, 0)).toBeCloseTo(weightOf(skin, 0, 1), 1);
  });

  it('keeps at most four influences and normalises their weights to 1', () => {
    const bones: BoneSegment[] = Array.from({ length: 7 }, (_, i) => ({
      head: [i * 0.1, 0, 0],
      tail: [i * 0.1, 1, 0],
    }));
    const skin = autoSkin([0.2, 0.4, 0.1, 0.5, 0.9, 0.3], bones);
    expect(skin.indices).toHaveLength(2 * SKIN_INFLUENCES);
    for (let v = 0; v < 2; v++) {
      let sum = 0;
      for (let i = 0; i < SKIN_INFLUENCES; i++) sum += skin.weights[v * SKIN_INFLUENCES + i] ?? 0;
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it('handles a zero-length segment and a vertex sitting exactly on a bone', () => {
    const point: BoneSegment = { head: [1, 1, 1], tail: [1, 1, 1] };
    const skin = autoSkin([1, 1, 1], [point, LEG]);
    expect(weightOf(skin, 0, 0)).toBeGreaterThan(0.99);
    expect(Number.isFinite(skin.weights[0])).toBe(true);
  });

  it('binds a vertex inside a thick bone to it, though a thin bone is nearer its axis', () => {
    const thin: BoneSegment = { head: [0, 0, 0], tail: [0, 2, 0] };
    const thick: BoneSegment = { head: [0.3, 0, 0], tail: [0.3, 2, 0], radius: 0.25 };
    const skin = autoSkin([0.1, 1, 0], [thin, thick]);
    expect(weightOf(skin, 0, 1)).toBeGreaterThan(0.99);
  });

  it('keeps a vertex nearer the midline than a bone lateral limit out of that bone', () => {
    const side: BoneSegment = { head: [0.3, 0, 0], tail: [0.3, 2, 0], lateral: 0.2 };
    const centre: BoneSegment = { head: [0, 0, 0], tail: [0, 2, 0] };
    const near = autoSkin([0.15, 1, 0], [side, centre]);
    expect(weightOf(near, 0, 0)).toBe(0);
    const far = autoSkin([0.25, 1, 0], [side, centre]);
    expect(weightOf(far, 0, 0)).toBeGreaterThan(0.5);
  });

  it('never binds a vertex to a skipped bone, even when it sits right on it', () => {
    const skin = autoSkin([0.02, 0.5, 0], [LEG, ARM], new Set([0]));
    expect(weightOf(skin, 0, 0)).toBe(0);
    expect(weightOf(skin, 0, 1)).toBeCloseTo(1, 5);
  });

  it('clamps to the segment ends rather than extending the bone to infinity', () => {
    // 5 m below the leg's foot: the arm (1.5 m up) is nearer in a straight line to nothing, so the
    // leg's tail end is the closest point and still dominates.
    const skin = autoSkin([0, -5, 0], [LEG, ARM]);
    expect(weightOf(skin, 0, 0)).toBeGreaterThan(weightOf(skin, 0, 1));
  });
});

describe('bindRegion (mw-a6t)', () => {
  const sum = (skin: ReturnType<typeof autoSkin>, vertex: number) => {
    let total = 0;
    for (let i = 0; i < SKIN_INFLUENCES; i++)
      total += skin.weights[vertex * SKIN_INFLUENCES + i] ?? 0;
    return total;
  };
  // Two vertices on the arm, one near the hand end and one near the shoulder.
  const positions = [0.45, 1.5, 0, 0.05, 1.5, 0];
  const bones: BoneSegment[] = [ARM, LEG, { head: [0.5, 1.5, 0], tail: [0.5, 1.5, 0] }];

  it('moves a whole vertex to the bone and leaves the rest alone', () => {
    const skin = autoSkin(positions, bones, new Set([2]));
    const before = weightOf(skin, 1, 0);
    bindRegion(skin, positions, 2, (x) => (x > 0.3 ? 1 : 0));
    expect(weightOf(skin, 0, 2)).toBeCloseTo(1, 6);
    expect(weightOf(skin, 0, 0)).toBeCloseTo(0, 6);
    expect(weightOf(skin, 1, 2)).toBe(0);
    expect(weightOf(skin, 1, 0)).toBe(before);
  });

  it('blends a part share in and keeps every vertex summing to 1', () => {
    const skin = autoSkin(positions, bones, new Set([2]));
    const arm = weightOf(skin, 0, 0);
    bindRegion(skin, positions, 2, () => 0.25);
    expect(weightOf(skin, 0, 2)).toBeCloseTo(0.25, 6);
    expect(weightOf(skin, 0, 0)).toBeCloseTo(arm * 0.75, 6);
    expect(sum(skin, 0)).toBeCloseTo(1, 6);
    expect(sum(skin, 1)).toBeCloseTo(1, 6);
    // Binding again grows the bone's own share towards 1 instead of adding a second slot.
    bindRegion(skin, positions, 2, () => 0.5);
    expect(weightOf(skin, 0, 2)).toBeCloseTo(0.25 + 0.75 * 0.5, 6);
    expect(sum(skin, 0)).toBeCloseTo(1, 6);
  });

  it('replaces the lightest influence when all four are in use, and clamps shares to 0..1', () => {
    const many: BoneSegment[] = [
      ARM,
      LEG,
      ARM,
      LEG,
      ARM,
      { head: [0.5, 1.5, 0], tail: [0.5, 1.5, 0] },
    ];
    const skin = autoSkin([0.2, 1.4, 0], many, new Set([5]));
    bindRegion(skin, [0.2, 1.4, 0], 5, () => 7);
    expect(weightOf(skin, 0, 5)).toBeCloseTo(1, 6);
    expect(sum(skin, 0)).toBeCloseTo(1, 6);
    bindRegion(skin, [0.2, 1.4, 0], 5, () => -3);
    expect(weightOf(skin, 0, 5)).toBeCloseTo(1, 6);
  });

  it('leaves a vertex that already belongs wholly to the bone as it is', () => {
    const skin = autoSkin([0.2, 1.4, 0], [ARM]);
    bindRegion(skin, [0.2, 1.4, 0], 0, () => 0.5);
    expect(weightOf(skin, 0, 0)).toBeCloseTo(1, 6);
  });
});
