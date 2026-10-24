import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  bowPlacement,
  forgottenKit,
  maulPlacement,
  pickPlacement,
  PROP_URLS,
  shieldPlacement,
} from './forgotten-kit';

describe('forgottenKit', () => {
  it('AC-1: the brute is a bigger skeleton with a maul', () => {
    expect(forgottenKit('forgotten-brute')).toEqual({ body: 'brute', right: 'maul' });
  });

  it('AC-1: the archer holds a bow and the shield-bearer a shield, on a miner skeleton', () => {
    expect(forgottenKit('forgotten-archer')).toEqual({ body: 'miner', left: 'bow' });
    expect(forgottenKit('forgotten-shield-bearer')).toEqual({ body: 'miner', left: 'shield' });
  });

  it('AC-3: the miner, an absent id and an unknown id keep the miner look and its pick', () => {
    const miner = { body: 'miner', right: 'pick' };
    expect(forgottenKit('forgotten-miner')).toEqual(miner);
    expect(forgottenKit()).toEqual(miner);
    expect(forgottenKit('fixture-hound')).toEqual(miner);
  });
});

describe('placements', () => {
  const hand = new Vector3(-0.4, 0.8, 0.05);

  it('AC-3: the pick is placed exactly as before (upright, 0.85 m, butt 0.12 m below the hand)', () => {
    expect(pickPlacement(hand)).toEqual({
      rotateDeg: [17.9, 0, 0],
      length: 0.85,
      anchor: 'bottom',
      offset: [-0.4, 0.8 - 0.12, 0.05],
    });
  });

  it('AC-1: the maul stands taller than the pick, fore and aft, gripped low on the haft', () => {
    const maul = maulPlacement(hand);
    expect(maul.length).toBeGreaterThan(pickPlacement(hand).length);
    expect(maul.rotateDeg).toEqual([0, 90, 0]);
    expect(maul.offset[0]).toBe(hand.x);
    expect(maul.offset[1]).toBeLessThan(hand.y);
  });

  it('AC-1: the bow and the shield sit on the left, the shield in front of the arm', () => {
    const left = new Vector3(0.4, 0.8, 0);
    expect(bowPlacement(left).offset[0]).toBe(0.4);
    const shield = shieldPlacement(left);
    expect(shield.offset[0]).toBe(0.4);
    expect(shield.offset[2]).toBeGreaterThan(0);
    expect(shield.rotateDeg).toEqual([0, -90, 0]);
  });

  it('AC-1: every gear piece has its own model file', () => {
    expect(new Set(Object.values(PROP_URLS)).size).toBe(4);
  });
});
