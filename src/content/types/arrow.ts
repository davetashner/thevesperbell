// The arrow content type (mw-e05.1): every arrow is data, not code (architectural principle). An
// arrow is its physical body (mass, drag, penetration and what it does on impact), the damage packet
// it carries (the move/spell damage template), the world properties it carries in flight (a fire
// arrow is `burning`) and an ordered payload of property-based emissions it releases where it lands.
// A new trick arrow is a data file; a new payload op is code — an op name the schema does not know
// fails validation instead of being ignored. One file per arrow at `src/content/data/arrow/<id>.json`;
// the field reference in docs/content/arrow-schema.md is generated from this file (`pnpm content:docs`).
//
// Payloads are systemic, never pairwise: they set a world property (mw-e03.1/e03.31 vocabulary) or
// emit a stimulus (mw-e03.3's one stimulus API) and the struck world's own properties decide what
// happens — a fire arrow does not know about ropes, a rope arrow does not know about beams (it needs
// a `softAnchor` surface). A payload key that names a target type (`onlyAffects`, `targets`,
// `vsUndead`…) is rejected as non-systemic, with a message saying so.
//
// Vocabulary is shared, never re-invented: the damage packet is the move damage template (damage.ts
// types), stimulus elements are the spell schema's mirror of the sim's STIMULUS_ELEMENTS (kept equal
// by tests/contracts/spells.test.ts and tests/contracts/arrows.test.ts), properties are canonical
// world-property keys with values checked against that property's own range. Cue ids follow the
// style and audio bibles (`vfx-…`, `sfx-…`); the contract test checks every sound cue a shipped arrow
// names exists in the sound manifest.
//
// Units: grams, kg/m (drag), metres, seconds; stimulus intensities in the stimulus API's units.
// Penetration is rated against surface hardness (soft 5, medium 10, hard 40; mw-e05.2). Flying and
// hitting are e05.2's ballistics; applying payloads is each trick arrow's bead. This is the shape only.

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId } from '../schema.ts';
import { canonicalPropertyKey, worldPropertiesSchema } from '../world-properties.ts';
import { AUDIO_CUE_PATTERN, damageTemplateSchema, VFX_CUE_PATTERN } from './move.ts';
import { SPELL_STIMULUS_ELEMENTS } from './spell.ts';

/** Current ArrowDef schema version; bump it (and add a migration) on breaking changes. */
export const ARROW_SCHEMA_VERSION = 1;

/**
 * What an arrow does when it hits: `stick` embeds when its penetration reaches the surface's hardness
 * (else ricochets, e05.2), `bounce` never embeds (blunt heads), `shatter` breaks on any impact.
 */
export const ARROW_IMPACTS = ['stick', 'bounce', 'shatter'] as const;

/** Payload op names, in the order the docs list them. */
export const ARROW_PAYLOAD_OPS = [
  'applyProperty',
  'stimulus',
  'spawn',
  'noise',
  'impactForceMul',
] as const;

/** The highest penetration rating (hard surfaces are 40). */
export const MAX_PENETRATION = 100;

/** Penetration each surface hardness needs for an arrow to stick (mw-e05.2). */
export const SURFACE_PENETRATION = Object.freeze({ soft: 5, medium: 10, hard: 40 });

/**
 * Key prefixes that name what a payload affects rather than what it emits (`onlyAffects`,
 * `targetType`, `vsUndead`, `exceptPlayer`…). Payloads act on properties; the target decides.
 */
const TARGET_SPECIFIC_KEY =
  /^(only|affects|against|vs|versus|except|exclud|includ|whitelist|blacklist|immune)|target/i;

/** An arrow impact behaviour. */
export type ArrowImpact = (typeof ARROW_IMPACTS)[number];
/** A payload op name. */
export type ArrowPayloadOpName = (typeof ARROW_PAYLOAD_OPS)[number];

/** Is `key` a key that names a target type (and so is non-systemic)? */
export function isTargetSpecificKey(key: string): boolean {
  return TARGET_SPECIFIC_KEY.test(key);
}

/** Loader message for unknown keys: target-specific ones are named as non-systemic. */
function unknownKeyMessage(issue: z.core.$ZodRawIssue): string | undefined {
  if (issue.code !== 'unrecognized_keys') return undefined;
  return issue.keys
    .map((key) =>
      isTargetSpecificKey(key)
        ? `"${key}" is non-systemic: arrows never name what they affect; emit a property or ` +
          'stimulus and let the struck entity’s world properties decide'
        : `unknown key "${key}"`,
    )
    .join('; ');
}

/** A strict object whose unknown keys get the non-systemic message. */
const strict = <T extends z.core.$ZodLooseShape>(shape: T) =>
  z.strictObject(shape, { error: unknownKeyMessage });

const seconds = z.number().nonnegative();
const metres = z.number().positive();
const radius = z
  .number()
  .nonnegative()
  .default(0)
  .describe('Sphere radius around the impact point, metres; 0 = only the struck entity.');

const fieldSchemas = worldPropertiesSchema.shape;
type PropertyKey = keyof typeof fieldSchemas;
const PROPERTY_KEYS = Object.keys(fieldSchemas) as PropertyKey[];
/** Properties no payload may set: a material swap is not an emission; supports are level wiring. */
const NOT_APPLICABLE: readonly string[] = ['material', 'support'];
const isPropertyKey = (key: string): key is PropertyKey =>
  (PROPERTY_KEYS as readonly string[]).includes(key);
const isFlag = (key: PropertyKey) => fieldSchemas[key].unwrap().type === 'boolean';

const propertyKey = z
  .string()
  .superRefine((key, ctx) => {
    if (isPropertyKey(key)) return;
    const canonical = canonicalPropertyKey(key, PROPERTY_KEYS);
    ctx.addIssue({
      code: 'custom',
      message:
        canonical === undefined
          ? `unknown world property "${key}"`
          : `"${key}" is not a world property; use the canonical key "${canonical}"`,
    });
  })
  .describe('A canonical world property key (docs/design/world-properties.md).');

const propertyValue = z
  .union([z.boolean(), z.number(), z.string(), z.record(z.string(), z.number())])
  .optional()
  .describe(
    'Value to set, checked against the property’s own range; omit for a flag to set it true.',
  );

/**
 * Error map for the payload union: an unknown or missing op names the value and every known op (the
 * loader adds the file and the JSON path, e.g. `payload[0].op`).
 */
const unknownOp = (issue: z.core.$ZodRawIssue): string | undefined => {
  if (issue.code !== 'invalid_union') return undefined;
  const value = (issue.input as Record<string, unknown>)['op']; // only objects reach the discriminator
  const found =
    value === undefined ? 'missing payload op' : `unknown payload op ${JSON.stringify(value)}`;
  return `${found}; known: ${ARROW_PAYLOAD_OPS.join(', ')}`;
};

const payloadSchema = z
  .discriminatedUnion(
    'op',
    [
      strict({
        op: z.literal('applyProperty'),
        property: propertyKey,
        value: propertyValue,
        radius,
      }).describe(
        'Sets a world property on what it reaches; the property’s own rules decide whether it takes ' +
          '(only things flammable right now catch `burning`).',
      ),
      strict({
        op: z.literal('stimulus'),
        element: z.enum(SPELL_STIMULUS_ELEMENTS).describe('Stimulus element (stimulus API).'),
        intensity: z
          .number()
          .nonnegative()
          .describe('Total amount at full falloff, in the element’s unit (°C, wetness, N·s, J…).'),
        radius,
        duration: seconds.default(0).describe('Seconds to spread the intensity over; 0 = at once.'),
        falloff: z
          .enum(['linear', 'none'])
          .default('linear')
          .describe(
            'Intensity falloff inside the sphere (stimulus API): linear to the rim, or none.',
          ),
        gas: contentId
          .optional()
          .describe('Gas type id; required for (and only for) element "gas".'),
      }).describe('Emits a world stimulus at the impact point (heat, cold, water, charge, gas…).'),
      strict({
        op: z.literal('spawn'),
        entity: contentId.describe(
          'Id of what it spawns at the impact point, e.g. "rope" (defined by the payload’s bead).',
        ),
        length: metres.optional().describe('Length of a spawned line (rope), metres.'),
        anchor: propertyKey
          .optional()
          .describe(
            'Flag property the struck surface must have to anchor the spawn (e.g. "softAnchor"); ' +
              'without it the arrow bounces and nothing spawns.',
          ),
      }).describe('Spawns a world entity where the arrow lands (a rope to climb).'),
      strict({
        op: z.literal('noise'),
        loudness: metres.describe(
          'NoiseEvent level at the impact point, dB at 1 m (e05.11 uses 70).',
        ),
        duration: seconds.default(0).describe('Seconds the sound lasts; 0 = one instant.'),
      }).describe('Makes a sound at the impact point that stealth and AI hear (e09).'),
      strict({
        op: z.literal('impactForceMul'),
        factor: z
          .number()
          .positive()
          .max(10)
          .describe('Multiplier on the hit’s impact force and knock impulse (0–10).'),
      }).describe('Hits harder: knocks objects over and presses switches (blunt heads).'),
    ],
    { error: unknownOp },
  )
  .describe('One payload op; ops apply in list order where the arrow lands.');

const cueSchema = (pattern: RegExp, example: string, doc: string) =>
  z
    .string({
      error: (issue) =>
        issue.input === undefined
          ? `required: name a cue (a placeholder is fine), e.g. "${example}"`
          : undefined,
    })
    .regex(pattern, `must be a cue id, e.g. "${example}"`)
    .describe(doc);

/** Schema of one arrow file, `src/content/data/arrow/<id>.json`. */
export const arrowSchema = strict({
  id: contentId.describe('Unique arrow id, e.g. "standard". Stable once shipped (saves).'),
  schemaVersion: z
    .literal(ARROW_SCHEMA_VERSION)
    .default(ARROW_SCHEMA_VERSION)
    .describe('ArrowDef schema version, for future migrations.'),
  name: z.string().min(1).describe('Display name, e.g. "Standard Arrow".'),
  notes: z
    .string()
    .min(1)
    .optional()
    .describe('Where the numbers come from (bead, design intent), for owner review.'),
  massGrams: z.number().positive().max(1000).describe('Mass, grams (ballistics: a = F / m).'),
  dragK: z
    .number()
    .nonnegative()
    .max(1)
    .describe('Quadratic drag constant k, kg/m: drag acceleration = −k·v·|v| / m (e05.2).'),
  damage: damageTemplateSchema.describe(
    'Damage packet at launch speed (same template as a move’s); ballistics scales it by speed.',
  ),
  penetration: z
    .number()
    .min(0)
    .max(MAX_PENETRATION)
    .describe(
      'Penetration rating (0–100) against surface hardness: soft 5, medium 10, hard 40; ' +
        'a sticking arrow embeds when it reaches the surface’s rating.',
    ),
  onImpact: z.enum(ARROW_IMPACTS).describe('stick (if it penetrates), bounce, or shatter.'),
  retrievable: z
    .boolean()
    .default(true)
    .describe(
      'Can be picked up again after it lands (intact roll: e05.7); shattering ones cannot.',
    ),
  properties: worldPropertiesSchema
    .optional()
    .describe('World properties the arrow itself carries in flight, e.g. a fire arrow is burning.'),
  payload: z
    .array(payloadSchema)
    .prefault([])
    .describe('Property-based emissions where it lands, in order; empty for a plain arrow.'),
  cues: strict({
    trailVfx: cueSchema(VFX_CUE_PATTERN, 'vfx-arrow-trail-standard', 'Flight trail VFX cue id.'),
    impactVfx: z
      .string()
      .regex(VFX_CUE_PATTERN, 'must be a cue id, e.g. "vfx-arrow-impact-water"')
      .optional()
      .describe('Payload VFX at the impact point; surface puffs come from the surface material.'),
    flightSfx: z
      .string()
      .regex(AUDIO_CUE_PATTERN, 'must be a cue id, e.g. "sfx-arrow-flyby"')
      .default('sfx-arrow-flyby')
      .describe('Audio cue of the arrow passing by (audio bible §6, no round-robin number).'),
    impactSfx: z
      .string()
      .regex(AUDIO_CUE_PATTERN, 'must be a cue id, e.g. "sfx-arrow-fire-ignite"')
      .optional()
      .describe(
        'Payload sound layered over the surface impact (the surface material picks wood, stone…).',
      ),
  }).describe('Presentation cue ids (style bible §15.1, audio bible §6).'),
  tags: z.array(contentId).prefault([]).describe('Free tags for queries and shops, e.g. "trick".'),
}).superRefine((arrow, ctx) => {
  const fail = (path: readonly (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path: [...path], message: `arrow "${arrow.id}": ${message}` });
  };
  if (new Set(arrow.tags).size !== arrow.tags.length) fail(['tags'], 'lists a tag twice');
  if (arrow.onImpact === 'shatter' && arrow.retrievable) {
    fail(['retrievable'], 'a shattering arrow cannot be retrievable');
  }
  if (arrow.onImpact === 'stick' && arrow.penetration === 0) {
    fail(['penetration'], 'a sticking arrow needs penetration above 0 (or onImpact "bounce")');
  }
  if (arrow.payload.filter((p) => p.op === 'impactForceMul').length > 1) {
    fail(['payload'], 'lists impactForceMul twice');
  }
  arrow.payload.forEach((p, i) => {
    switch (p.op) {
      case 'applyProperty': {
        const key = p.property;
        if (!isPropertyKey(key)) break; // already reported at the property
        if (NOT_APPLICABLE.includes(key)) {
          fail(['payload', i, 'property'], `"${key}" cannot be applied by a payload`);
        } else if (p.value === undefined) {
          if (!isFlag(key)) fail(['payload', i, 'value'], `"${key}" is not a flag: give a value`);
        } else {
          for (const issue of fieldSchemas[key].safeParse(p.value).error?.issues ?? []) {
            fail(['payload', i, 'value', ...(issue.path as (string | number)[])], issue.message);
          }
        }
        break;
      }
      case 'stimulus':
        if (p.element === 'gas' && p.gas === undefined) {
          fail(['payload', i, 'gas'], 'a gas stimulus needs a gas type id');
        }
        if (p.element !== 'gas' && p.gas !== undefined) {
          fail(['payload', i, 'gas'], `only gas stimuli name a gas (element is "${p.element}")`);
        }
        break;
      case 'spawn':
        if (p.anchor !== undefined && isPropertyKey(p.anchor) && !isFlag(p.anchor)) {
          fail(['payload', i, 'anchor'], `anchor "${p.anchor}" is not a flag property`);
        }
        if (p.anchor !== undefined && arrow.onImpact !== 'stick') {
          fail(['payload', i, 'anchor'], 'an anchored spawn needs onImpact "stick"');
        }
        break;
      default:
        break;
    }
  });
});

/** An ArrowDef as written in JSON (optional sections may be omitted). */
export type ArrowDefinitionInput = z.input<typeof arrowSchema>;
/** A validated ArrowDef with every default filled. */
export type ArrowDefinition = z.output<typeof arrowSchema>;
/** One payload op of a validated arrow. */
export type ArrowPayload = ArrowDefinition['payload'][number];
/** A loaded (deeply frozen) ArrowDef. */
export type ArrowEntry = Frozen<ArrowDefinition>;
