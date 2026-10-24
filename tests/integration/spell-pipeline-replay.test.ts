// mw-e06.2 AC-4: a recorded input log casting 50 spells replays to identical state hashes, twice.
// The 50 spells are generated fixtures covering both built-in deliveries and all three built-in ops;
// the log casts one per tick from three casters (learned and free sources both go through the same
// pipeline) at two targets, so damage, stimuli, statuses and their expiry all feed the hash.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  learnSpell,
  SpellCast,
  healthOf,
  playReplay,
  recordScenario,
  type CastCommand,
  type ReplayScenario,
} from '@sim/index';
import { damageOp, makeSpell, spellWorld, statusOp, stimulusOp } from '@sim/magic/testing';

const SPELL_COUNT = 50;
const ELEMENTS = ['heat', 'cold', 'water', 'charge'] as const;

const spells = Array.from({ length: SPELL_COUNT }, (_, i) =>
  makeSpell(`fixture-cast-${String(i)}`, {
    delivery: i % 2 === 0 ? { kind: 'self' } : { kind: 'touch', reach: 3 },
    effects: [
      statusOp(`mark-${String(i % 5)}`, 0.5 + (i % 7) * 0.25, 1 + (i % 3)),
      stimulusOp(ELEMENTS[i % ELEMENTS.length] ?? 'heat', 20 + i, i % 3),
      ...(i % 2 === 1 ? [damageOp({ fire: 1 + (i % 4) })] : []),
    ],
  }),
);

const command = z.object({
  type: z.literal('cast'),
  caster: z.number().int(),
  spell: z.string(),
  target: z.number().int().optional(),
  aim: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
});

const scenario: ReplayScenario<CastCommand> = {
  name: 'spell-pipeline-test',
  usesContent: false,
  command: command as z.ZodType<CastCommand>,
  create: ({ seed }) => {
    const { world, spawn } = spellWorld(spells, seed);
    const casters = [spawn(0), spawn(1), spawn(2)];
    for (const caster of casters) for (const spell of spells) learnSpell(world, caster, spell.id);
    return world;
  },
  drive: () => [],
};

// Entities are 1 (stimulus queue), 2 (status ledger), then the casters at 3, 4, 5.
const script = (tick: number): readonly CastCommand[] =>
  tick < SPELL_COUNT
    ? [
        {
          type: 'cast',
          caster: 3 + (tick % 3),
          spell: `fixture-cast-${String(tick)}`,
          target: 3 + ((tick + 1) % 3),
        },
      ]
    : [];

describe('spell pipeline replay (mw-e06.2)', () => {
  it('AC-4: 50 recorded casts replay twice to identical final and checkpoint hashes', () => {
    const replay = recordScenario(scenario, {
      seed: 11,
      ticks: 700,
      buildSha: 'test',
      contentHash: 'none',
      checkpointInterval: 25,
      inputs: script,
    });
    const casts = replay.inputs.flatMap(([count, commands]) =>
      commands.length > 0 ? [count] : [],
    );
    expect(casts.reduce((a, b) => a + b, 0)).toBe(SPELL_COUNT);
    const first = playReplay(replay, scenario);
    const second = playReplay(replay, scenario);
    expect(first.status).toBe('passed');
    expect(second.status).toBe('passed');
    if (first.status !== 'passed' || second.status !== 'passed') return;
    expect(first.finalHash).toBe(second.finalHash);
    expect(first.finalHash).toBe(replay.finalHash);
    expect(first.checkpoints).toBeGreaterThan(20);
  });

  it('AC-4: the log really casts all 50 spells (the hashes cover real effects, not an idle world)', () => {
    const world = scenario.create({ seed: 11, hz: 60 });
    let cast = 0;
    world.events.on(SpellCast, () => cast++);
    for (let tick = 0; tick < SPELL_COUNT; tick++) world.step(script(tick));
    expect(cast).toBe(SPELL_COUNT);
    expect(healthOf(world, 3)?.current).toBeLessThan(100);
  });
});
