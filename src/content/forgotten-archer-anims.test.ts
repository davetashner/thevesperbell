// mw-ju8.23 AC-1: the Forgotten archer's shot and shove are bespoke hand-keyed clips (not the miner's
// thrust retimed), with the hit marker within one tick of the move's first active tick. AC-2 (the bow
// draw reading clearly in ?scene=skeleton-pen) needs a human playtest.

import { describe, expect, it } from 'vitest';
import { loadGameContent } from './game-content.ts';

const content = loadGameContent();
const TICK = 1 / 60;
const CLIPS = [
  ['forgotten-archer-shot', 'anim-forgotten-archer-shot'],
  ['forgotten-archer-shove', 'anim-forgotten-archer-shove'],
] as const;

function rotAt(clipId: string, bone: string, t: number): readonly number[] {
  const keys = content.get('anim-clip', clipId).tracks[bone] ?? [];
  const next = keys.findIndex((k) => k.t >= t);
  const after = keys[next];
  const before = keys[next - 1];
  if (after === undefined) return keys[keys.length - 1]?.rot ?? [0, 0, 0];
  if (before === undefined) return after.rot;
  const f = (t - before.t) / (after.t - before.t);
  return after.rot.map((v, i) => (before.rot[i] ?? 0) + (v - (before.rot[i] ?? 0)) * f);
}

describe('mw-ju8.23: the archer’s bespoke clips', () => {
  it('AC-1: each clip is bespoke, with its hit marker within one tick of the move’s first active tick', () => {
    const thrust = content.get('anim-clip', 'anim-forgotten-lunging-thrust');
    for (const [moveId, clipId] of CLIPS) {
      const move = content.get('move', moveId);
      expect(move.presentation.anim).toBe(clipId);
      const clip = content.get('anim-clip', clipId);
      expect(clip.notes).not.toMatch(/placeholder|retimed/i);
      expect(clip.rig).toBe('greybox-humanoid');
      const hits = clip.markers.filter((m) => m.kind === 'hit');
      expect(hits).toHaveLength(1);
      expect(Math.abs((hits[0]?.t ?? 0) - move.frames.startup * TICK)).toBeLessThanOrEqual(TICK);
      // Not the miner's thrust: it animates bones the thrust does not (the other hand or the head).
      expect(Object.keys(clip.tracks).sort()).not.toEqual(Object.keys(thrust.tracks).sort());
    }
  });

  it('AC-1: the clips last as long as their moves', () => {
    for (const [moveId, clipId] of CLIPS) {
      const f = content.get('move', moveId).frames;
      const ticks = f.startup + f.active + f.recovery;
      expect(content.get('anim-clip', clipId).duration).toBeCloseTo(ticks * TICK, 1);
    }
  });

  it('AC-2: the shot reads as a draw: bow arm raised and steady, string hand back to the cheek, snapping back on the loose', () => {
    const id = 'anim-forgotten-archer-shot';
    const hit = 42 * TICK;
    const bowArmRest = rotAt(id, 'upper-arm-l', 0)[0] ?? 0;
    // The bow arm is up to shoulder height before the loose and barely moves through it.
    expect(rotAt(id, 'upper-arm-l', hit - 0.15)[0]).toBeGreaterThan(bowArmRest + 70);
    const steady = Math.abs(
      (rotAt(id, 'upper-arm-l', hit)[0] ?? 0) - (rotAt(id, 'upper-arm-l', hit - 0.15)[0] ?? 0),
    );
    expect(steady).toBeLessThan(5);
    // The string forearm is folded to the cheek during the hold, and opens a little on the loose.
    expect(rotAt(id, 'forearm-r', hit - 0.05)[0]).toBeGreaterThan(120);
    expect(rotAt(id, 'forearm-r', hit + 0.04)[0]).toBeLessThan(rotAt(id, 'forearm-r', hit)[0] ?? 0);
    // It holds the draw (an aimed beat) before loosing, and is back at rest by the end.
    expect(rotAt(id, 'forearm-r', hit - 0.15)[0]).toBeGreaterThan(120);
    const end = content.get('anim-clip', id).duration;
    expect(rotAt(id, 'upper-arm-r', end)[0]).toBeCloseTo(0, 5);
  });
});
