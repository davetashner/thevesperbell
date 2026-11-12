// Capability ids as content (mw-e15.1): `src/content/data/capability/<group>.json` declares the verbs
// a player can have ("can the player do X?"): spell.mage-hand, arrow.rope, verb.climb.ledge. Puzzle
// solutions (and later obstacles, dialogue and equipment) name capabilities, so a typo'd id must fail
// at load rather than silently make a solution unreachable. mw-e19.2 adds what the UI and the
// progression rules (ADR-0004) need: localisation keys, an icon, the class affinity, whether other
// classes may learn it (`crossClass`) and the `supporting` flag; the runtime per-actor registry with
// source-tracked grants is src/sim/progression/capabilities.ts. Ids are unique across every group
// file (`checkCapabilities`); a capability's id is not a content id, so groups are the entries.

import { z } from 'zod';
import type { ContentCheck, ContentIssue, LoadedEntry } from '../loader.ts';
import { contentId } from '../schema.ts';
import { PLAYER_CLASSES } from './controller.ts';

/** Capability ids: a family, a dot, then kebab-case segments joined by dots (mw-e19.2 AC-4). */
export const CAPABILITY_ID_PATTERN = /^(verb|spell|arrow|tool|trick|technique|sense)\.[a-z0-9.-]+$/;

/** A capability id field, e.g. in a puzzle solution. Checked against the registry at load. */
export const capabilityId = z
  .string()
  .regex(CAPABILITY_ID_PATTERN, 'must be a capability id, e.g. "spell.mage-hand"')
  .describe('Capability id declared in src/content/data/capability/, e.g. "spell.mage-hand".');

/** A localisation key, e.g. "capability.spell.ember.name" (dot- or dash-separated lowercase segments). */
export const localisationKey = z
  .string()
  .regex(
    /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/,
    'must be a localisation key, e.g. "capability.spell.ember.name"',
  );

const capabilityDefSchema = z
  .strictObject({
    id: capabilityId.describe(
      'Capability id: verb., spell., arrow., tool., trick., technique. or sense. then a name.',
    ),
    name: z.string().min(1).describe('Display name, e.g. "Mage Hand".'),
    description: z
      .string()
      .min(1)
      .describe('What the capability lets the player do in the world, for designers and review.'),
    nameKey: localisationKey
      .optional()
      .describe('Localisation key of the display name; absent = "capability.<id>.name".'),
    descKey: localisationKey
      .optional()
      .describe('Localisation key of the description; absent = "capability.<id>.desc".'),
    icon: contentId.optional().describe('UI icon id (hotbar, prompts); absent = the family icon.'),
    classAffinity: z
      .enum(PLAYER_CLASSES)
      .optional()
      .describe('The class whose fantasy it belongs to (ADR-0004); absent = any class.'),
    crossClass: z
      .boolean()
      .optional()
      .describe(
        'Other classes may learn it through the same source (ADR-0004 "simple" rule); default false.',
      ),
    supporting: z
      .boolean()
      .optional()
      .describe(
        'A supporting (numeric) entry rather than a verb (ADR-0004 P1, P2); default false.',
      ),
    climbDifficulty: z
      .int()
      .min(1)
      .max(3)
      .optional()
      .describe(
        'The hardest climb difficulty (1 ladders, ropes and ivy; 2 rough stone and timber; 3 sheer faces) holding this capability lets the actor attempt (mw-e10.9); an actor attempts the highest of its capabilities, and 1 with none. Absent = grants none.',
      ),
  })
  .superRefine((def, ctx) => {
    if (def.crossClass === true && def.classAffinity === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['crossClass'],
        message:
          'crossClass needs a classAffinity: a capability without one is already for any class',
      });
    }
  });

/** The localisation keys of a capability's name and description (explicit or by convention). */
export function capabilityKeys(def: CapabilityDef): { nameKey: string; descKey: string } {
  return {
    nameKey: def.nameKey ?? `capability.${def.id}.name`,
    descKey: def.descKey ?? `capability.${def.id}.desc`,
  };
}

/** One file of the capability registry: `src/content/data/capability/<id>.json`. */
export const capabilitySchema = z
  .strictObject({
    id: contentId.describe('Group id, e.g. "sorcerer-spells". Capabilities are keyed by their id.'),
    name: z.string().min(1).describe('Display name of the group (docs and debug tools).'),
    notes: z.string().min(1).describe('What the group covers and where it comes from, for review.'),
    capabilities: z.array(capabilityDefSchema).min(1).describe('The capabilities it declares.'),
  })
  .superRefine((group, ctx) => {
    const seen = new Set<string>();
    group.capabilities.forEach(({ id }, index) => {
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['capabilities', index, 'id'],
          message: `"${id}" is declared twice in this file`,
        });
      }
      seen.add(id);
    });
  });

/** A capability group as written in JSON. */
export type CapabilityGroupInput = z.input<typeof capabilitySchema>;
/** A validated capability group. */
export type CapabilityGroup = z.output<typeof capabilitySchema>;
/** One validated capability definition. */
export type CapabilityDef = CapabilityGroup['capabilities'][number];

/** Every declared capability id across the loaded capability groups. */
export function capabilityIds(entries: readonly LoadedEntry[]): ReadonlySet<string> {
  return new Set(
    entries
      .filter((entry) => entry.type === 'capability')
      .flatMap((entry) => (entry.value as CapabilityGroup).capabilities.map(({ id }) => id)),
  );
}

/**
 * Capability id -> the climb difficulty it lets an actor attempt (mw-e10.9), for every declared
 * capability that grants one. The sim reads it as a plain map (`maxClimbDifficulty`).
 */
export function climbDifficultyGrants(
  groups: readonly {
    readonly capabilities: readonly {
      readonly id: string;
      readonly climbDifficulty?: number | undefined;
    }[];
  }[],
): Map<string, number> {
  const grants = new Map<string, number>();
  for (const { capabilities } of groups) {
    for (const { id, climbDifficulty } of capabilities) {
      if (climbDifficulty !== undefined) grants.set(id, climbDifficulty);
    }
  }
  return grants;
}

/** The load check for the registry: a capability id is declared in one file only. */
export const checkCapabilities: ContentCheck = (entries) => {
  const firstFile = new Map<string, string>();
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'capability') continue;
    (value as CapabilityGroup).capabilities.forEach(({ id }, i) => {
      const first = firstFile.get(id);
      if (first === undefined) firstFile.set(id, file);
      else {
        issues.push({
          file,
          pointer: `/capabilities/${String(i)}/id`,
          message: `capability "${id}" is already declared in ${first}`,
        });
      }
    });
  }
  return issues;
};
