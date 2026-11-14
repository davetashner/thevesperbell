// Material presets (mw-e03.2). A designer marks a crate "wood" and gets sensible flammability,
// density, friction, sound and fragility for free; the object's own values override the preset, and
// anything neither sets takes the global property default (src/sim/properties/spec.ts). Presets hold
// only what belongs to the material itself: object-level facts (weight, liftable, owner…) and
// transient state (burning, charge) stay on the object. Because a preset is the complete description
// of a material, it is checked for physically inconsistent combinations that a sparse per-object
// override can't be (a flammable material with no ignition point, a frozen one above its freezing
// point). Every value is explained in the entry's `notes` so the owner can review the numbers;
// docs/design/materials.md is generated from the data (`pnpm content:docs`). A flammable material
// also says what fire leaves of it (mw-e03.5): another material (wood → charred) or nothing. Every
// preset declares its surfaceHardness and softAnchor (mw-e03.31).

import { z } from 'zod';
import { contentId, ref, type ContentRef } from '../schema.ts';
import { worldPropertiesSchema, type Present } from '../world-properties.ts';

/** Footstep loudness offset range, dB relative to stone (matches e09 surface acoustics). */
export const FOOTSTEP_LOUDNESS_RANGE = { min: -20, max: 20 } as const;

/**
 * Footstep surface ids (audio bible §7.3; they must match the sim's acoustic surface table, e09). A
 * material names the surface its footsteps sound like; footstep cue sheets play `sfx-foot-<surface>-…`.
 */
export const FOOTSTEP_SURFACES = [
  'stone',
  'wood',
  'wood-hollow',
  'dirt',
  'grass',
  'gravel',
  'mud',
  'water-shallow',
  'snow-ice',
  'metal-grate',
  'straw',
  'carpet',
  'bone-litter',
  'leaves',
  'glass-shards',
] as const;
/** A footstep surface id. */
export type FootstepSurface = (typeof FOOTSTEP_SURFACES)[number];

/** Impact sound set ids: `sfx-impact-<material>` (audio bible §6, §7.2); variants picked at runtime. */
export const IMPACT_SOUND_PATTERN = /^sfx-impact-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * World properties a preset may set: everything except the id itself, live state, and facts about one
 * object rather than its material — ownership, placement (hidden, trapped, hanging, a pool's surface),
 * what it is used as (container, remains, a mechanism input, a light source) and how it is built
 * (bashable, unstable). Every preset must say how hard its surface is and whether rope arrows embed
 * in it (mw-e03.31), since archery and footsteps read both on every surface.
 */
const presetFields = worldPropertiesSchema
  .omit({
    material: true,
    owner: true,
    burning: true,
    charge: true,
    hidden: true,
    trapped: true,
    trap: true,
    suspended: true,
    support: true,
    waterSurface: true,
    container: true,
    remains: true,
    chargeActivated: true,
    lightActivated: true,
    shootable: true,
    extinguishable: true,
    bashable: true,
    unstable: true,
    noiseMultiplier: true,
  })
  .extend({
    surfaceHardness: worldPropertiesSchema.shape.surfaceHardness.unwrap(),
    softAnchor: worldPropertiesSchema.shape.softAnchor.unwrap(),
  });

type PresetFields = z.output<typeof presetFields>;

/** Adds an issue for every physically inconsistent combination in a preset's properties. */
function checkConsistency(p: PresetFields, ctx: z.RefinementCtx): void {
  const issue = (path: keyof PresetFields, message: string) => {
    ctx.addIssue({ code: 'custom', path: [path], message });
  };
  if (p.flammable === true) {
    if (p.ignitionPoint === undefined) {
      issue('ignitionPoint', 'a flammable material needs an ignitionPoint');
    }
    if (p.fuel === undefined || p.fuel === 0) {
      issue('fuel', 'a flammable material needs fuel > 0');
    }
  } else if (p.ignitionPoint !== undefined || p.fuel !== undefined) {
    issue('flammable', 'ignitionPoint and fuel only apply to a flammable material');
  }
  if (p.transparent === true && p.opaque === true) {
    issue('opaque', 'a material cannot be both transparent and opaque');
  }
  if (
    p.frozen === true &&
    (p.temperature === undefined || p.freezePoint === undefined || p.temperature > p.freezePoint)
  ) {
    issue('temperature', 'a frozen material needs a temperature at or below its freezePoint');
  }
}

/** A preset's world-property values (any consistent subset). */
export const materialPropertiesSchema = presetFields
  .superRefine(checkConsistency)
  .describe(
    'World-property defaults for objects of this material; omitted ones take the global default.',
  );

/** What a burnt-out object becomes: `destroyed` (it burns away) or another material's id. */
export const BURNT_DESTROYED = 'destroyed';

/** A material's burnt state (see BURNT_DESTROYED). */
export const burntStateSchema = z
  .union([z.literal(BURNT_DESTROYED), ref('material')])
  .describe(
    'Flammable materials only: what fire leaves when the fuel is spent: "destroyed" (it burns away) or the id of the material it becomes (e.g. "charred").',
  );

/** Flammable materials must say what they burn to; others must not. */
function checkBurnt(m: { properties: PresetFields; burnt?: unknown }, ctx: z.RefinementCtx): void {
  const flammable = m.properties.flammable === true;
  if (flammable && m.burnt === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['burnt'],
      message: 'a flammable material needs a burnt state',
    });
  } else if (!flammable && m.burnt !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['burnt'],
      message: 'only a flammable material has a burnt state',
    });
  }
}

/** One material preset: `src/content/data/material/<id>.json`. */
export const materialSchema = z
  .strictObject({
    id: contentId,
    name: z.string().min(1).describe('Display name (editor and docs).'),
    notes: z
      .string()
      .min(1)
      .describe('Why these values (sources, units, design intent), for owner review.'),
    footstepLoudness: z
      .number()
      .min(FOOTSTEP_LOUDNESS_RANGE.min)
      .max(FOOTSTEP_LOUDNESS_RANGE.max)
      .describe('Footstep loudness offset relative to stone, dB.'),
    footstepSurface: z
      .enum(FOOTSTEP_SURFACES)
      .optional()
      .describe(
        'Footstep surface (audio bible §7.3) walking on it sounds like, e.g. "wood"; absent = no ' +
          'footstep set yet (footsteps fall back to stone and warn once in dev).',
      ),
    impactSound: z
      .string()
      .regex(IMPACT_SOUND_PATTERN, 'must be an impact sound set id, e.g. "sfx-impact-wood"')
      .describe('Impact sound set id (audio bible §7.2), e.g. "sfx-impact-wood".'),
    properties: materialPropertiesSchema,
    burnt: burntStateSchema.optional(),
  })
  .superRefine(checkBurnt);

/** A material preset as written in a data file. */
export type MaterialDefInput = z.input<typeof materialSchema>;
/** A loaded material preset. */
export type MaterialDef = z.output<typeof materialSchema>;
/** A preset's world-property values (absent keys, never `undefined` ones). */
export type MaterialProperties = Present<z.output<typeof materialPropertiesSchema>>;

/**
 * Material id → preset property values, the lookup the sim's `applyMaterial` takes. Pass the loaded
 * entries, e.g. `materialPresets(content.all('material'))`.
 */
export function materialPresets(
  materials: readonly Pick<MaterialDef, 'id' | 'properties'>[],
): ReadonlyMap<string, MaterialProperties> {
  // Parsed JSON never holds an explicit undefined, so the properties are already `Present`.
  return new Map(materials.map((m) => [m.id, m.properties as MaterialProperties]));
}

/**
 * Material id → surface loudness offset, dB relative to stone (its `footstepLoudness`): how much
 * louder than stone it rings when something hits it (mw-e03.25).
 */
export function materialLoudness(
  materials: readonly Pick<MaterialDef, 'id' | 'footstepLoudness'>[],
): ReadonlyMap<string, number> {
  return new Map(materials.map((m) => [m.id, m.footstepLoudness]));
}

/**
 * Material id → what it becomes when it burns out: a material id, or null when it burns away. The
 * lookup the sim's fire rules take (`fireRules({ burnt })`); non-flammable materials are absent.
 */
export function burntMaterials(
  materials: readonly Pick<MaterialDef, 'id' | 'burnt'>[],
): ReadonlyMap<string, string | null> {
  const entries: [string, string | null][] = [];
  for (const { id, burnt } of materials) {
    if (burnt === undefined) continue;
    entries.push([id, typeof burnt === 'string' ? null : (burnt as ContentRef).id]);
  }
  return new Map(entries);
}
