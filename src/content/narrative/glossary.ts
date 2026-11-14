// The canon glossary (mw-e39.3): every name, place, creature type, canon number, glossary term and
// in-world text id the narrative lint (mw-e39.24) and the writers check against, each once. It is
// transcribed from docs/narrative/story-bible.md (CANON v1) and glossary.test.ts re-reads the bible
// to prove nothing is missing. It is not a registered content type: nothing in the game loads it
// (no runtime reference, no per-entry harness), so it is a validated JSON module, not content.

import { z } from 'zod';
import raw from './glossary.json';

const slug = '[a-z0-9]+(?:-[a-z0-9]+)*';
const section = z.string().regex(/^\d+(?:\.\d+)?$/, 'a story bible section such as "5.1"');
const name = z
  .string()
  .min(1)
  .refine((v) => v === v.trim(), 'no surrounding whitespace');
const idWith = (prefixes: readonly string[]) =>
  z
    .string()
    .regex(
      new RegExp(`^(?:${prefixes.join('|')})-${slug}$`),
      `must start with ${prefixes.join(' or ')}`,
    );

const character = z.strictObject({
  id: idWith(['npc']),
  name,
  title: z.string().min(1).optional(),
  role: z.string().min(1),
  section,
  tier: z.enum(['principal', 'minor']),
});
const place = z.strictObject({
  id: idWith(['place']),
  name,
  section,
  kind: z.enum([
    'town',
    'building',
    'landmark',
    'wilderness',
    'dungeon',
    'room',
    'route',
    'district',
  ]),
});
const named = (prefixes: readonly string[]) =>
  z.strictObject({ id: idWith(prefixes), name, section });
const canonNumber = z.strictObject({
  id: z.string().regex(new RegExp(`^${slug}$`)),
  quote: z.string().min(1).describe('The bold span in story bible 11.3, verbatim.'),
  label: z.string().min(1),
  value: z.union([z.number(), z.string().min(1)]),
  unit: z.string().min(1).optional(),
  approximate: z.boolean().optional(),
  occurrences: z
    .number()
    .int()
    .min(2)
    .optional()
    .describe('Times the span appears in 11.3, when more than once.'),
});

export const glossarySchema = z
  .strictObject({
    version: z.literal(1),
    source: z.string().min(1),
    characters: z.array(character).min(1),
    places: z.array(place).min(1),
    creatures: z.array(named(['species'])).min(1),
    numbers: z.array(canonNumber).min(1),
    terms: z.array(named(['term'])).min(1),
    texts: z.array(named(['book', 'note', 'inscription'])).min(1),
  })
  .superRefine((glossary, ctx) => {
    const seenIds = new Map<string, string>();
    const sections = ['characters', 'places', 'creatures', 'numbers', 'terms', 'texts'] as const;
    for (const key of sections) {
      const seenNames = new Set<string>();
      glossary[key].forEach((entry, index) => {
        const path = [key, index, 'id'];
        const earlier = seenIds.get(entry.id);
        if (earlier !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `duplicate id "${entry.id}" (also in ${earlier})`,
          });
        }
        seenIds.set(entry.id, key);
        const label = 'name' in entry ? entry.name : undefined;
        if (label !== undefined) {
          const norm = normaliseName(label);
          if (seenNames.has(norm)) {
            ctx.addIssue({
              code: 'custom',
              path: [key, index, 'name'],
              message: `duplicate name "${label}" in ${key}`,
            });
          }
          seenNames.add(norm);
        }
      });
    }
  });
export type Glossary = z.infer<typeof glossarySchema>;

/** A name as compared by the lint and the bible check: lower case, no leading article, no (asides). */
export function normaliseName(value: string): string {
  return value
    .replace(/\([^)]*\)/g, '')
    .replace(/[“”]/g, '"')
    .trim()
    .replace(/^(the|a)\s+/i, '')
    .replace(/[.:,;]+$/, '')
    .trim()
    .toLowerCase();
}

/** The validated glossary; throws a ZodError naming the field of the first problem. */
export function parseGlossary(input: unknown): Glossary {
  return glossarySchema.parse(input);
}

export const glossary: Glossary = parseGlossary(raw);
