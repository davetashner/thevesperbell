// The disposition-rule content type (mw-e12.9): how one kind of event changes a creature's
// disposition toward the player. The rule's id is the event type (`attacked`, `fed`,
// `witnessed-theft`, `helped-ally`), so a new social event is a new JSON file with no code change:
// anything that emits the sim's `DispositionTrigger` with that type moves the target by `delta`
// (src/sim/disposition). The combat hit on a creature by the player is the one built-in source
// (`attacked`). Disposition runs -100..100; stances and the clamp are the sim's.
//
// The field reference in docs/content/disposition-rule-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import { contentId } from '../schema.ts';

/** Event type the player hitting a creature raises (the one built-in source). */
export const ATTACKED_EVENT = 'attacked';

/** Schema of one rule file, `src/content/data/disposition-rule/<event>.json`. */
export const dispositionRuleSchema = z.strictObject({
  id: contentId.describe(
    'The event type this rule answers, e.g. "attacked", "fed". Unique; stable once shipped.',
  ),
  notes: z.string().min(1).describe('Why this event moves disposition, and by this much.'),
  delta: z
    .int()
    .min(-200)
    .max(200)
    .refine((delta) => delta !== 0, 'a rule that changes nothing is not a rule')
    .describe('Change in disposition when the event happens (−100..100 scale; the result clamps).'),
});

/** A rule as written in JSON. */
export type DispositionRuleDefInput = z.input<typeof dispositionRuleSchema>;
/** A validated rule. */
export type DispositionRuleDef = z.output<typeof dispositionRuleSchema>;
