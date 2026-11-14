// mw-e31.10 AC-5: the difficulty preset is a recorded input of a replay. Two replays that differ only by
// preset (a `difficultyCommand` on tick 0) end on different state hashes, and the player's health shows
// the damage model reading damageTaken; each replays to identical checkpoints, also from its JSON file.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GAME_CONFIG_ID, loadGameContent } from '@content/index';
import { loadDifficultyPresets, type DifficultyPresetId } from '@game/settings/index';
import {
  DAMAGE_COMPONENTS,
  DamageModel,
  difficultyCommand,
  giveCombatant,
  healthOf,
  isDifficultyCommand,
  parseReplay,
  playReplay,
  recordScenario,
  serializeReplay,
  World,
  type DifficultyCommand,
  type EntityId,
  type Replay,
  type ReplayScenario,
} from '@sim/index';

const presets = loadDifficultyPresets(loadGameContent().get('game', GAME_CONFIG_ID));

type Input = DifficultyCommand;
const TICKS = 120;
const HIT_EVERY = 30;

/** A knight hit for 20 slash damage every half second, on whatever difficulty it was told. */
let lastWorld: { world: World<Input>; player: EntityId } | undefined;
const scenario: ReplayScenario<Input> = {
  name: 'difficulty-hits',
  usesContent: false,
  command: z.custom<DifficultyCommand>(isDifficultyCommand),
  create: ({ seed }) => {
    const world = new World<Input>({ seed }).register(...DAMAGE_COMPONENTS);
    const player = world.spawn();
    giveCombatant(world, player, { health: 100, player: true });
    const model = new DamageModel();
    world.addSystem({
      name: 'hits',
      run: (ctx) => {
        if (ctx.tick > 0 && ctx.tick % HIT_EVERY === 0) {
          model.apply(world, player, { amounts: { slash: 20 } });
        }
      },
    });
    lastWorld = { world, player };
    return world;
  },
  drive: () => [],
};

function record(preset: DifficultyPresetId): Replay {
  return recordScenario(scenario, {
    seed: 11,
    ticks: TICKS,
    buildSha: 'test',
    contentHash: 'none',
    checkpointInterval: 20,
    // The only difference between the runs: the config sent on tick 0.
    inputs: (tick) => (tick === 0 ? [difficultyCommand(presets.presets[preset])] : []),
  });
}

/** Player health after a replay of `preset` has run live. */
function healthAfter(preset: DifficultyPresetId): number {
  record(preset);
  const live = lastWorld;
  if (live === undefined) throw new Error('no world');
  return healthOf(live.world, live.player)?.current ?? Number.NaN;
}

describe('difficulty as a replay input (mw-e31.10)', () => {
  it('AC-5: replays identical but for the preset end on different state hashes', () => {
    const story = record('story');
    const adventurer = record('adventurer');
    const veteran = record('veteran');
    const hashes = new Set([story.finalHash, adventurer.finalHash, veteran.finalHash]);
    expect(hashes.size).toBe(3);
    // The first checkpoint is the world before any tick; the next one already differs: the config is state.
    expect(story.checkpoints[1]?.hash).not.toBe(adventurer.checkpoints[1]?.hash);
    expect(veteran.checkpoints[1]?.hash).not.toBe(adventurer.checkpoints[1]?.hash);
  });

  it('AC-5: the preset changes the outcome: Story takes half the damage, Veteran takes more', () => {
    // Three 20-damage hits: 100 -> 40 as authored.
    expect(healthAfter('adventurer')).toBe(40);
    expect(healthAfter('story')).toBe(70);
    expect(healthAfter('veteran')).toBe(10);
  });

  it('AC-5: each replay is deterministic, live and through its JSON file', () => {
    for (const preset of ['story', 'adventurer', 'veteran'] as const) {
      const replay = record(preset);
      expect(record(preset)).toEqual(replay);
      const reloaded = parseReplay(JSON.parse(serializeReplay(replay)));
      expect(playReplay(reloaded, scenario)).toMatchObject({ status: 'passed' });
    }
  });

  it('a replay recorded on Story diverges when played back as if on Adventurer', () => {
    const story = record('story');
    const adventurer = record('adventurer');
    const outcome = playReplay({ ...adventurer, checkpoints: story.checkpoints }, scenario);
    expect(outcome.status).toBe('diverged');
  });
});
