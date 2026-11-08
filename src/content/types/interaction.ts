// Interaction affordances as data (mw-e02.5): what the Interact verb can do to a placed object. It
// mirrors the sim's InteractableSpec (src/sim/interaction/affordance.ts), which content may only
// import as types: the verb list is a Record over the sim's AffordanceVerb, so adding a verb in the
// sim fails to compile here until data can name it, and the parsed output is assignable to the
// sim's spec (checked by interaction.test.ts). Embedded by scene spawns (`interact`).

import { z } from 'zod';
import type { AffordanceVerb } from '../../sim/interaction/affordance.ts';
import { contentId } from '../schema.ts';

/** One entry per sim verb (a missing or extra key fails to compile). */
const VERBS: Readonly<Record<AffordanceVerb, true>> = {
  use: true,
  open: true,
  close: true,
  pull: true,
  press: true,
  'pick-up': true,
  read: true,
  search: true,
  hide: true,
  climb: true,
  talk: true,
  push: true,
  release: true,
  rotate: true,
  unlock: true,
  'pick-lock': true,
  light: true,
  extinguish: true,
};

/** Every verb data may use. */
export const AFFORDANCE_VERB_IDS = Object.keys(VERBS) as [AffordanceVerb, ...AffordanceVerb[]];

/** Longest hold, seconds (the sim's MAX_HOLD_SECONDS). */
const MAX_HOLD = 10;

const requirementSchema = z.union([
  z.strictObject({ capability: contentId.describe('Capability the actor needs (class, skill).') }),
  z.strictObject({ item: contentId.describe('Item id the actor must carry (a key).') }),
]);

export const affordanceSchema = z.strictObject({
  verb: z.enum(AFFORDANCE_VERB_IDS).describe('What Interact does.'),
  label: z.string().min(1).optional().describe('Prompt text; defaults to the verb (e.g. "Pull").'),
  hold: z
    .number()
    .min(0)
    .max(MAX_HOLD)
    .optional()
    .describe('Seconds Interact must be held; 0 or omitted fires on press.'),
  requires: z
    .array(requirementSchema)
    .optional()
    .describe('Every one must hold for the actor to use it (else shown greyed with the reason).'),
  reason: z
    .string()
    .min(1)
    .optional()
    .describe('Shown while unavailable, e.g. "Locked — needs Iron Key".'),
});

export const interactableSchema = z.strictObject({
  affordances: z
    .array(affordanceSchema)
    .min(1)
    .describe('In priority order: Interact uses the first one the actor can.'),
  range: z.number().positive().optional().describe('Reach in metres; defaults to 2.5.'),
  anchor: z
    .tuple([z.number(), z.number(), z.number()])
    .optional()
    .describe('Focus point relative to the entity, metres; defaults to [0, 1, 0].'),
  radius: z.number().min(0).optional().describe('Bounding radius of the focus point, metres.'),
});

export type InteractableDef = z.output<typeof interactableSchema>;
