// Persuasion tuning (mw-e22.7): the numbers behind a dialogue `check` node, one file at
// `src/content/data/persuasion/persuasion.json`. A check's score is deterministic, with no hidden
// dice: `base` + the NPC's disposition band modifier + every global `modifiers` entry whose
// condition holds for the approach + the node's own `modifiers` + the NPC's personality modifiers.
// The check succeeds when score >= the node's difficulty. The margin (score minus difficulty) is
// also what the UI shows as an odds label: easy from `labels.easyFrom`, fair from `fairFrom`, hard
// from `hardFrom`, else impossible. The sim (src/sim/dialogue/persuasion.ts) evaluates this data;
// content may import the sim only as types, so the shape here is mirrored there structurally
// (tests/contracts/persuasion.test.ts keeps them equal). Conditions and the logic DSL inside
// `modifiers` are validated by `validatePersuasionRules` in the sim.
//
// The field reference in docs/content/persuasion-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { DIALOGUE_APPROACHES } from './dialogue.ts';
import { PERSONALITY_TRAITS } from './creature.ts';

/** The id (and file name) of the one persuasion table. */
export const PERSUASION_ID = 'persuasion';

/** NPC disposition bands, coldest to warmest (mirrors the sim's NPC_BANDS). */
export const PERSUASION_BANDS = ['hostile', 'cold', 'neutral', 'friendly', 'devoted'] as const;

const bonus = z.int().min(-50).max(50);
const label = z.string().min(1).describe('Why, in the words shown to the player.');
const approaches = z
  .array(z.enum(DIALOGUE_APPROACHES))
  .min(1)
  .optional()
  .describe('The approaches it applies to. Omit: every approach.');

const logicNode = z
  .looseObject({ kind: z.string().min(1).describe('The logic kind, e.g. "playerClass".') })
  .describe('A logic DSL condition: an object with a `kind` and that kind’s fields.');

/** Schema of the persuasion table, `src/content/data/persuasion/persuasion.json`. */
export const persuasionSchema = z
  .strictObject({
    id: z.literal(PERSUASION_ID).describe('Always "persuasion": there is one table.'),
    notes: z.string().min(1).describe('Where the numbers come from (bead, tuning status).'),
    base: bonus.describe('Score every check starts from.'),
    bandModifiers: z
      .strictObject(
        Object.fromEntries(
          PERSUASION_BANDS.map((band) => [
            band,
            bonus.describe(`Added when the NPC's disposition band is ${band}.`),
          ]),
        ) as Record<(typeof PERSUASION_BANDS)[number], typeof bonus>,
      )
      .describe(
        'Score change per NPC disposition band (hostile, cold, neutral, friendly, devoted).',
      ),
    labels: z
      .strictObject({
        easyFrom: z.int().describe('Margin (score minus difficulty) from which a check is easy.'),
        fairFrom: z.int().describe('Margin from which a check is fair.'),
        hardFrom: z.int().describe('Margin from which a check is hard; below it, impossible.'),
      })
      .refine((l) => l.easyFrom > l.fairFrom && l.fairFrom > l.hardFrom, {
        message: 'thresholds must descend: easyFrom > fairFrom > hardFrom',
      })
      .describe('Difficulty labels the UI shows, by margin.'),
    modifiers: z
      .array(
        z.strictObject({
          approaches,
          when: logicNode,
          bonus: bonus.refine((n) => n !== 0, 'must not be zero'),
          label,
        }),
      )
      .default([])
      .describe('Class, capability, item or fact modifiers that apply to every check.'),
    personality: z
      .array(
        z
          .strictObject({
            approaches,
            trait: z.enum(PERSONALITY_TRAITS).describe('A creature personality trait (0–1).'),
            atLeast: z.number().min(0).max(1).optional().describe('Applies at or above this.'),
            atMost: z.number().min(0).max(1).optional().describe('Applies at or below this.'),
            bonus: bonus.refine((n) => n !== 0, 'must not be zero'),
            label,
          })
          .refine((p) => p.atLeast !== undefined || p.atMost !== undefined, {
            message: 'give `atLeast` or `atMost`',
          }),
      )
      .default([])
      .describe('Modifiers from the NPC’s personality, matched on its creature definition.'),
  })
  .describe('Persuasion tuning.');

/** The persuasion table as written in JSON. */
export type PersuasionDefInput = z.input<typeof persuasionSchema>;
/** A validated persuasion table. */
export type PersuasionDef = z.output<typeof persuasionSchema>;
/** A loaded (deeply frozen) persuasion table. */
export type PersuasionEntry = Frozen<PersuasionDef>;
