// mw-e03.27: the emergent combo catalogue. Each scenario in tests/scenarios/*.json replays in the
// chaos room (the game's wiring: the real stimulus API, the element rules, plates, ropes) on the replay
// harness; its outcomes are properties read at ticks and its final state hash is a golden. A rule
// change that breaks a combo fails here by naming the scenario and what the player would have seen.
//
// Re-record goldens after an intended change (not after content edits that move nothing; see the
// replay README on content hashes):
//   SCENARIOS_BLESS=1 pnpm vitest run tests/integration/emergence-scenarios.test.ts
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it, vi } from 'vitest';
import { markExercised } from '@content/testing';
import {
  applyStimulus,
  PlateComponent,
  plateChanged,
  readProperty,
  type EntityId,
  type PlateChange,
  type World,
} from '@sim/index';
import { currentContentHash } from '@tools/replay/files';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { loadScenarios, writeGolden } from '@tools/scenarios/files';
import { runScenario, ScenarioFailure } from '@tools/scenarios/runner';
import { MIN_SCENARIOS, type Scenario } from '@tools/scenarios/schema';

vi.setConfig({ testTimeout: 120_000 });

const scenarios = loadScenarios();
const contentHash = currentContentHash();
const bless = process.env['SCENARIOS_BLESS'] === '1';

describe('the emergent combo catalogue (mw-e03.27)', () => {
  it('AC-2: at least twelve scenarios, each with setup, inputs, outcomes and a player-facing description', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(MIN_SCENARIOS);
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
    for (const s of scenarios) {
      expect(s.description.length, s.id).toBeGreaterThan(20);
      expect(s.setup.props, s.id).not.toBe('');
      expect(s.inputs.length, s.id).toBeGreaterThan(0);
      expect(s.outcomes.length, s.id).toBeGreaterThan(0);
    }
  });

  describe.each(scenarios.map((s) => [s.id, s] as const))('%s', (_id, scenario) => {
    it('AC-1: the outcomes hold and the replay ends on the golden state hash', ({ task }) => {
      markExercised(task, 'scene', 'chaos-room');
      const run = runScenario(RAPIER, scenario, { contentHash, bless });
      if (bless) writeGolden(scenario, run.finalHash);
      expect(run.finalHash).toBe(run.replay.checkpoints.at(-1)?.hash);
    });
  });

  it('AC-3: a scenario whose outcome no longer holds fails naming the scenario and what the player would see', ({
    task,
  }) => {
    markExercised(task, 'scene', 'chaos-room');
    const [first] = scenarios;
    if (first === undefined) throw new Error('no scenarios');
    const broken: Scenario = {
      ...first,
      outcomes: first.outcomes.map((o) => ({
        ...o,
        value: typeof o.value === 'boolean' ? !o.value : 12345,
      })),
    };
    let failure: unknown;
    try {
      runScenario(RAPIER, broken, { contentHash, bless: true });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ScenarioFailure);
    const message = (failure as ScenarioFailure).message;
    expect(message).toContain(first.id);
    expect(message).toContain(first.description);
    expect(message).toContain(`The player should see: ${first.outcomes[0]?.sees ?? ''}`);
  });

  it('AC-4 (as built): a plate stays down while its burning load burns and releases only once the load is gone', ({
    task,
  }) => {
    // mw-e03.27 AC-4 asks for ice melting below the plate's weight threshold. Melting leaves a
    // block's weight alone (weight is a fixed property; nothing shrinks it), so the same time-based
    // release is built from what the sim does have: a straw bale that burns away entirely.
    markExercised(task, 'scene', 'chaos-room');
    const game = createGameWorld<unknown>(RAPIER, {
      seed: 1,
      hz: 60,
      scene: 'chaos-room',
      magic: true,
    });
    const sim = game.world as unknown as World<never>;
    const byId = new Map(game.scene.spawns.map(({ entity, spawn }) => [spawn.id, entity]));
    const id = (name: string): EntityId => {
      const found = byId.get(name);
      if (found === undefined) throw new Error(`no spawn ${name}`);
      return found;
    };
    const changes: PlateChange[] = [];
    sim.events.on(plateChanged, (change) => changes.push(change));
    for (let i = 0; i < 20; i++) sim.step();
    const plate = id('combo-plate-burden');
    const bale = id('combo-burden-crate');
    expect(sim.get(plate, PlateComponent)?.active).toBe(true);
    expect(sim.get(plate, PlateComponent)?.weight).toBeGreaterThanOrEqual(5);
    applyStimulus(sim, {
      shape: { kind: 'contact', target: bale },
      element: 'heat',
      intensity: 600,
    });
    let burningTicks = 0;
    let releasedWhileAlive: boolean | undefined;
    for (let i = 0; i < 600 && releasedWhileAlive === undefined; i++) {
      sim.step();
      if (sim.isAlive(bale) && readProperty(sim, bale, 'burning')) burningTicks++;
      if (sim.get(plate, PlateComponent)?.active === false) releasedWhileAlive = sim.isAlive(bale);
    }
    // Held down for a second or more of burning, and let go only when the bale was gone.
    expect(burningTicks).toBeGreaterThan(60);
    expect(releasedWhileAlive).toBe(false);
    expect(changes.map((c) => c.active)).toEqual([true, false]);
  });

  it("AC-5: the chaos room's rope is the spawn before its chandelier (the e2e finds the rope by id)", ({
    task,
  }) => {
    markExercised(task, 'scene', 'chaos-room');
    const game = createGameWorld<unknown>(RAPIER, {
      seed: 1,
      hz: 60,
      scene: 'chaos-room',
      magic: true,
    });
    const byId = new Map(game.scene.spawns.map(({ entity, spawn }) => [spawn.id, entity]));
    expect((byId.get('combo-chandelier') ?? 0) - 1).toBe(byId.get('combo-rope'));
  });
});
