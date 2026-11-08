// Data-file schema for world properties (mw-e03.1). Any content type that places things in the world
// (props, materials, creatures…) embeds `worldPropertiesSchema` so designers set properties in JSON
// and the loader rejects unknown keys and out-of-range values with the file and JSON pointer. It
// mirrors the sim's spec (src/sim/properties/spec.ts), which content may only import as types: the
// key set and value types are checked at compile time (world-properties.test.ts) and every range and
// default at run time (tests/contracts/world-properties.test.ts). Omitted properties take the sim
// defaults, so data stays sparse. `material` is a reference to a material preset (mw-e03.2), so the
// loader rejects an unknown material id with the file and JSON pointer. Version 2 (mw-e03.31) added
// the properties other epics assumed; a key spelled another way (`soft_anchor`, `water-surface`) or a
// known synonym (`wet`) fails with a message naming the canonical key, so one vocabulary holds.

import { z } from 'zod';
import { contentId, ref } from './schema.ts';

const ABSOLUTE_ZERO = -273.15;
const MAX_TEMPERATURE = 10_000;

const celsius = (doc: string) =>
  z.number().min(ABSOLUTE_ZERO).max(MAX_TEMPERATURE).describe(`${doc} °C.`);
const fraction = (doc: string) => z.number().min(0).max(1).describe(`${doc} 0 … 1.`);
const flag = (doc: string) => z.boolean().describe(doc);
/** A trigger threshold (see the sim spec): 0 … max, absent = never triggers. */
const threshold = (max: number, doc: string) => z.number().min(0).max(max).describe(doc);
const MAX_ENERGY = 1_000_000_000;
const energy = z.number().min(0).max(MAX_ENERGY);

/**
 * Words other designs used for a world property, mapped to the canonical key. Spelling variants
 * (`soft_anchor`, `water-surface`, `Flammable-Gas`) need no entry: any key equal to a canonical one
 * ignoring case, `-` and `_` is caught too (see `canonicalPropertyKey`).
 */
export const WORLD_PROPERTY_SYNONYMS: Readonly<Record<string, string>> = Object.freeze({
  wet: 'wetness',
  brittle: 'fragile',
  buoyant: 'density',
  mass: 'weight',
  movable: 'pushable',
  slippery: 'friction',
  hardness: 'surfaceHardness',
  electrified: 'charge',
});

const squash = (key: string): string => key.toLowerCase().replaceAll(/[-_\s]/g, '');

/**
 * The canonical world-property key `name` stands for — a synonym (`wet` → `wetness`) or another
 * spelling (`soft_anchor` → `softAnchor`) — or undefined when it is canonical or unrelated.
 */
export function canonicalPropertyKey(name: string, keys: readonly string[]): string | undefined {
  if (Object.hasOwn(WORLD_PROPERTY_SYNONYMS, name)) return WORLD_PROPERTY_SYNONYMS[name];
  return keys.find((key) => key !== name && squash(key) === squash(name));
}

/** The loader message for unknown keys in world properties, naming the canonical key when known. */
function unknownKeyMessage(issue: z.core.$ZodRawIssue): string | undefined {
  if (issue.code !== 'unrecognized_keys') return undefined;
  return issue.keys
    .map((name) => {
      if (PROPERTY_KEYS.includes(name)) return `world property "${name}" is not allowed here`;
      const canonical = canonicalPropertyKey(name, PROPERTY_KEYS);
      return canonical === undefined
        ? `unknown world property "${name}"`
        : `"${name}" is not a world property; use the canonical key "${canonical}"`;
    })
    .join('; ');
}

/** Every world property as a data-file field; see the sim spec for defaults and meaning. */
export const worldPropertiesSchema = z
  .strictObject(
    {
      material: ref('material').describe('Material preset id (a material content entry).'),
      temperature: celsius('Current temperature,'),
      flammable: flag('Fire can ignite it.'),
      ignitionPoint: celsius('Temperature at which it ignites,'),
      fuel: z.number().min(0).max(86_400).describe('Seconds of burning left.'),
      burning: flag('On fire right now.'),
      wetness: fraction('How soaked it is (dry … saturated),'),
      frozen: flag('Frozen solid.'),
      freezePoint: celsius('Temperature at or below which it freezes,'),
      conductive: flag('Conducts electric charge.'),
      charge: z.number().min(0).max(1_000_000).describe('Stored electric charge.'),
      weight: z.number().min(0).max(1_000_000).describe('Mass, kg.'),
      fragile: z.number().min(0).max(1_000_000_000).describe('Impact energy that breaks it, J.'),
      hp: z.number().min(0).max(1_000_000).describe('Structural hit points.'),
      density: z
        .number()
        .min(0.01)
        .max(100_000)
        .describe('Density, kg/m³; below 1000 it floats in water.'),
      climbable: z
        .enum(['none', 'ladder', 'rope', 'ivy', 'rough', 'sheer'])
        .describe(
          'Climbing grade: none, ladder, rope, ivy (easy), rough (needs a climber), sheer (needs a tool).',
        ),
      liftable: flag('Can be picked up and carried.'),
      pushable: flag('Can be pushed or dragged.'),
      hideable: flag('An actor can hide in or behind it.'),
      reflective: flag('Reflects light beams and bolts.'),
      transparent: flag('Light and sight pass through it.'),
      opaque: flag('Fully blocks light and sight.'),
      lightEmitter: z
        .strictObject({
          intensity: z
            .number()
            .min(0)
            .max(100_000)
            .describe('Light output (a torch is about 100).'),
          radius: z.number().min(0).max(100).describe('Reach, m.'),
        })
        .describe('Emits light.'),
      soundDamping: fraction('Fraction of sound it absorbs,'),
      friction: z.number().min(0).max(2).describe('Surface friction coefficient.'),
      impactAbsorb: fraction('Fraction of impact energy it absorbs,'),
      owner: contentId.describe('Ownership tag (faction or owner id).'),
      liquid: flag('A liquid: it pours, puddles and can have a water surface.'),
      flammableGas: flag('A gas that ignites (flares or explodes) when fire reaches it.'),
      extinguishable: flag('A fire or light source that water, force or an interaction puts out.'),
      waterSurface: flag(
        'Top surface of a body of liquid: cold freezes it into walkable ice (needs a liquid material).',
      ),
      unstable: threshold(MAX_ENERGY, 'Force of one push, blast or quake that topples it, J.'),
      suspended: flag('Hangs from its support; falls when the support breaks, burns or is cut.'),
      support: z
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .describe('Entity a suspended object hangs from (0 = none); set when the level spawns.'),
      breakable: flag('A single hit at or above its toughness for that kind of hit breaks it.'),
      toughness: z
        .strictObject({
          blunt: energy.describe('Blunt hit energy that breaks it, J.').exactOptional(),
          slash: energy.describe('Slash hit energy that breaks it, J.').exactOptional(),
          pierce: energy.describe('Pierce hit energy that breaks it, J.').exactOptional(),
          force: energy
            .describe('Force (blast, quake, boulder) energy that breaks it, J.')
            .exactOptional(),
        })
        .describe(
          'Per kind of hit, the single-hit energy that breaks a breakable object; a kind left out never does.',
        ),
      bashable: flag('A shield bash or kick shoves it (or breaks it when breakable).'),
      cuttable: flag('Slash or pierce damage severs it.'),
      shootable: threshold(1_000_000, 'Projectile impulse that fires its signal, N·s.'),
      softAnchor: flag('Rope arrows and hooks embed in it.'),
      surfaceHardness: z
        .enum(['soft', 'medium', 'hard'])
        .describe('Footstep loudness and whether arrows stick (soft, medium) or ricochet (hard).'),
      chargeActivated: threshold(MAX_ENERGY, 'Stored charge at which the mechanism fires.'),
      lightActivated: threshold(MAX_ENERGY, 'Light level on it at which the mechanism fires.'),
      hidden: flag('Not perceivable or targetable until revealed.'),
      trapped: flag('Interacting with it triggers its trap unless disarmed first (needs a trap).'),
      trap: contentId.describe('Trap definition id a trapped object triggers.'),
      container: flag('Holds items (contents live in the e18 container component).'),
      remains: flag('Inert skeletal or corpse remains that summoning can raise.'),
      noiseMultiplier: z
        .number()
        .min(0.2)
        .max(3)
        .describe(
          "Multiplier on its wearer's noise; an actor's is the product of its equipment's.",
        ),
    },
    { error: unknownKeyMessage },
  )
  .partial()
  .describe('World properties (any subset); omitted ones take the sim defaults.');

/** Every canonical world-property key. */
const PROPERTY_KEYS: readonly string[] = Object.keys(worldPropertiesSchema.shape);

/** World properties as written in a data file (any subset). */
export type WorldPropertiesData = z.output<typeof worldPropertiesSchema>;

/**
 * `T` with optional keys that are absent rather than `undefined`: what parsed JSON holds (JSON has no
 * undefined), in the form the sim's `exactOptionalPropertyTypes` inputs require.
 */
export type Present<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/** World properties as the sim takes them (`WorldPropertyInit`): the material ref as its plain id. */
export type WorldPropertiesInit = Present<Omit<WorldPropertiesData, 'material'>> & {
  material?: string;
};

/** Converts data-file world properties to the sim's form (the material ref becomes its id). */
export function toPropertyInit(data: WorldPropertiesData): WorldPropertiesInit {
  const { material, ...rest } = data as Present<WorldPropertiesData>; // parsed JSON: no undefined
  return material === undefined ? rest : { ...rest, material: material.id };
}
