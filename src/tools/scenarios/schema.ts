// The emergent combo scenario format (mw-e03.27). A scenario is data: a player-facing description, a
// setup in the chaos room (initial world properties on its props; extra props are scene spawns in
// chaos-room.json), scripted stimuli at ticks, and outcomes asserted as readings of world properties
// at given ticks, never as entity types. Its golden is the state hash the replay harness reproduces.

import { z } from 'zod';
import { DEBUG_STIM_ELEMENTS, isWorldPropertyKey } from '@sim/index';

/** Seed and tick rate every scenario runs at (the golden hash depends on both). */
export const SCENARIO_SEED = 1;
export const SCENARIO_HZ = 60;

/** The fewest scenarios the catalogue holds (mw-e03.27 AC-2). */
export const MIN_SCENARIOS = 12;

/** Readings an outcome may take besides a world property: a plate's state, a height, existence. */
export const SPECIAL_READINGS = ['alive', 'plate.active', 'plate.weight', 'position.y'] as const;

/** Comparisons an outcome may make. */
export const OUTCOME_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const;

const spawnId = z.string().regex(/^[a-z][a-z0-9-]*$/);
const point = z.union([spawnId, z.tuple([z.number(), z.number(), z.number()])]);
const value = z.union([z.number(), z.boolean(), z.string()]);
const text = z.string().min(8);
const tick = z.number().int().min(0);

/** A property to set before the first tick (setup) or at a tick (an input). */
const propertySet = z.strictObject({
  target: spawnId,
  property: z.string().refine(isWorldPropertyKey, 'not a world property'),
  value,
});

/** One scripted input: at `tick`, a stimulus, a blast or a property written the way a rule would. */
const input = z.union([
  z.strictObject({
    tick,
    stimulus: z.strictObject({
      element: z.enum(DEBUG_STIM_ELEMENTS),
      at: point,
      radius: z.number().positive().max(10),
      intensity: z.number().positive().max(10_000),
    }),
  }),
  z.strictObject({
    tick,
    blast: z.strictObject({
      at: point,
      radius: z.number().positive().max(20),
      intensity: z.number().positive().max(100_000),
    }),
  }),
  z.strictObject({ tick, set: propertySet }),
]);

/** What an outcome looks at: one scene spawn by id, or every/any spawn carrying a tag. */
const target = z.union([
  z.strictObject({ spawn: spawnId }),
  z.strictObject({ tag: spawnId, which: z.enum(['any', 'all']) }),
]);

/** An outcome: a reading of the target(s) at `tick` (after that many ticks) and what the player sees. */
const outcome = z.strictObject({
  tick,
  target,
  reading: z.union([
    z.enum(SPECIAL_READINGS),
    z.string().refine(isWorldPropertyKey, 'not a world property'),
  ]),
  op: z.enum(OUTCOME_OPS),
  value,
  /** What the player would see if this holds; named in the failure when it does not. */
  sees: text,
});

export const scenarioSchema = z
  .strictObject({
    id: spawnId,
    title: z.string().min(3),
    /** Player-facing: what the player does and what happens. */
    description: z.string().min(20),
    /** Elements and mechanisms in play, for the catalogue's index. */
    tags: z.array(spawnId).min(1),
    scene: z.literal('chaos-room'),
    setup: z.strictObject({
      /** Why the scene is arranged this way (which props and stations the scenario uses). */
      props: text,
      properties: z.array(propertySet),
    }),
    inputs: z.array(input).min(1),
    outcomes: z.array(outcome).min(1),
    /** Ticks simulated; every outcome is read before it. */
    ticks: z.number().int().positive(),
    /** The state hash after `ticks` ticks; `pnpm scenarios:bless` re-records it. Null until recorded. */
    golden: z.strictObject({
      finalHash: z
        .string()
        .regex(/^[0-9a-f]{8}$/)
        .nullable(),
    }),
  })
  .refine((s) => s.outcomes.every((o) => o.tick < s.ticks), 'every outcome tick is before ticks')
  .refine((s) => s.inputs.every((i) => i.tick < s.ticks), 'every input tick is before ticks');

export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioInput = Scenario['inputs'][number];
export type ScenarioOutcome = Scenario['outcomes'][number];
