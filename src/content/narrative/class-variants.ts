// The class-variant convention for narrative content (mw-e39.3, docs/narrative/content-conventions.md).
// Dialogue needs none of this: a class-gated entry or option is a `playerClass` condition (docs/design/
// dialogue-format.md). Every other kind of narrative text (rumours, books, descriptions, journal and
// arrival text) that varies by class carries a `variants` map keyed by these values, with the
// unconditioned base text as the fallback, so one lookup rule serves them all.

import { z } from 'zod';

/** The playable classes, which must equal the ids under src/content/data/class (checked by a test). */
export const NARRATIVE_CLASSES = ['knight', 'archer', 'sorcerer', 'thief'] as const;
export type NarrativeClass = (typeof NARRATIVE_CLASSES)[number];

/** A class-variant key: one class, or `all` for text every class sees. */
export const CLASS_VARIANT_KEYS = [...NARRATIVE_CLASSES, 'all'] as const;
export type ClassVariantKey = (typeof CLASS_VARIANT_KEYS)[number];

/**
 * Schema for a `variants` field: class key to text. An unknown key (a misspelt or invented class,
 * "paladin") fails naming the key, so the file and field are in the load error.
 */
export const classVariantsSchema = z
  .strictObject({
    knight: z.string().min(1).optional(),
    archer: z.string().min(1).optional(),
    sorcerer: z.string().min(1).optional(),
    thief: z.string().min(1).optional(),
    all: z.string().min(1).optional(),
  })
  .refine((variants) => Object.keys(variants).length > 0, 'needs at least one class variant')
  .describe(
    'Text by class (knight, archer, sorcerer, thief) or `all`. A missing class falls back to `all`.',
  );
export type ClassVariants = z.infer<typeof classVariantsSchema>;

/** The text `variants` holds for `playerClass`: its own, else `all`, else undefined. */
export function pickClassVariant(
  variants: ClassVariants,
  playerClass: string | undefined,
): string | undefined {
  const own = NARRATIVE_CLASSES.find((c) => c === playerClass);
  return (own === undefined ? undefined : variants[own]) ?? variants.all;
}

/** The classes `variants` does not cover (no own text and no `all`): the lint's coverage warning. */
export function missingClassVariants(variants: ClassVariants): NarrativeClass[] {
  return variants.all === undefined
    ? NARRATIVE_CLASSES.filter((c) => variants[c] === undefined)
    : [];
}
