// The status content type (mw-e06.9): buffs, debuffs and conditions are data, so a spell like Grasping
// Vines or Levitate is composed ("apply rooted for 6 s") rather than coded. One file per status at
// `src/content/data/status/<id>.json`; the field reference in docs/content/status-schema.md is
// generated (`pnpm content:docs`). A spell's `status` op references an entry here, and its duration
// comes from the spell, not the status: a status says how it behaves, a spell says for how long.
//
// A status has:
//   - a stack rule: `refresh` (reapplying restarts the clock, one stack), `stack` (each application
//     adds a stack up to `max` and restarts the clock) or `keep` (the first application stands);
//   - tags for dispel (`magical`, `curse`, `mundane`…): a dispel names a tag, never a status;
//   - stat modifiers (`add` or `multiply`, scaled by stacks) the movement, casting and damage rules read;
//   - tick ops: damage applied every `interval` seconds while it lasts (burning);
//   - break conditions: property tests on its source or its target that end it early. These are
//     property-driven, never pairwise: "rooted breaks once the thing restraining you is burning", not
//     "vines break on fire". `sourceBound` ends the status in the tick its source entity is gone.

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId } from '../schema.ts';
import { damageTemplateSchema } from './move.ts';
import { propertyKey } from './spell.ts';

/** Stat names a status modifier may change (read by the movement, casting and damage rules). */
export const STATUS_MODIFIER_STATS = [
  'moveSpeed',
  'castSpeed',
  'gravityScale',
  'damageDealt',
  'damageTaken',
  'visibility',
] as const;
export type StatusModifierStat = (typeof STATUS_MODIFIER_STATS)[number];

export const STATUS_STACK_RULES = ['refresh', 'stack', 'keep'] as const;
export type StatusStackRule = (typeof STATUS_STACK_RULES)[number];

export const STATUS_BREAK_COMPARISONS = ['eq', 'ne', 'gte', 'lte'] as const;

/** Most stacks a `stack` rule may allow. */
export const MAX_STATUS_STACK_CAP = 99;

const breakWhen = z
  .strictObject({
    entity: z.enum(['source', 'target']).describe('Whose property is tested.'),
    property: propertyKey.describe('World property read from that entity (e.g. "burning").'),
    is: z.enum(STATUS_BREAK_COMPARISONS).describe('How it is compared: eq, ne, gte or lte.'),
    value: z
      .union([z.boolean(), z.number(), z.string()])
      .describe('Value compared against; the status ends when the test holds.'),
  })
  .describe('Ends the status when the property test holds (gte and lte need a number).');

/** Schema of one status file, `src/content/data/status/<id>.json`. */
export const statusSchema = z
  .strictObject({
    id: contentId.describe('Unique status id (a spell’s status op names it).'),
    name: z.string().min(1).describe('Player-facing name.'),
    description: z.string().min(1).describe('Player-facing one-line description.'),
    stack: z
      .strictObject({
        rule: z.enum(STATUS_STACK_RULES).describe('refresh, stack or keep.'),
        max: z
          .int()
          .min(2)
          .max(MAX_STATUS_STACK_CAP)
          .optional()
          .describe('Most stacks; required for (and only for) rule "stack".'),
      })
      .describe('What reapplying the status does.'),
    tags: z.array(contentId).default([]).describe('Dispel tags: "magical", "curse", "mundane"…'),
    modifiers: z
      .array(
        z.strictObject({
          stat: z.enum(STATUS_MODIFIER_STATS).describe('Stat changed.'),
          mode: z.enum(['add', 'multiply']).describe('Added, or multiplied, per stack.'),
          value: z.number().describe('Amount per stack (multiply: 0.5 halves it, 0 stops it).'),
        }),
      )
      .default([])
      .describe('Stat modifiers while the status lasts.'),
    tick: z
      .strictObject({
        interval: z.number().positive().max(60).describe('Seconds between ticks.'),
        ops: z
          .array(damageTemplateSchema.extend({ op: z.literal('damage') }))
          .min(1)
          .describe('Damage dealt to the target each tick (instigator: the status source).'),
      })
      .optional()
      .describe('Ops applied to the target every `interval` seconds while the status lasts.'),
    sourceBound: z
      .boolean()
      .default(false)
      .describe('Ends in the tick its source entity is destroyed (vines, a tether, an aura).'),
    breakWhen: z
      .array(breakWhen)
      .default([])
      .describe('Property tests that end the status early; any one holding ends it.'),
  })
  .superRefine((def, ctx) => {
    const { rule, max } = def.stack;
    if (rule === 'stack' && max === undefined) {
      ctx.addIssue({ code: 'custom', path: ['stack', 'max'], message: 'rule "stack" needs a max' });
    }
    if (rule !== 'stack' && max !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['stack', 'max'],
        message: `rule "${rule}" takes no max`,
      });
    }
    def.breakWhen.forEach((test, i) => {
      if ((test.is === 'gte' || test.is === 'lte') && typeof test.value !== 'number') {
        ctx.addIssue({
          code: 'custom',
          path: ['breakWhen', i, 'value'],
          message: `"${test.is}" compares numbers`,
        });
      }
    });
  });

export type StatusDefInput = z.input<typeof statusSchema>;
export type StatusDef = z.output<typeof statusSchema>;
export type StatusEntry = Frozen<StatusDef>;
