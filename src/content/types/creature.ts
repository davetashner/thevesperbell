// The creature content type (mw-e12.1): one validated CreatureDef envelope shared by AI, stealth,
// combat and the bestiary (constitution: enemies are creatures, not target dummies, and they are
// data). Only id, family, stats, senses and locomotion are required; every other section has a
// documented default filled at load, so later items (attacks e12.5, locomotion e12.6,
// resistances and poise regen e04.1/e12.7, hit reactions e04.7, factions e12.8, fears e12.10,
// personality e12.11, needs e12.12…) can
// extend their stub sub-schema here without touching existing creature files. The field reference
// in docs/content/creature-schema.md is generated from this file (`pnpm content:docs`). Senses and
// their reusable `sense` profiles live in sense.ts (e12.2); locomotion and its reusable `locomotion`
// profiles in locomotion.ts (e12.6).
//
// Units: metres, kilograms, degrees, metres per second. Anything timed in ticks says so in its name.

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId, ref } from '../schema.ts';
import { creatureAudioSchema } from './creature-audio.ts';
import { hitReactionsSchema, poiseRegenSchema, resistancesSchema } from './damage.ts';
import {
  creatureLocomotionSchema,
  deriveNavAgent,
  resolveLocomotion,
  type Gait,
  type LocomotionProfile,
  type LocomotionProfileLookup,
  type NavAgent,
} from './locomotion.ts';
import {
  creatureSensesSchema,
  resolveSenses,
  type SenseProfile,
  type SenseProfileLookup,
} from './sense.ts';

/** Current CreatureDef schema version; bump it (and add a migration) on breaking changes. */
export const CREATURE_SCHEMA_VERSION = 1;

/** Creature families, from the MVP roster (story bible §8) plus humans and ambient animals. */
export const CREATURE_FAMILIES = [
  'forgotten',
  'rootcellar-goblin',
  'hornfolk',
  'loom-spider',
  'briar-wolf',
  'hushling',
  'tallow-ooze',
  'mimic',
  'hollow-sentinel',
  'wraith',
  'human',
  'animal',
] as const;

/** Size classes, smallest first (used for grabs, knockback, hiding spots and nav agent radius). */
export const SIZE_CLASSES = ['tiny', 'small', 'medium', 'large', 'huge'] as const;

export { DAMAGE_TYPES } from './damage.ts';

/** Stances one creature takes toward another or toward the player (e12.8). */
export const STANCES = [
  'ally',
  'friendly',
  'neutral',
  'wary',
  'hostile',
  'prey',
  'predator',
] as const;

/** Personality traits (e12.11), each 0–1. */
export const PERSONALITY_TRAITS = [
  'bravery',
  'curiosity',
  'aggression',
  'diligence',
  'sociability',
  'greed',
] as const;

const unit = z.number().min(0).max(1);

const statsSchema = z
  .strictObject({
    health: z.int().positive().describe('Maximum health.'),
    poise: z
      .int()
      .nonnegative()
      .describe(
        'Maximum poise; poise damage that empties it staggers the creature (0 = any poise hit).',
      ),
    mass: z.number().positive().describe('Mass in kilograms (knockback, grabs, pressure plates).'),
    size: z.enum(SIZE_CLASSES).describe('Size class.'),
  })
  .describe('Core stats.');

const fearSchema = z.strictObject({
  kind: z.enum(['property', 'faction', 'event']).describe('What kind of stimulus it fears.'),
  stimulus: contentId.describe('The world property, faction id or event name, e.g. "burning".'),
  intensity: z.int().min(0).max(100).describe('Morale lost per perceived stimulus, 0–100.'),
});

const needSchema = z.strictObject({
  ratePerMinute: z.number().nonnegative().describe('Need gained per sim minute, 0–100 scale.'),
  threshold: z.number().min(0).max(100).describe('Need level that emits the need intent.'),
});

const personalityShape = Object.fromEntries(
  PERSONALITY_TRAITS.map((trait) => [trait, unit.default(0.5).describe(`${trait}, 0–1.`)]),
) as Record<(typeof PERSONALITY_TRAITS)[number], z.ZodDefault<z.ZodNumber>>;

/** Schema of one creature file, `src/content/data/creature/<id>.json`. */
export const creatureSchema = z.strictObject({
  id: contentId.describe(
    'Unique creature id, e.g. "forgotten-miner". Stable once shipped (saves).',
  ),
  schemaVersion: z
    .literal(CREATURE_SCHEMA_VERSION)
    .default(CREATURE_SCHEMA_VERSION)
    .describe('CreatureDef schema version, for future migrations.'),
  family: z.enum(CREATURE_FAMILIES).describe('Creature family (story bible §8).'),
  tags: z
    .array(contentId)
    .prefault([])
    .describe('Free-form tags read by AI and quests, e.g. "leader", "undead".'),
  stats: statsSchema,
  senses: creatureSensesSchema,
  locomotion: creatureLocomotionSchema,
  attacks: z
    .array(ref('attack'))
    .prefault([])
    .describe('Attack ids it can use (attack content, e12.5); none = it never attacks.'),
  properties: z
    .array(contentId)
    .prefault([])
    .describe('World-property tags (e03), e.g. "flammable", "conductive".'),
  resistances: resistancesSchema,
  poiseRegen: poiseRegenSchema,
  reactions: hitReactionsSchema,
  faction: ref('faction')
    .optional()
    .describe('Faction it belongs to (e12.8); absent = the "unaligned" faction.'),
  disposition: z
    .strictObject({
      towardPlayer: z
        .enum(STANCES)
        .optional()
        .describe(
          'Starting stance toward the player that overrides its faction’s; absent = the faction’s.',
        ),
    })
    .prefault({})
    .describe('Default disposition; spawn points and runtime state can override it.'),
  fears: z.array(fearSchema).prefault([]).describe('Stimuli that lower its morale (e12.10).'),
  personality: z
    .strictObject(personalityShape)
    .prefault({})
    .describe('Personality trait defaults (e12.11).'),
  needs: z
    .record(contentId, needSchema)
    .prefault({})
    .describe('Needs by id, e.g. "hunger", "sleep", "fatigue" (e12.12); none = no needs.'),
  behaviour: z
    .strictObject({
      profile: contentId.default('default').describe('Behaviour profile id (E11).'),
      tuning: z
        .record(z.string().min(1), z.number())
        .prefault({})
        .describe('Numeric overrides of the profile’s tuning values.'),
    })
    .prefault({})
    .describe('Behaviour profile and tuning overrides.'),
  interactions: z
    .array(contentId)
    .prefault([])
    .describe('Non-hostile affordances offered to the player, e.g. "feed", "talk", "pet".'),
  loot: contentId.optional().describe('Loot table id (E18); absent = drops only what it carries.'),
  shield: ref('shield')
    .optional()
    .describe(
      'Shield (or shieldless guard) it carries, mw-ju8.19: it blocks frontal hits like the knight’s while its behaviour holds a `guard` step; absent = it has no guard.',
    ),
  audio: creatureAudioSchema
    .optional()
    .describe('Audio slots (mw-e28.8): idle loop, footsteps, barks, telegraphs, hurt, death.'),
  presentation: z
    .strictObject({
      mesh: contentId.default('placeholder-capsule').describe('Mesh id; grey-box capsule default.'),
      sfx: contentId.default('placeholder').describe('SFX set id.'),
    })
    .prefault({})
    .describe('Render and audio bindings.'),
});

/** A CreatureDef as written in JSON (optional sections may be omitted). */
export type CreatureDefInput = z.input<typeof creatureSchema>;
/** A validated CreatureDef with every default filled and refs parsed. */
export type CreatureDef = z.output<typeof creatureSchema>;

/**
 * A creature ready to spawn (mw-e12.4): its definition with the senses and locomotion profiles it
 * names resolved, and the nav agent its locomotion derives. What the sim's creature spawner builds
 * an entity from; the sim never resolves content itself.
 */
export interface RuntimeCreature {
  readonly id: string;
  readonly def: Frozen<CreatureDef>;
  readonly senses: Frozen<SenseProfile>;
  readonly nav: Frozen<NavAgent>;
  /** Speed per gait, m/s, of its walking mode (else its first moving mode; 0 when stationary). AI moves it. */
  readonly gaits: Readonly<Record<Gait, number>>;
}

/** Runtime creatures by id (`compileCreatures`). */
export type CreatureTable = ReadonlyMap<string, RuntimeCreature>;

/** Where compiling looks up sense and locomotion profiles; a loaded `GameContent` is one. */
export type CreatureProfileLookup = SenseProfileLookup & LocomotionProfileLookup;

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Moving modes in the order `gaitSpeeds` prefers them. */
const GAIT_MODES = ['walk', 'climb', 'fly', 'swim', 'burrow', 'wallcrawl'] as const;

/** The gait speeds AI moves a creature at: its walk mode's, else its first moving mode's, else 0. */
export function gaitSpeeds(profile: Frozen<LocomotionProfile>): Readonly<Record<Gait, number>> {
  const mode = GAIT_MODES.map((m) => profile.modes[m]).find((m) => m !== undefined);
  const speeds = mode?.speeds ?? { sneak: 0, walk: 0, run: 0 };
  return Object.freeze({ sneak: speeds.sneak, walk: speeds.walk, run: speeds.run });
}

/** Resolves one creature's profiles (see RuntimeCreature). */
export function compileCreature(
  def: Frozen<CreatureDef>,
  profiles: CreatureProfileLookup,
): RuntimeCreature {
  const locomotion = resolveLocomotion(def.locomotion, profiles);
  return Object.freeze({
    id: def.id,
    def,
    senses: deepFreeze(resolveSenses(def.senses, profiles)),
    nav: deepFreeze(deriveNavAgent(locomotion)),
    gaits: gaitSpeeds(locomotion),
  });
}

/** The runtime creature table built from loaded creatures (e.g. `content.all('creature')`), by id. */
export function compileCreatures(
  defs: Iterable<Frozen<CreatureDef>>,
  profiles: CreatureProfileLookup,
): CreatureTable {
  const table = new Map<string, RuntimeCreature>();
  for (const def of [...defs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    table.set(def.id, compileCreature(def, profiles));
  }
  return table;
}
