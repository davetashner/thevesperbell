// The acoustic surface table (mw-e09.4): how loud each footstep surface is, one file per table at
// `src/content/data/surface-table/<id>.json` (the game has one, `surfaces`). It has one row for every
// footstep surface of the audio bible §7.3 (FOOTSTEP_SURFACES in material.ts) and no others, so the
// sim's surfaces and the sound sets cannot drift apart. A row gives the surface's loudness offset in
// dB relative to stone (the 0 dB reference), the step-to-step variance, the sound set id the audio
// layer plays (`sfx-foot-<surface>`), and optionally a creak: a seeded chance per step of an extra
// loud board. Scenes tag boxes with a surface (`surfaces` in the scene) and `surfaceAt`
// (src/sim/surfaces) answers what a position is; wet and frozen modifiers are the controller profile's
// `stealth.surfaces`. The field reference in docs/content/surface-table-schema.md is generated
// (`pnpm content:docs`).

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId } from '../schema.ts';
import { FOOTSTEP_LOUDNESS_RANGE, FOOTSTEP_SURFACES, type FootstepSurface } from './material.ts';

/** The game's surface table (`src/content/data/surface-table/surfaces.json`). */
export const SURFACE_TABLE_ID = 'surfaces';

/** The surface a position with no tag reads (stone is the 0 dB reference). */
export const DEFAULT_SURFACE: FootstepSurface = 'stone';

/** Footstep sound set ids: `sfx-foot-<surface>` (audio bible §7.3); variants are picked at runtime. */
export const FOOTSTEP_SOUND_PATTERN = /^sfx-foot-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The most a surface's per-step variance may be, dB. */
export const MAX_SURFACE_VARIANCE_DB = 6;

const creakSchema = z
  .strictObject({
    chance: z.number().gt(0).max(1).describe('Probability per step of a creak, 0–1 (seeded).'),
    db: z
      .number()
      .gt(0)
      .max(FOOTSTEP_LOUDNESS_RANGE.max)
      .describe('Extra loudness of a creaking step, dB.'),
  })
  .describe('A board that sometimes betrays the step: a seeded chance of an extra loud step.');

const surfaceRowSchema = z.strictObject({
  id: z.enum(FOOTSTEP_SURFACES).describe('Footstep surface id (audio bible §7.3).'),
  offsetDb: z
    .number()
    .min(FOOTSTEP_LOUDNESS_RANGE.min)
    .max(FOOTSTEP_LOUDNESS_RANGE.max)
    .describe('Loudness offset relative to stone, dB, −20 to +20.'),
  varianceDb: z
    .number()
    .min(0)
    .max(MAX_SURFACE_VARIANCE_DB)
    .describe('Step-to-step spread of the loudness, dB (± this much, seeded), 0–6.'),
  sfx: z
    .string()
    .regex(FOOTSTEP_SOUND_PATTERN, 'must be a footstep sound set id, e.g. "sfx-foot-carpet"')
    .describe('Sound set id the audio layer plays for this surface, e.g. "sfx-foot-carpet".'),
  creak: creakSchema.optional(),
});

/** Schema of one surface table file, `src/content/data/surface-table/<id>.json`. */
export const surfaceTableSchema = z
  .strictObject({
    id: contentId.describe('Unique table id; the game reads "surfaces".'),
    notes: z.string().min(1).describe('Where the numbers come from (bead, tuning status).'),
    surfaces: z
      .array(surfaceRowSchema)
      .min(1)
      .describe('One row per footstep surface of the audio bible §7.3: all of them, each once.'),
  })
  .superRefine((table, ctx) => {
    const seen = new Set<string>();
    table.surfaces.forEach((row, i) => {
      if (seen.has(row.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['surfaces', i, 'id'],
          message: `surface "${row.id}" is listed twice`,
        });
      }
      seen.add(row.id);
    });
    for (const id of FOOTSTEP_SURFACES) {
      if (seen.has(id)) continue;
      ctx.addIssue({
        code: 'custom',
        path: ['surfaces'],
        message: `surface "${id}" (audio bible §7.3) has no row`,
      });
    }
  });

/** A surface table as written in JSON. */
export type SurfaceTableDefInput = z.input<typeof surfaceTableSchema>;
/** A validated surface table. */
export type SurfaceTableDef = z.output<typeof surfaceTableSchema>;
/** A loaded (deeply frozen) surface table. */
export type SurfaceTableEntry = Frozen<SurfaceTableDef>;

/** One surface as the sim reads it. */
export interface AcousticSurface {
  readonly id: string;
  readonly offsetDb: number;
  readonly varianceDb: number;
  readonly sfx: string;
  readonly creak?: { readonly chance: number; readonly db: number } | undefined;
}

/** Surface id → its acoustics, as the sim's `surfaceAt` reads them (frozen). */
export function compileSurfaceTable(
  table: Frozen<Pick<SurfaceTableDef, 'surfaces'>>,
): ReadonlyMap<string, AcousticSurface> {
  return new Map(
    table.surfaces.map((row) => [
      row.id,
      Object.freeze({
        id: row.id,
        offsetDb: row.offsetDb,
        varianceDb: row.varianceDb,
        sfx: row.sfx,
        ...(row.creak !== undefined && { creak: Object.freeze({ ...row.creak }) }),
      }),
    ]),
  );
}
