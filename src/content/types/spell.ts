// The spell content type (mw-e06.1): every spell is data, not code (technical constitution). A spell
// is who teaches it (school, book, tier and follow-on verbs), what casting it costs (mana, cast time,
// channel, cooldown), how it reaches the world (one delivery) and what it does there (an ordered list
// of effect ops). New spells are data files; new ops are code — an op name the schema does not know
// fails validation instead of being ignored, so a typo can never ship a spell that silently does
// nothing. One file per spell at `src/content/data/spell/<id>.json`; the field reference in
// docs/content/spell-schema.md is generated from this file (`pnpm content:docs`).
//
// Vocabulary is shared, never re-invented: damage amounts use the damage model's DAMAGE_TYPES (a
// damage op *is* a move's damage template), stimulus elements mirror the sim's one stimulus API
// (src/sim/stimulus, kept equal by tests/contracts/spells.test.ts), and a summon's material is a
// canonical world property (mw-e03.31), so Animate Bones consumes exactly what the world calls
// `remains`. Presentation cue ids follow the style and audio bibles (`vfx-…`, `sfx-…`) and are
// required: a spell without final art still names its placeholder cue, so swapping assets is a file
// drop, not a data change.
//
// Units: seconds, metres, mana points; stimulus intensities in the stimulus API's units (°C, wetness,
// charge, N·s, J, light units). Running spells is e06.2's pipeline; this module is the shape only.

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId, ref } from '../schema.ts';
import { canonicalPropertyKey, worldPropertiesSchema } from '../world-properties.ts';
import { AUDIO_CUE_PATTERN, damageTemplateSchema, VFX_CUE_PATTERN } from './move.ts';

/** Current SpellDefinition schema version; bump it (and add a migration) on breaking changes. */
export const SPELL_SCHEMA_VERSION = 1;

/**
 * Schools of magic: the constitution's list plus Somnomancy (story bible §3.3). Which are licensed,
 * restricted or forbidden is a book/legality concern (e07.1), not the spell's.
 */
export const SPELL_SCHOOLS = [
  'fire',
  'frost',
  'storm',
  'arcane',
  'illusion',
  'alteration',
  'conjuration',
  'necromancy',
  'nature',
  'light',
  'shadow',
  'gravity',
  'time',
  'somnomancy',
] as const;

/** How a spell reaches its targets. */
export const SPELL_DELIVERIES = [
  'self',
  'touch',
  'projectile',
  'aoe',
  'beam',
  'summonPoint',
] as const;

/** Effect op names, in the order the pipeline's op registry (e06.2) documents them. */
export const SPELL_EFFECT_OPS = [
  'damage',
  'stimulus',
  'force',
  'status',
  'summon',
  'transform',
  'displace',
  'spawnVolume',
  'light',
  'noise',
] as const;

/**
 * Stimulus elements a spell may emit: the sim's STIMULUS_ELEMENTS (src/sim/stimulus/stimulus.ts),
 * mirrored because content imports the sim only as types (tests/contracts keeps them equal).
 */
export const SPELL_STIMULUS_ELEMENTS = [
  'heat',
  'cold',
  'water',
  'charge',
  'force',
  'gas',
  'light',
  'blunt',
  'slash',
  'pierce',
] as const;

/** Where an area of effect is centred. */
export const AOE_ORIGINS = ['caster', 'aim'] as const;
/** Force op modes (e06.8): push away, pull toward, a directed impulse, or a sustained lift. */
export const FORCE_MODES = ['push', 'pull', 'impulse', 'lift'] as const;
/** Displace op modes (e06.12). */
export const DISPLACE_MODES = ['teleport', 'swap', 'dash'] as const;
/** What a light op's light follows (e06.14). */
export const LIGHT_ATTACHMENTS = ['caster', 'delivery', 'point'] as const;
/** Cast phases a noise op sounds in (e06.14). */
export const NOISE_PHASES = ['windup', 'release', 'impact'] as const;
/** The highest tier a spell can have (a verb chain's last step). */
export const MAX_SPELL_TIER = 5;

/** A school of magic. */
export type SpellSchool = (typeof SPELL_SCHOOLS)[number];
/** A delivery kind. */
export type SpellDeliveryKind = (typeof SPELL_DELIVERIES)[number];
/** An effect op name. */
export type SpellEffectOpName = (typeof SPELL_EFFECT_OPS)[number];
/** A stimulus element a spell may emit. */
export type SpellStimulusElement = (typeof SPELL_STIMULUS_ELEMENTS)[number];

const seconds = z.number().nonnegative();
const positiveSeconds = z.number().positive();
const metres = z.number().positive();
const falloff = z
  .enum(['linear', 'none'])
  .default('linear')
  .describe('Intensity falloff inside the shape (stimulus API): linear to the rim, or none.');

/**
 * Error map for a discriminated union: an unknown or missing discriminator names the value and every
 * known option (the loader adds the file and the JSON path, e.g. `effects[0].op`); other problems keep
 * zod's message.
 */
const unknownOption =
  (what: string, key: string, known: readonly string[]) =>
  (issue: z.core.$ZodRawIssue): string | undefined => {
    if (issue.code !== 'invalid_union') return undefined;
    const value = (issue.input as Record<string, unknown>)[key]; // only objects reach the discriminator
    const found =
      value === undefined ? `missing ${what}` : `unknown ${what} ${JSON.stringify(value)}`;
    return `${found}; known: ${known.join(', ')}`;
  };

// Area shapes: aoe deliveries and spawned volumes share them, and they map onto stimulus shapes.
const areaShapeSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('sphere'),
      radius: metres.describe('Radius, metres.'),
    }),
    z.strictObject({
      kind: z.literal('cone'),
      length: metres.describe('Reach along the aim direction, metres.'),
      angle: z.number().positive().max(180).describe('Full opening angle, degrees (at most 180).'),
    }),
    z.strictObject({
      kind: z.literal('line'),
      length: metres.describe('Length along the aim direction, metres.'),
      width: metres.describe('Width, metres.'),
      height: metres.describe('Height, metres (a wall of fire is tall; a trail of frost is not).'),
    }),
    z.strictObject({
      kind: z.literal('decal'),
      radius: metres.describe('Radius of the ground patch, metres.'),
    }),
  ])
  .describe('Area shape: sphere, cone, line (wall) or ground decal.');

const deliverySchema = z
  .discriminatedUnion(
    'kind',
    [
      z.strictObject({ kind: z.literal('self') }).describe('Affects the caster only.'),
      z
        .strictObject({
          kind: z.literal('touch'),
          reach: metres.default(1.5).describe('How far from the caster it can touch, metres.'),
        })
        .describe('Affects what the caster touches in front of them.'),
      z
        .strictObject({
          kind: z.literal('projectile'),
          speed: metres.describe('Flight speed, metres per second.'),
          maxRange: metres.describe('Distance after which it fizzles, metres.'),
          radius: metres.describe('Collision radius, metres.'),
          gravity: z
            .number()
            .nonnegative()
            .default(0)
            .describe('Downward acceleration, m/s²; 0 flies straight, 9.81 arcs like a stone.'),
        })
        .describe('A physical projectile that flies and hits (e06.6).'),
      z
        .strictObject({
          kind: z.literal('aoe'),
          shape: areaShapeSchema,
          origin: z
            .enum(AOE_ORIGINS)
            .default('caster')
            .describe('Centred on the caster or the aim point.'),
          range: z
            .number()
            .nonnegative()
            .default(0)
            .describe('Farthest aim point from the caster, metres (0 for caster-centred areas).'),
          lineOfSight: z
            .boolean()
            .default(false)
            .describe('Only targets with line of sight to the centre are affected.'),
        })
        .describe('An instant area of effect (e06.7); persistent areas are spawnVolume ops.'),
      z
        .strictObject({
          kind: z.literal('beam'),
          length: metres.describe('Beam reach, metres.'),
          width: metres.describe('Beam width, metres.'),
          maxBounces: z
            .int()
            .min(0)
            .max(8)
            .default(0)
            .describe('Reflections off reflective surfaces before it stops (0–8).'),
        })
        .describe('A continuous ray that may reflect off reflective surfaces (e06.7).'),
      z
        .strictObject({
          kind: z.literal('summonPoint'),
          range: metres.describe('Farthest point from the caster it can be placed at, metres.'),
          lineOfSight: z
            .boolean()
            .default(true)
            .describe('The point must be visible from the caster.'),
        })
        .describe('A chosen point on the ground where summons and volumes appear.'),
    ],
    { error: unknownOption('delivery kind', 'kind', SPELL_DELIVERIES) },
  )
  .describe('How the spell reaches its targets; effect ops apply to what it reaches.');

const PROPERTY_KEYS: readonly string[] = Object.keys(worldPropertiesSchema.shape);

const propertyKey = z
  .string()
  .superRefine((key, ctx) => {
    if (PROPERTY_KEYS.includes(key)) return;
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

const opSchemas = [
  damageTemplateSchema
    .extend({ op: z.literal('damage') })
    .describe('Deals a damage packet through the damage model (same template as a move’s).'),
  z
    .strictObject({
      op: z.literal('stimulus'),
      element: z.enum(SPELL_STIMULUS_ELEMENTS).describe('Stimulus element (stimulus API).'),
      intensity: z
        .number()
        .nonnegative()
        .describe('Total amount at full falloff, in the element’s unit (°C, wetness, N·s, J…).'),
      radius: z
        .number()
        .nonnegative()
        .default(0)
        .describe(
          'Sphere radius around each hit point, metres; 0 = the delivery’s own contact/shape.',
        ),
      duration: seconds.default(0).describe('Seconds to spread the intensity over; 0 = at once.'),
      falloff,
      gas: contentId.optional().describe('Gas type id; required for (and only for) element "gas".'),
    })
    .describe('Emits a world stimulus; properties decide what burns, freezes or conducts (e06.5).'),
  z
    .strictObject({
      op: z.literal('force'),
      mode: z
        .enum(FORCE_MODES)
        .describe('push away, pull toward, directed impulse or sustained lift.'),
      impulse: z.number().positive().describe('Impulse, N·s (per second for a sustained lift).'),
      duration: seconds.default(0).describe('Seconds a sustained force lasts; 0 = one impulse.'),
    })
    .describe('Pushes, pulls or lifts what it reaches, scaled by weight (e06.8).'),
  z
    .strictObject({
      op: z.literal('status'),
      status: contentId.describe('Status id, e.g. "rooted" (status definitions: e06.9).'),
      duration: positiveSeconds.describe('Seconds the status lasts.'),
      stacks: z.int().min(1).max(99).default(1).describe('Stacks applied.'),
    })
    .describe('Applies a status (rooted, slowed, levitating, …).'),
  z
    .strictObject({
      op: z.literal('summon'),
      creature: ref('creature').describe('Creature summoned.'),
      duration: positiveSeconds.describe('Seconds before it is dismissed.'),
      count: z.int().min(1).max(10).default(1).describe('How many one cast summons.'),
      maxActive: z
        .int()
        .min(1)
        .max(20)
        .default(1)
        .describe('Most alive per caster; summoning more dismisses the oldest.'),
      consumes: z
        .strictObject({
          property: propertyKey,
          radius: metres.describe('Search radius around the summon point, metres.'),
          count: z.int().min(1).max(10).default(1).describe('Entities with the property consumed.'),
        })
        .optional()
        .describe('World material the summon needs and uses up (e.g. property "remains").'),
    })
    .describe('Summons a temporary creature (e06.10).'),
  z
    .strictObject({
      op: z.literal('transform'),
      into: ref('creature').describe('Creature form the target takes.'),
      duration: positiveSeconds.describe('Seconds before it changes back.'),
    })
    .describe('Temporarily turns a creature into another (e06.11).'),
  z
    .strictObject({
      op: z.literal('displace'),
      mode: z
        .enum(DISPLACE_MODES)
        .describe('teleport to the aim point, swap with the target, or dash.'),
      distance: metres.describe('Farthest displacement, metres.'),
      lineOfSight: z.boolean().default(true).describe('The destination must be visible.'),
    })
    .describe('Moves the caster or target with safe placement (e06.12).'),
  z
    .strictObject({
      op: z.literal('spawnVolume'),
      shape: areaShapeSchema,
      element: z
        .enum(SPELL_STIMULUS_ELEMENTS)
        .describe('Stimulus element the volume emits while it lasts.'),
      intensity: z
        .number()
        .nonnegative()
        .describe('Amount per second at full falloff, in the element’s unit.'),
      duration: positiveSeconds.describe('Seconds the volume lasts.'),
      falloff,
      gas: contentId.optional().describe('Gas type id; required for (and only for) element "gas".'),
    })
    .describe('Leaves a persistent stimulus volume (fire wall, ice sheet, cloud) (e06.5, e06.7).'),
  z
    .strictObject({
      op: z.literal('light'),
      intensity: z.number().positive().describe('Light output (a torch is about 100).'),
      radius: metres.describe('Reach, metres.'),
      duration: seconds.default(0).describe('Seconds it shines; 0 = a flash.'),
      attach: z
        .enum(LIGHT_ATTACHMENTS)
        .default('delivery')
        .describe('Follows the caster, the delivery (projectile, beam) or stays at the hit point.'),
    })
    .describe('Adds light to the light field that stealth and AI perceive (e06.14).'),
  z
    .strictObject({
      op: z.literal('noise'),
      phase: z.enum(NOISE_PHASES).describe('Cast phase it sounds in.'),
      loudness: metres.describe('Hearing radius, metres, before sound propagation attenuates it.'),
    })
    .describe('Makes a sound that stealth and AI hear (e06.14).'),
] as const;

const effectSchema = z
  .discriminatedUnion('op', [...opSchemas], {
    error: unknownOption('effect op', 'op', SPELL_EFFECT_OPS),
  })
  .describe('One effect op; ops apply in list order.');

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

/** Schema of one spell file, `src/content/data/spell/<id>.json`. */
export const spellSchema = z
  .strictObject({
    id: contentId.describe('Unique spell id, e.g. "ember". Stable once shipped (saves).'),
    schemaVersion: z
      .literal(SPELL_SCHEMA_VERSION)
      .default(SPELL_SCHEMA_VERSION)
      .describe('SpellDefinition schema version, for future migrations.'),
    name: z.string().min(1).describe('Display name, e.g. "Ember".'),
    school: z.enum(SPELL_SCHOOLS).describe('School of magic.'),
    tier: z
      .int()
      .min(1)
      .max(MAX_SPELL_TIER)
      .describe('Step in its verb chain: 1 is a first verb, higher tiers follow on from it.'),
    next: z
      .array(ref('spell'))
      .prefault([])
      .describe('Follow-on verbs this spell leads to (unlock rules: e07.8).'),
    cost: z
      .strictObject({
        mana: z.number().nonnegative().describe('Mana spent when the cast releases.'),
      })
      .describe('What a cast costs.'),
    castTime: seconds.describe('Wind-up seconds before release; 0 = instant.'),
    channel: z
      .strictObject({
        interval: positiveSeconds.describe(
          'Seconds between channel ticks; effects apply each tick.',
        ),
        manaPerSecond: z
          .number()
          .nonnegative()
          .describe('Mana drained per second while channelled.'),
        maxDuration: positiveSeconds.describe('Longest it can be channelled, seconds.'),
      })
      .optional()
      .describe('Present for channelled spells (held after release, e06.4).'),
    cooldown: seconds.default(0).describe('Seconds after release before it can be cast again.'),
    delivery: deliverySchema,
    effects: z
      .array(effectSchema)
      .min(1)
      .describe('Effect ops, applied in order to what it reaches.'),
    tags: z
      .array(contentId)
      .prefault([])
      .describe('Free tags for queries and dispel rules, e.g. "fire", "control".'),
    vfxCue: cueSchema(VFX_CUE_PATTERN, 'vfx-spell-fire-ember', 'VFX cue id (style bible §15.1).'),
    sfxCue: cueSchema(
      AUDIO_CUE_PATTERN,
      'sfx-spell-fire-ember-cast',
      'Audio cue id (audio bible §6), without the round-robin number.',
    ),
    bookId: contentId
      .optional()
      .describe('Book that teaches it (book items: e07.1); absent for spells no book teaches.'),
    flags: z
      .strictObject({
        tooUseful: z
          .boolean()
          .default(false)
          .describe('Deliberately powerful: protected from balance nerfs (constitution §4).'),
        castWhileMoving: z
          .boolean()
          .default(false)
          .describe('Moving does not interrupt its wind-up or channel (e06.4).'),
        allowOvercast: z
          .boolean()
          .default(false)
          .describe(
            'May be cast with too little mana: spends what is left and requests a miscast (e06.3, e06.13).',
          ),
      })
      .prefault({})
      .describe('Design flags.'),
  })
  .superRefine((spell, ctx) => {
    const fail = (path: readonly (string | number)[], message: string) => {
      ctx.addIssue({ code: 'custom', path: [...path], message: `spell "${spell.id}": ${message}` });
    };
    spell.next.forEach((link, i) => {
      if (link.id === spell.id) fail(['next', i], 'cannot lead to itself');
    });
    if (new Set(spell.next.map((link) => link.id)).size !== spell.next.length) {
      fail(['next'], 'lists a follow-on spell twice');
    }
    if (new Set(spell.tags).size !== spell.tags.length) fail(['tags'], 'lists a tag twice');
    if (spell.channel !== undefined && spell.channel.interval > spell.channel.maxDuration) {
      fail(['channel', 'interval'], 'channel interval is longer than its maxDuration');
    }
    const { delivery } = spell;
    if (delivery.kind === 'aoe' && delivery.origin === 'caster' && delivery.range > 0) {
      fail(['delivery', 'range'], 'a caster-centred area has no aim range (use origin "aim")');
    }
    spell.effects.forEach((effect, i) => {
      if (effect.op !== 'stimulus' && effect.op !== 'spawnVolume') return;
      if (effect.element === 'gas' && effect.gas === undefined) {
        fail(['effects', i, 'gas'], 'a gas stimulus needs a gas type id');
      }
      if (effect.element !== 'gas' && effect.gas !== undefined) {
        fail(['effects', i, 'gas'], `only gas stimuli name a gas (element is "${effect.element}")`);
      }
    });
  });

/** A SpellDefinition as written in JSON (optional sections may be omitted). */
export type SpellDefinitionInput = z.input<typeof spellSchema>;
/** A validated SpellDefinition with every default filled and refs parsed. */
export type SpellDefinition = z.output<typeof spellSchema>;
/** One effect op of a validated spell. */
export type SpellEffect = SpellDefinition['effects'][number];
/** A validated delivery. */
export type SpellDelivery = SpellDefinition['delivery'];
/** A loaded (deeply frozen) SpellDefinition. */
export type SpellEntry = Frozen<SpellDefinition>;
