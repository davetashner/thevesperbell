import { loadGameContent } from '@content/index';
import { describe, expect, it } from 'vitest';
import {
  AnimationController,
  compileGraph,
  createPose,
  maxBoneDeltaDeg,
  type ActionSample,
  type AnimParams,
  type Pose,
} from './index';

// mw-a6t: the knight's sword carry layer, on the real shared humanoid graph and clips.

const content = loadGameContent();
const graph = compileGraph(content.get('anim-graph', 'greybox-humanoid'), content.all('anim-clip'));
const ARM = ['upper-arm-r', 'forearm-r', 'sword'];

const params = (
  carry: boolean,
  values: AnimParams['values'] = {},
  action: ActionSample | null = null,
): AnimParams => ({
  values: { locomotion: 'idle', speed: 0, carry, acting: action !== null, ...values },
  timeScale: 1,
  action,
});

/** Runs `seconds` of frames and returns the pose. */
function pose(make: () => AnimParams, seconds = 1.2): Pose {
  const controller = new AnimationController(graph);
  for (let t = 0; t < seconds; t += 1 / 60) controller.update(1 / 60, make());
  const out = createPose(graph.rig.bones.length);
  controller.evaluate(out);
  return out;
}

/** The rotation (degrees) between two poses on the named bones only. */
function delta(a: Pose, b: Pose, bones: readonly string[]): number {
  let worst = 0;
  for (const bone of bones) {
    const i = graph.rig.index.get(bone) ?? -1;
    const ax = createPose(graph.rig.bones.length);
    const bx = createPose(graph.rig.bones.length);
    ax.set(a.subarray(i * 4, i * 4 + 4), i * 4);
    bx.set(b.subarray(i * 4, i * 4 + 4), i * 4);
    worst = Math.max(worst, maxBoneDeltaDeg(ax, bx));
  }
  return worst;
}

const OTHERS = graph.rig.bones.filter((b) => !ARM.includes(b));
const SWING: ActionSample = {
  move: 'sword-light-1',
  clip: 'anim-knight-sword-light-1',
  key: 1,
  moveTick: 14,
  activeFrom: 12,
  totalTicks: 34,
};

describe('the sword carry layer (mw-a6t)', () => {
  it('AC-2: a character that does not publish carry is posed exactly as before the layer', () => {
    for (const locomotion of ['idle', 'walk', 'run', 'crouch'] as const) {
      const speed = { idle: 0, walk: 1.5, run: 4, crouch: 0 }[locomotion];
      const plain = pose(() => params(false, { locomotion, speed }));
      const bare = pose(() => ({
        values: { locomotion, speed },
        timeScale: 1,
        action: null,
      }));
      expect(maxBoneDeltaDeg(plain, bare)).toBeLessThan(1e-3);
    }
  });

  it('AC-2: the carry moves only the right arm and the sword, and the miner pick bone is the sword bone', () => {
    const on = pose(() => params(true));
    const off = pose(() => params(false));
    expect(delta(on, off, OTHERS)).toBeLessThan(1e-3);
    expect(delta(on, off, ['forearm-r'])).toBeGreaterThan(20);
    expect(delta(on, off, ['sword'])).toBeGreaterThan(20);
  });

  it('AC-3: a swing reaches the same pose from the carry as from the plain hang', () => {
    const swing = (carry: boolean) => pose(() => params(carry, {}, SWING), 0.5);
    expect(maxBoneDeltaDeg(swing(true), swing(false))).toBeLessThan(1e-3);
  });

  it("AC-3: the swing starts from the carry pose with no snap beyond the plain hang's, and the carry returns afterwards", () => {
    const run = (carry: boolean) => {
      const controller = new AnimationController(graph);
      const step = (p: AnimParams) => {
        controller.update(1 / 60, p);
        const out = createPose(graph.rig.bones.length);
        controller.evaluate(out);
        return out;
      };
      let last = step(params(carry));
      for (let i = 0; i < 90; i++) last = step(params(carry));
      const rest = last;
      let worst = 0;
      for (let i = 0; i < 12; i++) {
        const next = step(params(carry, {}, { ...SWING, moveTick: i }));
        worst = Math.max(worst, maxBoneDeltaDeg(last, next));
        last = next;
      }
      for (let i = 0; i < 120; i++) last = step(params(carry));
      return { worst, back: delta(last, rest, ARM) };
    };
    const carried = run(true);
    expect(carried.worst).toBeLessThan(run(false).worst + 12);
    // (The idle clip breathes, so the arm returns to within a degree or two, not bit for bit.)
    expect(carried.back).toBeLessThan(2);
  });

  it('AC-3: a dodge shows its own arm pose with or without the carry', () => {
    const dodge = (carry: boolean) =>
      pose(
        () =>
          params(
            carry,
            { actionVerb: 'dodge', locomotion: 'run', speed: 4 },
            {
              move: 'dodge-roll',
              clip: 'anim-knight-dodge-roll',
              key: 2,
              moveTick: 10,
              activeFrom: 4,
              totalTicks: 30,
            },
          ),
        0.5,
      );
    expect(delta(dodge(true), dodge(false), ARM)).toBeLessThan(1e-3);
  });
});
