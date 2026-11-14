// Puzzles as data (mw-e15.1): `src/content/data/puzzle/<id>.json`. A puzzle is an outcome in a level,
// not a script: it names the scene it lives in and the entities that matter, a goal condition that is
// true when the puzzle is solved (any way of making it true counts), and the solutions the designer
// intends, each as the capabilities it needs and an abstract step list for the solver (mw-e15.6).
// Steps describe what happens to the world (heat reaches the brazier, the crate ends up on the
// plate), never which trigger fires, so solutions stay systemic. Around that: the reset and recovery
// policy (mw-e15.7), a hint ladder (mw-e15.11), tags (`mvp`, class focus) and the facts it writes
// when solved (mw-e15.3 runs it): how it is found (`discovery`: a volume in world coordinates or a
// trigger entity), the lever and button signals it drives and its reward hooks.
//
// The goal is the shared condition language (docs/design/conditions.md), registered in
// CONDITION_USAGES; its live leaves (entity property predicates, signals, volumes, sustained holds,
// mw-e15.2) are valid here unchanged. This schema checks what one file can: ids unique, every step,
// highlight and recovery names a listed entity, a step's capability is one its solution declares,
// and an `mvp` puzzle declares at least two solutions. The load check (src/content/puzzle-checks.ts)
// checks the rest against other content: listed entities are spawns of the scene, capabilities are
// declared, and output facts are declared and typed. Guide: docs/design/puzzles.md.

import { z } from 'zod';
import { contentId, ref } from '../schema.ts';
import { capabilityId } from './capability.ts';
import { conditionSchema, SIGNAL_REF } from './condition.ts';
import { FACT_KEY_PATTERN } from './fact.ts';
import { AFFORDANCE_VERB_IDS } from './interaction.ts';
import { volumeShapeSchema } from './signal-graph.ts';
import { SPELL_STIMULUS_ELEMENTS } from './spell.ts';

/** The four classes (CONSTITUTION §1), for a puzzle's class focus. */
export const PUZZLE_CLASSES = ['knight', 'archer', 'sorcerer', 'thief'] as const;

/** The tag that marks a puzzle as part of the MVP; such a puzzle declares at least this many solutions. */
export const MVP_TAG = 'mvp';
export const MVP_MIN_SOLUTIONS = 2;

/** A step's `move.target` may be the player (standing on a plate) instead of a listed entity. */
export const PUZZLE_PLAYER = 'player';

const entity = contentId.describe('Id of an entity listed in `entities`.');
const note = z.string().min(1).optional().describe('What the step means, for designers.');
const using = capabilityId
  .optional()
  .describe('Capability the step uses; one of the solution’s `capabilities`. Omit: anyone can.');

const factKey = z.string().regex(FACT_KEY_PATTERN, 'must be a fact key');
const factValue = z
  .union([z.boolean(), z.int(), z.string().min(1)])
  .describe(
    'A bool, a whole number or a string (enum value or content id), fitting the fact type.',
  );

const puzzleEntitySchema = z.strictObject({
  id: contentId.describe('Id of a spawn in the puzzle’s scene.'),
  role: z.string().min(1).describe('What the entity is to the puzzle, e.g. "brazier to be lit".'),
  critical: z
    .boolean()
    .default(false)
    .describe('The puzzle needs it: losing it could softlock the puzzle (see `policy.recovery`).'),
});

/** One abstract step of a solution: what happens to the world, not which trigger fires. */
const stepSchema = z
  .discriminatedUnion('do', [
    z
      .strictObject({
        do: z.literal('stimulus').describe('Step kind: a stimulus reaches the target.'),
        element: z.enum(SPELL_STIMULUS_ELEMENTS).describe('Stimulus element that reaches it.'),
        target: entity,
        using,
        note,
      })
      .describe('A stimulus reaches the target (heat lights the brazier, cold freezes the water).'),
    z
      .strictObject({
        do: z.literal('move').describe('Step kind: the target ends up at another entity.'),
        target: z
          .union([contentId, z.literal(PUZZLE_PLAYER)])
          .describe('Id of the listed entity that moves, or "player".'),
        to: entity.describe('Id of the listed entity it ends up on or at (a plate, a ledge).'),
        using,
        note,
      })
      .describe('The target ends up at another entity (pushed, carried, levitated, floated).'),
    z
      .strictObject({
        do: z.literal('interact').describe('Step kind: the player uses an affordance.'),
        verb: z.enum(AFFORDANCE_VERB_IDS).describe('Affordance verb used on it, e.g. "pull".'),
        target: entity,
        using,
        note,
      })
      .describe('The player uses one of the target’s affordances (pull a lever, pick a lock).'),
    z
      .strictObject({
        do: z.literal('reach').describe('Step kind: the player gets to the target.'),
        target: entity,
        using,
        note,
      })
      .describe('The player gets to the target (climbs, blinks, swims, crosses).'),
    z
      .strictObject({
        do: z.literal('wait').describe('Step kind: time passes.'),
        seconds: z.number().positive().describe('Seconds to wait (water freezes, a timer runs).'),
        note,
      })
      .describe('Time passes.'),
  ])
  .describe('One step: stimulus, move, interact, reach or wait.');

const solutionSchema = z.strictObject({
  id: contentId.describe('Solution id, unique in the puzzle (telemetry and solver reports).'),
  name: z.string().min(1).describe('Short name, e.g. "Burn the rope".'),
  capabilities: z
    .array(capabilityId)
    .default([])
    .describe('Capabilities the solution needs, all of them; empty = anyone can.'),
  steps: z
    .array(stepSchema)
    .min(1)
    .describe('Abstract steps, in order, for the solver and replays to follow.'),
  notes: z.string().min(1).optional().describe('Anything a designer or tester should know.'),
});

const hintTierSchema = z
  .strictObject({
    afterSeconds: z
      .number()
      .positive()
      .describe('Seconds in progress before the tier fires; tiers are in increasing order.'),
    afterAttempts: z
      .int()
      .min(1)
      .optional()
      .describe('Failed attempts that fire the tier sooner, whichever comes first.'),
    bark: z.string().min(1).optional().describe('What the player character mutters.'),
    highlight: z
      .array(entity)
      .min(1)
      .optional()
      .describe('Listed entities that glint or pulse to draw the eye.'),
    rumour: factKey
      .optional()
      .describe(
        'Declared bool fact set true when the tier fires: an NPC rumour (dialogue conditions read it) is unlocked.',
      ),
    variants: z
      .array(
        z.strictObject({
          capability: capabilityId.describe('Used when the player has this capability.'),
          bark: z.string().min(1).describe('The bark for a player with that capability.'),
        }),
      )
      .default([])
      .describe('Class-aware barks: the first whose capability the player has replaces `bark`.'),
  })
  .refine(
    (tier) => tier.bark !== undefined || tier.highlight !== undefined || tier.rumour !== undefined,
    { message: 'a hint tier needs a bark, a highlight or a rumour' },
  );

const recoverySchema = z
  .discriminatedUnion('kind', [
    z
      .strictObject({
        kind: z.literal('respawn').describe('Policy kind: a lost critical entity reappears.'),
        entity: entity.describe('Id of the listed critical entity that is replaced.'),
        seconds: z
          .number()
          .positive()
          .describe('Seconds after it is lost (destroyed or burnt out) that a new one appears.'),
      })
      .describe(
        'A lost critical entity reappears where it spawned (a crate chute), once the spot is clear; a spot that is taken is tried again every 2 s.',
      ),
    z
      .strictObject({
        kind: z.literal('reset').describe('Policy kind: a trigger resets the mechanisms.'),
        trigger: entity.describe('Id of the listed entity that resets the puzzle (a lever).'),
        fact: factKey
          .optional()
          .describe('Declared int fact counted up by each reset (telemetry, quests, hints).'),
      })
      .describe(
        'Using the trigger returns the listed doors and switches to their authored state and the puzzle to in-progress (a solved puzzle ignores it).',
      ),
  ])
  .describe('How the puzzle recovers when a key object is lost or a mechanism is stuck.');

export const puzzleSchema = z
  .strictObject({
    id: contentId.describe('Puzzle id, e.g. "sunbeam-chapel". Stable once shipped (saves).'),
    name: z.string().min(1).describe('Display name (docs, debug tools and telemetry).'),
    notes: z
      .string()
      .min(1)
      .describe('What the puzzle is and where it comes from (level plan, canon section).'),
    scene: ref('scene').describe('The level the puzzle lives in; entities are its spawn ids.'),
    entities: z
      .array(puzzleEntitySchema)
      .min(1)
      .describe('The level entities the puzzle is about; steps, hints and recovery name these.'),
    discovery: z
      .strictObject({
        volume: volumeShapeSchema
          .optional()
          .describe(
            'Walking in finds the puzzle: a box, sphere or capsule in world coordinates (the scene’s own, unlike a signal graph’s, which is placed relative to an origin).',
          ),
        interact: contentId
          .optional()
          .describe('Id of a listed entity; using it finds the puzzle (a plaque, a lever).'),
      })
      .optional()
      .describe(
        'How the puzzle is found. Without it, the first thing the player does to a listed entity finds it.',
      ),
    goal: conditionSchema.describe(
      'True when the puzzle is solved, whatever made it so (docs/design/conditions.md).',
    ),
    solutions: z
      .array(solutionSchema)
      .min(1)
      .describe('Intended solutions; the goal may also come true by a route nobody declared.'),
    policy: z
      .strictObject({
        repeatable: z
          .boolean()
          .default(false)
          .describe('false: once solved it stays solved; true: it unsolves when the goal fails.'),
        recovery: z
          .array(recoverySchema)
          .default([])
          .describe('Diegetic recovery from lost objects and stuck mechanisms.'),
      })
      .default({ repeatable: false, recovery: [] })
      .describe('What happens after solving, and how the puzzle recovers.'),
    hints: z
      .array(hintTierSchema)
      .default([])
      .describe(
        'The hint ladder: tiers fire in order while the player is stuck (seconds since the puzzle was found, or failed attempts). Defaults: tier 1 at 180 s or 3 attempts, tier 2 at 360 s, tier 3 at 600 s.',
      ),
    failures: z
      .array(
        z.strictObject({
          signal: z
            .string()
            .regex(SIGNAL_REF, 'must be "<graph>/<node>"')
            .describe('Signal graph id and node id, e.g. "chimes/order".'),
          port: contentId.optional().describe('Output port of the node; default: its first.'),
        }),
      )
      .default([])
      .describe(
        'Signal outputs whose pulses are failed attempts (a sequence node’s `failed` port): each rising edge counts one towards a tier’s `afterAttempts`.',
      ),
    tags: z
      .array(contentId)
      .default([])
      .describe(`Free-form tags; "${MVP_TAG}" requires ${String(MVP_MIN_SOLUTIONS)}+ solutions.`),
    focus: z
      .array(z.enum(PUZZLE_CLASSES))
      .default([])
      .describe('Classes the puzzle is meant to showcase; empty = none in particular.'),
    outputs: z
      .strictObject({
        solvedFact: factKey.describe('Declared bool fact set true when the puzzle is solved.'),
        set: z
          .array(
            z.strictObject({
              fact: factKey.describe('Declared fact the puzzle writes when solved.'),
              value: factValue,
            }),
          )
          .default([])
          .describe('Further facts written when solved (doors, rewards and quests read these).'),
        signals: z
          .array(z.string().regex(SIGNAL_REF, 'must be "<graph>/<node>"'))
          .default([])
          .describe(
            'Lever nodes switched on, or button nodes pressed, when solved, as "<graph>/<node>"; a graph the scene places wires them to doors and lights. A repeatable puzzle switches levers back off when it reopens.',
          ),
        rewards: z
          .array(contentId)
          .default([])
          .describe(
            'Reward hook ids announced once, the first time the puzzle is solved (the reward systems listen for them).',
          ),
      })
      .describe('Facts written when the puzzle is solved.'),
  })
  .superRefine((puzzle, ctx) => {
    const issue = (path: (string | number)[], message: string) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    const listed = new Set<string>();
    puzzle.entities.forEach(({ id }, i) => {
      if (listed.has(id)) issue(['entities', i, 'id'], `entity "${id}" is listed twice`);
      listed.add(id);
    });
    const needListed = (path: (string | number)[], id: string) => {
      if (!listed.has(id)) issue(path, `"${id}" is not one of the puzzle's entities`);
    };

    const solutionIds = new Set<string>();
    puzzle.solutions.forEach((solution, s) => {
      const at = ['solutions', s];
      if (solutionIds.has(solution.id)) issue([...at, 'id'], `solution "${solution.id}" twice`);
      solutionIds.add(solution.id);
      solution.steps.forEach((step, i) => {
        const path = [...at, 'steps', i];
        if (step.do === 'wait') return;
        if (step.do !== 'move' || step.target !== PUZZLE_PLAYER) {
          needListed([...path, 'target'], step.target);
        }
        if (step.do === 'move') needListed([...path, 'to'], step.to);
        if (step.using !== undefined && !solution.capabilities.includes(step.using)) {
          issue(
            [...path, 'using'],
            `"${step.using}" is not one of solution "${solution.id}"'s capabilities`,
          );
        }
      });
    });
    const { discovery } = puzzle;
    if (discovery !== undefined) {
      if (discovery.volume === undefined && discovery.interact === undefined) {
        issue(['discovery'], 'needs a volume or an interact trigger');
      }
      if (discovery.interact !== undefined) {
        needListed(['discovery', 'interact'], discovery.interact);
      }
    }
    const tagged = puzzle.tags.includes(MVP_TAG);
    if (tagged && puzzle.solutions.length < MVP_MIN_SOLUTIONS) {
      issue(
        ['solutions'],
        `an ${MVP_TAG} puzzle needs at least ${String(MVP_MIN_SOLUTIONS)} declared solutions; it has ${String(puzzle.solutions.length)}`,
      );
    }

    puzzle.hints.forEach((tier, t) => {
      tier.highlight?.forEach((id, i) => {
        needListed(['hints', t, 'highlight', i], id);
      });
      const before = puzzle.hints[t - 1];
      if (before !== undefined && tier.afterSeconds <= before.afterSeconds) {
        issue(['hints', t, 'afterSeconds'], 'must be later than the tier before');
      }
    });

    puzzle.policy.recovery.forEach((policy, i) => {
      const path = ['policy', 'recovery', i];
      if (policy.kind === 'reset') {
        needListed([...path, 'trigger'], policy.trigger);
        return;
      }
      const target = puzzle.entities.find(({ id }) => id === policy.entity);
      if (target === undefined) needListed([...path, 'entity'], policy.entity);
      else if (!target.critical) {
        issue([...path, 'entity'], `"${policy.entity}" is respawned, so mark it critical`);
      }
    });
  });

/** A puzzle as written in JSON (defaulted fields may be omitted). */
export type PuzzleInput = z.input<typeof puzzleSchema>;
/** A validated puzzle. */
export type Puzzle = z.output<typeof puzzleSchema>;
/** One abstract solution step. */
export type PuzzleStep = z.output<typeof stepSchema>;
