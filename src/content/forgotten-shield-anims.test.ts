// mw-ju8.24 AC-1: the Forgotten shield-bearer's bash and counter are bespoke hand-keyed clips (no
// longer the miner's retimed placeholders) whose hit markers lie within one tick of their move's
// first active tick (60 Hz), and the guard layer plays its raise, hold and lower clips off the
// `guard` parameter. AC-2 (the poses read in ?scene=skeleton-pen) is a manual playtest.

import { describe, expect, it } from 'vitest';
import { loadGameContent } from './game-content.ts';

const content = loadGameContent();
const HZ = 60;

describe('the Forgotten shield-bearer animation clips', () => {
  for (const id of ['forgotten-shield-bash', 'forgotten-shield-counter']) {
    it(`AC-1: ${id} is a bespoke clip with its hit marker on the move's first active tick`, () => {
      const move = content.get('move', id);
      const clip = content.get('anim-clip', move.presentation.anim);
      expect(clip.notes).not.toMatch(/placeholder|retimed/i);
      expect(move.presentation.anim).toBe(`anim-${id}`);
      const hits = clip.markers.filter((m) => m.kind === 'hit');
      expect(hits).toHaveLength(1);
      expect(Math.abs((hits[0]?.t ?? Infinity) * HZ - move.frames.startup)).toBeLessThanOrEqual(1);
      // The whole move fits the clip: it ends on the move's last tick.
      expect(
        Math.abs(
          clip.duration * HZ - (move.frames.startup + move.frames.active + move.frames.recovery),
        ),
      ).toBeLessThanOrEqual(1);
      // Bespoke: it keys the shield arm and the torso, not the miner's pick arm alone.
      expect(Object.keys(clip.tracks)).toEqual(expect.arrayContaining(['upper-arm-l', 'chest']));
    });
  }

  it('AC-1: the raise lasts the shield’s raise ticks, the hold loops and each clip is hand-keyed', () => {
    const shield = content.get('shield', 'forgotten-board-shield');
    const raise = content.get('anim-clip', 'anim-forgotten-shield-raise');
    expect(raise.duration * HZ).toBeCloseTo(shield.raiseTicks, 0);
    expect(content.get('anim-clip', 'anim-forgotten-shield-hold').loop).toBe(true);
    expect(content.get('anim-clip', 'anim-forgotten-shield-lower').loop).toBe(false);
    for (const phase of ['raise', 'hold', 'lower'])
      expect(content.get('anim-clip', `anim-forgotten-shield-${phase}`).notes).not.toMatch(
        /placeholder/i,
      );
  });

  it('AC-2: the guard layer plays raise, hold and lower for the guard phases', () => {
    const graph = content.get('anim-graph', 'greybox-humanoid');
    const layer = graph.layers.find((l) => l.id === 'guard');
    const clips = layer?.states.flatMap((s) =>
      s.motion.kind === 'clip' ? [s.motion.clip.id] : [],
    );
    expect(clips).toEqual([
      'anim-forgotten-shield-raise',
      'anim-forgotten-shield-hold',
      'anim-forgotten-shield-lower',
    ]);
    const ids = graph.layers.map((l) => l.id);
    expect(ids.indexOf('guard')).toBeLessThan(ids.indexOf('action'));
  });
});
