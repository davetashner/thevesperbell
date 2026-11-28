import { loadGameContent } from '@content/index';
import { describe, expect, it } from 'vitest';
import { AnimationController, compileGraph, createPose, type AnimParams } from './index';

// mw-t4s: the knight's raised-shield guard pose, on the real shared humanoid graph and clips. The
// shield rides the left forearm, so where that forearm's tip (the hand) is, is where the shield is.

const content = loadGameContent();
const graph = compileGraph(content.get('anim-graph', 'greybox-humanoid'), content.all('anim-clip'));

const params = (guard: string): AnimParams => ({
  values: { locomotion: 'idle', speed: 0, carry: true, guard },
  timeScale: 1,
  action: null,
});

type V3 = [number, number, number];
type Q = [number, number, number, number];

function rotate(q: Q, v: V3): V3 {
  const [x, y, z, w] = q;
  const t: V3 = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [
    v[0] + w * t[0] + (y * t[2] - z * t[1]),
    v[1] + w * t[1] + (z * t[0] - x * t[2]),
    v[2] + w * t[2] + (x * t[1] - y * t[0]),
  ];
}

/** The body-space position of a point `local` of a bone, by forward kinematics (feet at the origin). */
function worldOf(pose: Float64Array, bone: string, local: V3): V3 {
  let point = local;
  let i = graph.rig.index.get(bone) ?? -1;
  while (i >= 0) {
    const o = i * 4;
    const q: Q = [pose[o] ?? 0, pose[o + 1] ?? 0, pose[o + 2] ?? 0, pose[o + 3] ?? 1];
    const turned = rotate(q, point);
    const off = graph.rig.offsets;
    point = [
      turned[0] + (off[i * 3] ?? 0),
      turned[1] + (off[i * 3 + 1] ?? 0),
      turned[2] + (off[i * 3 + 2] ?? 0),
    ];
    i = graph.rig.parents[i] ?? -1;
  }
  return point;
}

/** Where the left hand (the forearm's tip, behind the shield) is after `seconds` of `guard`. */
function hand(guard: string, seconds = 1.2): V3 {
  const controller = new AnimationController(graph);
  for (let t = 0; t < seconds; t += 1 / 60) controller.update(1 / 60, params(guard));
  const pose = createPose(graph.rig.bones.length);
  controller.evaluate(pose);
  return worldOf(pose, 'forearm-l', [0, -0.28, 0]);
}

describe('the knight raising his shield (mw-t4s)', () => {
  it('AC-2: held, the shield hand is higher and further forward than at his side', () => {
    const idle = hand('none');
    const held = hand('held');
    // Forward is -z in the rig.
    expect(held[1] - idle[1]).toBeGreaterThan(0.15);
    expect(idle[2] - held[2]).toBeGreaterThan(0.1);
    // ...and brought in from the hip to the middle of the body.
    expect(Math.abs(idle[0]) - Math.abs(held[0])).toBeGreaterThan(0.25);
  });

  it('AC-2: held, the shield sits in front of the chest, not out to the side', () => {
    const held = hand('held');
    expect(Math.abs(held[0])).toBeLessThan(0.3);
    expect(held[1]).toBeGreaterThan(1.1);
  });

  it('AC-2: it comes up through the raise and settles into the hold', () => {
    const raising = hand('raising', 0.05);
    const held = hand('held');
    expect(raising[1]).toBeLessThan(held[1]);
  });
});
