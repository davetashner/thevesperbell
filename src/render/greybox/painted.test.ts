import { describe, expect, it } from 'vitest';
import { isPaintedCrate, paintedKind, stoneFor } from './index';

describe('paintedKind (mw-va0)', () => {
  it('paints a kit pillar as stone, whatever its properties', () => {
    expect(paintedKind({ piece: 'pillar' }, undefined)).toBe('pillar');
    expect(paintedKind({ piece: 'pillar' }, { material: { id: 'ivy' } })).toBe('pillar');
  });

  it('paints a piece whose level material is ivy (a content reference, not a string)', () => {
    expect(paintedKind({ piece: 'platform' }, { material: { id: 'ivy' } })).toBe('ivy');
  });

  it('paints a piece with the ivy climb grade', () => {
    expect(paintedKind({ piece: 'wall' }, { climbable: 'ivy' })).toBe('ivy');
  });

  it('leaves every other part to the grid material', () => {
    expect(paintedKind({ piece: 'platform' }, undefined)).toBeUndefined();
    expect(paintedKind({ piece: 'platform' }, { material: { id: 'wood' } })).toBeUndefined();
    expect(paintedKind({ piece: 'wall' }, { climbable: 'ladder' })).toBeUndefined();
  });
});

describe('stoneFor (mw-7w0)', () => {
  it('lays the stone on the testbed floor only, upward faces, grid kept (the owner probe)', () => {
    expect(stoneFor('testbed', 'walkable')).toEqual({ faces: 'floor', grid: true });
    expect(stoneFor('testbed', 'blocking')).toBeUndefined();
    expect(stoneFor('testbed', 'climbable')).toBeUndefined();
  });

  it('lays the stone on every face of the slice floors, walls and ledges, with no grid', () => {
    for (const purpose of ['walkable', 'blocking', 'climbable'] as const) {
      expect(stoneFor('slice', purpose)).toEqual({ faces: 'all', grid: false });
    }
  });

  it('leaves hazards and interactive parts, and every other scene, to the flat colours', () => {
    expect(stoneFor('slice', 'hazard')).toBeUndefined();
    expect(stoneFor('slice', 'interactive')).toBeUndefined();
    expect(stoneFor('mechanism-room', 'walkable')).toBeUndefined();
    expect(stoneFor('kit-gallery', 'blocking')).toBeUndefined();
  });
});

describe('isPaintedCrate (mw-e40.34)', () => {
  it('AC-1: a placed interactive crate wears the crate painting, not the interactive blue', () => {
    expect(isPaintedCrate({ piece: 'crate', purpose: 'interactive', shape: 'box' })).toBe(true);
  });

  it('AC-2: other pieces, and a crate re-purposed to another role, keep their purpose colour', () => {
    expect(isPaintedCrate({ piece: 'wall', purpose: 'interactive', shape: 'box' })).toBe(false);
    expect(isPaintedCrate({ piece: 'crate', purpose: 'blocking', shape: 'box' })).toBe(false);
  });
});
