// mw-e04.12 AC-7: the attacker dummy swings once at a knight who parries it. With the swing's first
// sweep on the parry's first window tick (4) or its last (13) it is parried — no damage, the dummy
// Parried for 90 ticks, both frozen for the parry tier — and with the parry pressed one tick late the
// sweep lands on its last startup tick (3) and strikes. Each is a golden (a state hash on every tick)
// and replays 100 times to identical hashes.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ActionStarted,
  DamageApplied,
  healthOf,
  HitParried,
  HitStopStarted,
  isParried,
  playReplay,
  type ActionStartInfo,
  type DamageResult,
  type HitStopInfo,
  type ParryInfo,
} from '@sim/index';
import { FIRST_SWEEP_TICK } from '@tools/replay/dodge-timing-scenario';
import { currentContentHash, GOLDEN_REPLAY_DIR, readReplay } from '@tools/replay/files';
import {
  createParryTimingWorld,
  PARRY_PRESS,
  parryFirstTickScenario,
  parryLastTickScenario,
  parryOneLateScenario,
  parryTimingLog,
} from '@tools/replay/parry-timing-scenario';

const KNIGHT = 1;
const DUMMY = 2;

/** Runs a variant live and records what happened. */
function outcome(pressTick: number) {
  const world = createParryTimingWorld({ seed: 1, hz: 60 });
  const started: ActionStartInfo[] = [];
  const damage: DamageResult[] = [];
  const parries: ParryInfo[] = [];
  const freezes: HitStopInfo[] = [];
  world.events.on(ActionStarted, (e) => started.push(e));
  world.events.on(DamageApplied, (e) => damage.push(e));
  world.events.on(HitParried, (e) => parries.push(e));
  world.events.on(HitStopStarted, (e) => freezes.push(e));
  const parried: number[] = [];
  for (const frame of parryTimingLog(pressTick)) {
    world.step([frame]);
    if (isParried(world, DUMMY)) parried.push(world.tick);
  }
  return { world, started, damage, parries, freezes, parried };
}

/** 100 replays take a few seconds alone but far longer on a loaded CI runner (60 s timed out in Nov 2026): allow three minutes. */
const REPLAY_TIMEOUT_MS = 180_000;

const variants = [
  { file: 'parry-first-tick.json', scenario: parryFirstTickScenario },
  { file: 'parry-last-tick.json', scenario: parryLastTickScenario },
  { file: 'parry-one-tick-late.json', scenario: parryOneLateScenario },
] as const;

describe('parry timing replays (mw-e04.12)', () => {
  it('AC-7: on the window’s first and last tick the swing is parried; one tick late it lands', () => {
    for (const press of [PARRY_PRESS.firstTick, PARRY_PRESS.lastTick]) {
      const run = outcome(press);
      expect(run.started.map((e) => [e.tick, e.entity, e.move])).toEqual([
        [30, DUMMY, 'training-dummy-swing'],
        [press, KNIGHT, 'shield-parry'],
      ]);
      expect(run.damage.map((d) => [d.tick, d.target, d.total, d.tags])).toEqual([
        [FIRST_SWEEP_TICK, KNIGHT, 0, ['parried', 'parryable']],
      ]);
      expect(run.parries).toEqual([
        {
          tick: FIRST_SWEEP_TICK,
          entity: KNIGHT,
          attacker: DUMMY,
          source: DUMMY,
          parriedTicks: 90,
        },
      ]);
      expect(run.freezes.map((f) => [f.entity, f.tier, f.ticks])).toEqual([
        [DUMMY, 'parry', 8],
        [KNIGHT, 'parry', 8],
      ]);
      // Parried for 90 ticks of its own time: the 8 frozen ticks push the end back.
      expect(run.parried).toHaveLength(90 + 8);
      expect(run.parried[0]).toBe(FIRST_SWEEP_TICK + 1);
      expect(healthOf(run.world, KNIGHT)?.current).toBe(100);
    }

    const late = outcome(PARRY_PRESS.oneLate);
    expect(late.parries).toEqual([]);
    expect(late.parried).toEqual([]);
    expect(late.damage.map((d) => [d.tick, d.target, d.total, d.tags])).toEqual([
      [FIRST_SWEEP_TICK, KNIGHT, 15, ['parryable']],
    ]);
    expect(healthOf(late.world, KNIGHT)?.current).toBe(85);
  });

  it.each(variants)(
    'AC-7: $file is recorded on every tick and replays 100 times to identical hashes',
    ({ file, scenario }) => {
      const replay = readReplay(join(GOLDEN_REPLAY_DIR, file));
      expect(replay.scenario).toBe(scenario.name);
      expect(replay.checkpointInterval).toBe(1);
      expect(replay.checkpoints).toHaveLength(replay.ticks + 1);
      const contentHash = currentContentHash();
      const finals = new Set<string>();
      for (let run = 0; run < 100; run++) {
        const result = playReplay(replay, scenario, { contentHash });
        expect(result.status).toBe('passed');
        if (result.status === 'passed') finals.add(result.finalHash);
      }
      expect(finals.size).toBe(1);
    },
    REPLAY_TIMEOUT_MS,
  );

  it('AC-7: the goldens diverge exactly where the presses do', () => {
    const [first, last, late] = variants.map(({ file }) =>
      readReplay(join(GOLDEN_REPLAY_DIR, file)),
    );
    if (first === undefined || last === undefined || late === undefined) {
      throw new Error('missing golden');
    }
    const divergence = (a: typeof first, b: typeof first) =>
      a.checkpoints[a.checkpoints.findIndex((c, i) => c.hash !== b.checkpoints[i]?.hash)]?.tick;
    expect(divergence(first, last)).toBe(PARRY_PRESS.lastTick + 1);
    expect(divergence(first, late)).toBe(PARRY_PRESS.firstTick + 1);
  });
});
