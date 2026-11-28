// Replays emergent combo scenarios (mw-e03.27) on the replay harness (mw-e00.17): a scenario becomes a
// ReplayScenario in the chaos room (the game's own wiring, createGameWorld with magic) whose input
// script is the scenario's stimuli as debug commands, so the recorder captures them and the player
// reproduces them. Outcomes are read from the world as the script runs; a failure names the scenario,
// its description and what the player would have seen.

import { z } from 'zod';
import {
  blastCommand,
  describeOutcome,
  isDebugCommand,
  PhysicsObjectComponent,
  PlacementComponent,
  PlateComponent,
  playReplay,
  propertyCommand,
  readProperty,
  recordScenario,
  stimCommand,
  type DebugCommand,
  type EntityId,
  type RapierModule,
  type Replay,
  type ReplayScenario,
  type Vec3,
  type World,
  type WorldPropertyKey,
} from '@sim/index';
import { createGameWorld } from '../replay/testbed-player-scenario';
import { SCENARIO_HZ, SCENARIO_SEED, type Scenario, type ScenarioOutcome } from './schema';

type Reading = number | boolean | string;

/** A scenario that did not hold; the message is the whole report. */
export class ScenarioFailure extends Error {
  override readonly name = 'ScenarioFailure';

  constructor(
    readonly scenario: Scenario,
    readonly problems: readonly string[],
  ) {
    super(
      `emergent scenario "${scenario.id}" failed: ${scenario.description}\n  ${problems.join('\n  ')}`,
    );
  }
}

const commandSchema = z.custom<DebugCommand>(isDebugCommand);

const COMPARE: Readonly<Record<ScenarioOutcome['op'], (a: Reading, b: Reading) => boolean>> = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
};

/** What a run of a scenario returns. */
export interface ScenarioRun {
  readonly replay: Replay;
  /** The state hash after the last tick. */
  readonly finalHash: string;
}

/** The replay scenario a combo scenario runs on, collecting failed outcomes into `problems`. */
export function comboReplayScenario(
  rapier: RapierModule,
  scenario: Scenario,
  problems: string[] = [],
): ReplayScenario<DebugCommand> {
  let ids = new Map<string, EntityId>();
  let tags = new Map<string, readonly string[]>();
  const entity = (name: string): EntityId => {
    const found = ids.get(name);
    if (found === undefined) throw new Error(`scenario "${scenario.id}": no spawn "${name}"`);
    return found;
  };
  const place = (
    world: World<DebugCommand>,
    at: string | readonly [number, number, number],
  ): Vec3 => {
    if (typeof at !== 'string') return { x: at[0], y: at[1], z: at[2] };
    const placed = world.get(entity(at), PlacementComponent);
    if (placed === undefined) throw new Error(`scenario "${scenario.id}": "${at}" has no position`);
    return { x: placed.x, y: placed.y, z: placed.z };
  };
  const targets = (outcome: ScenarioOutcome): EntityId[] => {
    const target = outcome.target;
    if ('spawn' in target) return [entity(target.spawn)];
    return [...tags].filter(([, t]) => t.includes(target.tag)).map(([name]) => entity(name));
  };
  const read = (world: World<DebugCommand>, id: EntityId, reading: string): Reading => {
    if (reading === 'alive') return world.isAlive(id);
    if (!world.isAlive(id)) return 'gone';
    switch (reading) {
      case 'plate.active':
        return world.get(id, PlateComponent)?.active ?? 'no plate';
      case 'plate.weight':
        return world.get(id, PlateComponent)?.weight ?? 'no plate';
      case 'position.y':
        return world.get(id, PhysicsObjectComponent)?.position.y ?? 'no body';
      default:
        return readProperty(
          world as unknown as World<never>,
          id,
          reading as WorldPropertyKey,
        ) as Reading;
    }
  };
  const check = (world: World<DebugCommand>, outcome: ScenarioOutcome): void => {
    const found = targets(outcome);
    const readings = found.map((id) => read(world, id, outcome.reading));
    const holds = readings.map((r) => COMPARE[outcome.op](r, outcome.value));
    const every = 'which' in outcome.target && outcome.target.which === 'all';
    if (found.length > 0 && (every ? holds.every(Boolean) : holds.some(Boolean))) return;
    const label = 'spawn' in outcome.target ? outcome.target.spawn : outcome.target.tag;
    problems.push(
      `tick ${String(outcome.tick)}: expected ${outcome.reading} of ${label} ${outcome.op} ` +
        `${JSON.stringify(outcome.value)}, got ${readings.map((r) => JSON.stringify(r)).join(', ')}. ` +
        `The player should see: ${outcome.sees}`,
    );
  };
  const commandsAt = (world: World<DebugCommand>, tick: number): DebugCommand[] => {
    const out: DebugCommand[] = [];
    if (tick === 0) {
      for (const s of scenario.setup.properties) {
        out.push(propertyCommand(entity(s.target), s.property, s.value));
      }
    }
    for (const input of scenario.inputs.filter((i) => i.tick === tick)) {
      if ('stimulus' in input) {
        const s = input.stimulus;
        out.push(stimCommand(s.element, place(world, s.at), s.radius, s.intensity));
      } else if ('blast' in input) {
        const b = input.blast;
        out.push(blastCommand(place(world, b.at), b.radius, b.intensity));
      } else {
        out.push(propertyCommand(entity(input.set.target), input.set.property, input.set.value));
      }
    }
    return out;
  };
  return {
    name: `emergence-${scenario.id}`,
    usesContent: true,
    ticks: scenario.ticks,
    command: commandSchema,
    create: (options) => {
      const game = createGameWorld<DebugCommand>(rapier, {
        seed: options.seed,
        hz: options.hz,
        scene: scenario.scene,
        magic: true,
      });
      ids = new Map(game.scene.spawns.map(({ entity: id, spawn }) => [spawn.id, id]));
      tags = new Map(game.scene.spawns.map(({ spawn }) => [spawn.id, spawn.tags]));
      return game.world;
    },
    drive: ({ tick, world }) => {
      for (const outcome of scenario.outcomes.filter((o) => o.tick === tick)) check(world, outcome);
      return commandsAt(world, tick);
    },
  };
}

/**
 * Records the scenario on the replay harness (checking its outcomes as it runs), replays the
 * recording to the same hashes, and compares the final hash with the golden.
 * @throws ScenarioFailure naming the scenario for a failed outcome, a replay that diverges, or a
 * final hash other than the golden's (unless `bless`, which accepts any hash).
 */
export function runScenario(
  rapier: RapierModule,
  scenario: Scenario,
  options: {
    readonly contentHash: string;
    readonly bless?: boolean;
    /** Replays a recording (the harness's playReplay; tests pass a stand-in that diverges). */
    readonly play?: typeof playReplay;
  },
): ScenarioRun {
  const problems: string[] = [];
  const replayScenario = comboReplayScenario(rapier, scenario, problems);
  const replay = recordScenario(replayScenario, {
    seed: SCENARIO_SEED,
    hz: SCENARIO_HZ,
    ticks: scenario.ticks,
    buildSha: 'local',
    contentHash: options.contentHash,
    keepStates: false,
  });
  if (problems.length > 0) throw new ScenarioFailure(scenario, problems);
  const outcome = (options.play ?? playReplay)(replay, replayScenario, {
    contentHash: options.contentHash,
  });
  if (outcome.status !== 'passed') {
    throw new ScenarioFailure(scenario, [
      `its own recording did not replay: ${describeOutcome(scenario.id, outcome)}`,
    ]);
  }
  if (options.bless !== true && replay.finalHash !== scenario.golden.finalHash) {
    throw new ScenarioFailure(scenario, [
      `final state hash ${replay.finalHash} is not the golden ${String(scenario.golden.finalHash)}; ` +
        'if the change is intended run pnpm scenarios:bless',
    ]);
  }
  return { replay, finalHash: replay.finalHash };
}
