// The ambience zone content type (mw-e28.13): the soundscape of one place, one file per zone at
// `src/content/data/ambience/<id>.json`. A zone has an optional looping `bed` (cue id in the sound
// manifest, on the ambience bus) and any number of randomised positional `oneShots` (drips, wind
// gusts, distant birds, creaks): each repeats after a random gap between `minIntervalS` and
// `maxIntervalS` and plays at a random point `minRadius`–`maxRadius` metres around the listener.
// Scenes place zones with `ambience` entries (scene.ts): a zone covers a named scene region (a tagged
// box) or, without one, the whole scene. When the listener crosses between zones the beds crossfade
// over AMBIENCE_CROSSFADE_S (src/game/ambience).
//
// Cue ids may name sounds that are not in the manifest yet: the engine skips a missing sound quietly,
// so zones can be authored ahead of their assets (the ambience asset group).
//
// Units: seconds, metres, decibels. The field reference in docs/content/ambience-schema.md is
// generated (`pnpm content:docs`).

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId } from '../schema.ts';

/** Seconds beds take to crossfade when the listener moves between zones (bead mw-e28.13). */
export const AMBIENCE_CROSSFADE_S = 2;

const cueId = z.string().min(1).describe('Cue id in the sound manifest; may be missing for now.');
const gainDb = z
  .number()
  .min(-60)
  .max(12)
  .default(0)
  .describe('Trim in dB on top of the cue and the ambience bus.');

/** One randomised positional sound of a zone. */
export const ambienceOneShotSchema = z
  .strictObject({
    cue: cueId.describe('Positional cue on the ambience bus, e.g. amb-cave-drip.'),
    minIntervalS: z.number().positive().describe('Shortest gap between plays, seconds.'),
    maxIntervalS: z.number().positive().describe('Longest gap between plays, seconds.'),
    minRadius: z.number().nonnegative().describe('Nearest spawn distance from the listener, m.'),
    maxRadius: z.number().positive().describe('Farthest spawn distance from the listener, m.'),
    height: z.number().default(0).describe('Height of the spawn above the listener, m.'),
    gainDb,
  })
  .refine(({ minIntervalS, maxIntervalS }) => maxIntervalS >= minIntervalS, {
    message: 'maxIntervalS must not be below minIntervalS',
    path: ['maxIntervalS'],
  })
  .refine(({ minRadius, maxRadius }) => maxRadius > minRadius, {
    message: 'maxRadius must be above minRadius',
    path: ['maxRadius'],
  });

/** Schema of one ambience zone file, `src/content/data/ambience/<id>.json`. */
export const ambienceSchema = z.strictObject({
  id: contentId.describe('Unique zone id, e.g. slice-gallery.'),
  notes: z.string().min(1).describe('What the zone is for and the state of its assets.'),
  bed: z
    .strictObject({ cue: cueId.describe('Looping non-positional cue.'), gainDb })
    .optional()
    .describe('The looping bed under the zone; crossfades with the next zone’s over 2 s.'),
  oneShots: z
    .array(ambienceOneShotSchema)
    .default([])
    .describe('Randomised positional one-shots around the listener while in the zone.'),
});

/** A zone as written in JSON. */
export type AmbienceDefInput = z.input<typeof ambienceSchema>;
/** A validated zone. */
export type AmbienceDef = z.output<typeof ambienceSchema>;
/** A loaded (deeply frozen) zone. */
export type AmbienceEntry = Frozen<AmbienceDef>;
/** One randomised positional sound of a zone. */
export type AmbienceOneShot = z.output<typeof ambienceOneShotSchema>;
