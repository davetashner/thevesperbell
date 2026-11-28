// Rest points (mw-e27.13): the kinds of place the player can rest at, one file per kind in
// `src/content/data/rest-point/`. Resting is a shared verb: it passes game time, restores the player
// and tells the world (`rest.completed`), whichever kind of place it happens at. What differs per kind
// is data: whether a fire must burn there (a campfire; "burning" is the fire property, nothing here
// names a campfire), the restoration table, which durations the menu offers and what can break a
// rest off. Scenes place a kind with a spawn's `restPoint` (src/content/types/scene.ts). The sim's
// rules are src/sim/rest.

import { z } from 'zod';
import { contentId } from '../schema.ts';

/** Most hours a rest may last. */
export const MAX_REST_HOURS = 24;

const durationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('dawn') }),
  z.strictObject({ kind: z.literal('dusk') }),
  z.strictObject({
    kind: z.literal('hours'),
    hours: z.int().min(1).max(MAX_REST_HOURS).describe('Whole hours.'),
  }),
]);

const interruptSchema = z.strictObject({
  id: contentId.describe('Names the interruption; the `rest.interrupted` event carries it.'),
  chancePerHour: z
    .number()
    .min(0)
    .max(1)
    .describe('Chance, rolled on the seeded `rest` stream once per game hour of the rest.'),
  message: z.string().min(1).describe('What the player is told when it happens.'),
});

export const restPointSchema = z
  .strictObject({
    id: contentId.describe('The kind of rest point, e.g. `campfire`.'),
    name: z.string().min(1).describe('Shown on the rest menu.'),
    needsFire: z
      .boolean()
      .default(false)
      .describe('Rest is refused unless the point is burning (the `burning` world property).'),
    fullRestHours: z
      .number()
      .positive()
      .max(MAX_REST_HOURS)
      .default(8)
      .describe(
        'A rest this long gives the whole `restores` table; a shorter one a pro-rata share.',
      ),
    restores: z
      .strictObject({
        health: z.number().min(0).max(1).default(1),
        stamina: z.number().min(0).max(1).default(1),
        mana: z.number().min(0).max(1).default(1),
      })
      .default({ health: 1, stamina: 1, mana: 1 })
      .describe('Fraction of each pool’s maximum a full rest restores.'),
    durations: z
      .array(durationSchema)
      .min(1)
      .describe('The durations the menu offers: until dawn, until dusk or a number of hours.'),
    interrupts: z
      .array(interruptSchema)
      .default([])
      .describe('What can break a rest off early, rolled by chance per hour.'),
  })
  .superRefine((entry, ctx) => {
    const seen = new Set<string>();
    entry.interrupts.forEach((interrupt, i) => {
      if (seen.has(interrupt.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['interrupts', i, 'id'],
          message: `duplicate interrupt id "${interrupt.id}"`,
        });
      }
      seen.add(interrupt.id);
    });
  });

export type RestPointDef = z.output<typeof restPointSchema>;
export type RestDurationDef = RestPointDef['durations'][number];
