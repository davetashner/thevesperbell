// The stealth tuning content type (mw-e09.2): the weights of the visibility model, one file per table
// at `src/content/data/stealth/<id>.json` (the game has one, `stealth`). The sim's visibility rule
// (src/sim/stealth/visibility.ts) multiplies
//   light term × stance term × motion term × profile term × line-of-sight fraction × distance falloff
// so any zero term hides the target; a dark target silhouetted against bright background light gets
// the contrast bonus on its light term. The `noise` block (mw-e09.3) holds the sound propagation
// losses: door states (per door material), wall and floor transmission (per material) and the global
// audibility floor. mw-e09.6 extends this file with the gait, surface and hiding tables and the
// difficulty override whitelist.
//
// Every weight (a term or multiplier this file sets) is 0–2: 1 is neutral, below 1 hides, above 1
// reveals. Curves are piecewise-linear point lists, held flat beyond their ends; motion is banded
// (the fastest band the speed reaches applies). Light levels are the light field's 0–1 (mw-e03.15),
// speeds m/s and distances metres. Noise losses are dB gains, 0 or below (0 = no loss). The field reference in docs/content/stealth-schema.md is
// generated (`pnpm content:docs`).

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId } from '../schema.ts';

/** The game's stealth tuning (`src/content/data/stealth/stealth.json`). */
export const STEALTH_ID = 'stealth';

/** The most any visibility weight may be (AC-7: weights are validated 0–2). */
export const MAX_STEALTH_WEIGHT = 2;

/** The stances the visibility model weighs, lowest first. */
export const VISIBILITY_STANCES = ['prone', 'crouched', 'standing'] as const;

/** A stance the visibility model weighs. */
export type VisibilityStance = (typeof VISIBILITY_STANCES)[number];

const weight = z.number().min(0).max(MAX_STEALTH_WEIGHT);
const level = z.number().min(0).max(1);
const dbLevel = z.number().min(0).max(120);

const lightPointSchema = z
  .strictObject({
    level: level.describe('Light level seen by the observer, 0–1 (after dark vision).'),
    term: weight.describe('Light term at that level, 0–2.'),
  })
  .describe('One point of the light curve.');

const motionBandSchema = z
  .strictObject({
    fromSpeed: z
      .number()
      .min(0)
      .max(50)
      .describe('Horizontal speed at which this band starts, m/s; the first band starts at 0.'),
    term: weight.describe('Motion term in this band, 0–2.'),
  })
  .describe('One speed band.');

const distancePointSchema = z
  .strictObject({
    metres: z.number().min(0).max(500).describe('Observer-to-target distance, m.'),
    term: weight.describe('Distance falloff at that distance, 0–2.'),
  })
  .describe('One point of the distance falloff curve.');

const visibilitySchema = z
  .strictObject({
    light: z
      .strictObject({
        curve: z
          .array(lightPointSchema)
          .min(2)
          .describe(
            'Light term by seen light level: points in rising level order, from level 0 to level 1.',
          ),
        peakWeight: level.describe(
          'How the target’s light samples combine, 0–1: 0 = their mean, 1 = the brightest; a lit head ' +
            'on a body in shadow still shows.',
        ),
      })
      .describe(
        'Light term: the target’s light samples, combined, then lifted by the observer’s dark vision ' +
          '(seen = level + (1 − level) × darkVision, so dark vision 1 sees full light), read on the curve.',
      ),
    stance: z
      .strictObject({
        prone: weight.describe('Lying flat.'),
        crouched: weight.describe('Crouched.'),
        standing: weight.describe('Standing (1 = neutral).'),
      } satisfies Record<VisibilityStance, typeof weight>)
      .describe('Stance term per stance, 0–2.'),
    motion: z
      .array(motionBandSchema)
      .min(1)
      .describe(
        'Motion term by horizontal speed: bands in rising fromSpeed order; the fastest band the speed ' +
          'reaches applies.',
      ),
    profile: z
      .strictObject({
        cloak: weight.describe('Multiplier while a cloak or other concealing garment is worn.'),
        disguise: weight.describe('Multiplier while disguised.'),
      })
      .describe(
        'Profile modifiers on top of the equipment brightness the target supplies (both multiply).',
      ),
    distance: z
      .array(distancePointSchema)
      .min(2)
      .describe(
        'Distance falloff: points in rising distance order from 0 m, never rising; flat past the last.',
      ),
    contrast: z
      .strictObject({
        backgroundThreshold: level.describe(
          'Background light at or above which a target is silhouetted against it, 0–1.',
        ),
        darkTargetMax: level.describe(
          'The target counts as dark (a silhouette) when its own combined light is at or below this, 0–1.',
        ),
        bonus: weight.describe(
          'Added to a silhouetted target’s light term (capped at the full-light term), 0–2.',
        ),
      })
      .describe('Contrast rule: a dark figure against bright background light stands out.'),
  })
  .describe('Visibility model weights (mw-e09.2).');

/** The most any noise loss may take off, dB (a gain of −MAX_NOISE_LOSS_DB). */
export const MAX_NOISE_LOSS_DB = 120;

/** The states a portal's door can be in, loudest first (open passes sound freely). */
export const DOOR_SOUND_STATES = ['open', 'ajar', 'closed'] as const;

/** A door state noise propagation weighs. */
export type DoorSoundState = (typeof DOOR_SOUND_STATES)[number];

/** What a partition between two rooms is: a wall (side by side) or a floor/ceiling (stacked). */
export const PARTITION_KINDS = ['wall', 'floor'] as const;

/** A partition kind noise propagation weighs. */
export type PartitionKind = (typeof PARTITION_KINDS)[number];

const gainDb = z.number().min(-MAX_NOISE_LOSS_DB).max(0);

const doorMaterialSchema = z
  .strictObject({
    material: contentId.describe('Material id of the door leaf (a door profile’s `material`).'),
    open: gainDb.optional().describe('Gain while open, dB (≤ 0); omitted: the default.'),
    ajar: gainDb.optional().describe('Gain while ajar (moving or stopped part-way), dB (≤ 0).'),
    closed: gainDb.optional().describe('Gain while closed, dB (≤ 0).'),
  })
  .describe('Door gains for one leaf material; unset states use the defaults.');

const partitionMaterialSchema = z
  .strictObject({
    material: contentId.describe('Material id of the partition.'),
    wall: gainDb.optional().describe('Gain through a wall of it, dB (≤ 0); omitted: the default.'),
    floor: gainDb
      .optional()
      .describe('Gain through a floor or ceiling of it, dB (≤ 0); omitted: the default.'),
  })
  .describe('Partition gains for one material; unset kinds use the defaults.');

const noiseSchema = z
  .strictObject({
    audibleFloor: z
      .number()
      .min(0)
      .max(60)
      .describe(
        'Global audibility floor, dB: below it a sound is not heard and propagation stops searching.',
      ),
    doors: z
      .strictObject({
        open: gainDb.describe('Gain through an open (or broken) door, dB (≤ 0).'),
        ajar: gainDb.describe('Gain through a door part-way open or moving, dB (≤ 0).'),
        closed: gainDb.describe(
          'Gain through a closed door that muffles sound (`blocks.sound`), dB (≤ 0).',
        ),
        materials: z
          .array(doorMaterialSchema)
          .default([])
          .describe('Per leaf material overrides (iron muffles more than planks).'),
      } satisfies Record<DoorSoundState, typeof gainDb> & { materials: unknown })
      .describe(
        'Portal gains by door state; a closed door that does not block sound (a grille) counts as open. ' +
          'Gains must never rise from open to ajar to closed.',
      ),
    partitions: z
      .strictObject({
        wall: gainDb.describe('Default gain through a wall between side-by-side rooms, dB (≤ 0).'),
        floor: gainDb.describe(
          'Default gain through a floor or ceiling between stacked rooms, dB (≤ 0).',
        ),
        materials: z
          .array(partitionMaterialSchema)
          .default([])
          .describe('Per material overrides; a scene names a partition’s material.'),
      } satisfies Record<PartitionKind, typeof gainDb> & { materials: unknown })
      .describe('Transmission through walls and floors between adjacent rooms.'),
    impact: z
      .strictObject({
        minEnergy: z
          .number()
          .positive()
          .describe('Least impact energy, J, that makes a noise: softer settling stays silent.'),
        refEnergy: z.number().positive().describe('Energy, J, at which the curve reads `refDb`.'),
        refDb: z
          .number()
          .min(0)
          .max(120)
          .describe('Loudness, dB at 1 m, of a `refEnergy` impact on stone.'),
        dbPerDecade: z.number().positive().max(40).describe('dB gained for ten times the energy.'),
        maxDb: z.number().min(0).max(120).describe('Loudest an impact gets, dB at 1 m.'),
      })
      .describe(
        'Impact noise (mw-e03.25): loudness = refDb + dbPerDecade·log10(energy / refEnergy) plus the ' +
          'louder of the two materials’ surface loudness offsets, capped at maxDb; below minEnergy, silence.',
      ),
    footsteps: z
      .strictObject({
        gaitDb: z
          .strictObject({
            sneak: dbLevel.describe('Crouched or slow-walking step, dB at 1 m on stone (25).'),
            walk: dbLevel.describe('Walking step, dB at 1 m on stone (40).'),
            run: dbLevel.describe('Running step, dB at 1 m on stone (55).'),
            sprint: dbLevel.describe('Sprinting step, dB at 1 m on stone (65).'),
          })
          .describe('Base loudness of one step by gait, before surface and equipment.'),
        creatureGait: z
          .strictObject({
            walkFrom: z.number().min(0).max(20).describe('Speed, m/s, at which a creature steps.'),
            runFrom: z.number().min(0).max(20).describe('Speed, m/s, a creature steps as a run.'),
            sprintFrom: z
              .number()
              .min(0)
              .max(30)
              .describe('Speed, m/s, a creature steps as a sprint.'),
            stride: z
              .strictObject({
                walk: z
                  .number()
                  .positive()
                  .max(5)
                  .describe('Metres between a walking creature’s steps.'),
                run: z
                  .number()
                  .positive()
                  .max(5)
                  .describe('Metres between a running creature’s steps.'),
                sprint: z
                  .number()
                  .positive()
                  .max(5)
                  .describe('Metres between a sprinting creature’s steps.'),
              })
              .describe('Ground distance between steps per gait (the player’s: 0.75, 1.6, 2.05).'),
          })
          .describe(
            'A creature has no controller: its gait is read from the speed it moves at (patrols ' +
              'walk, chases run).',
          ),
        landing: z
          .strictObject({
            minHeight: z
              .number()
              .min(0)
              .max(10)
              .describe('Fall height, m, below which a landing is just a step: silent.'),
            curve: z
              .array(
                z.strictObject({
                  height: z.number().min(0).max(100).describe('Fall height, m.'),
                  db: dbLevel.describe('Loudness, dB at 1 m on stone, of a landing from it.'),
                }),
              )
              .min(2)
              .describe('Piecewise-linear loudness by fall height, flat beyond its ends.'),
          })
          .describe(
            'Landing impulse by fall height (the height whose free fall reaches the speed).',
          ),
      })
      .describe(
        'Footstep noise (mw-e09.5): loudness = gait dB + the surface’s offset + the wearer’s ' +
          'equipment dB (20·log10 of the noise multiplier, ADR-0003) + a creak when the board has one.',
      ),
  })
  .describe(
    'Sound propagation (mw-e09.3): a noise loses 20·log10(d) dB over a path of d metres (none ' +
      'within 1 m) plus the gain of every door, wall and floor it passes.',
  );

type NoiseFields = z.output<typeof noiseSchema>;

/** Adds an issue for a door table whose gains rise from open to closed, or a material named twice. */
function checkNoise(n: NoiseFields, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path: ['noise', ...path], message });
  };
  if (n.impact.minEnergy > n.impact.refEnergy) {
    issue(['impact', 'minEnergy'], 'minEnergy must not exceed refEnergy');
  }
  const { curve } = n.footsteps.landing;
  curve.forEach((point, i) => {
    const before = curve[i - 1];
    if (before === undefined) return;
    if (point.height <= before.height) {
      issue(['footsteps', 'landing', 'curve', i, 'height'], 'landing heights must rise');
    }
    if (point.db < before.db) {
      issue(['footsteps', 'landing', 'curve', i, 'db'], 'a landing never gets quieter with height');
    }
  });
  const { gaitDb, creatureGait } = n.footsteps;
  if (!(gaitDb.sneak <= gaitDb.walk && gaitDb.walk <= gaitDb.run && gaitDb.run <= gaitDb.sprint)) {
    issue(['footsteps', 'gaitDb'], 'gaits must never get quieter: sneak ≤ walk ≤ run ≤ sprint');
  }
  if (!(
    creatureGait.walkFrom <= creatureGait.runFrom && creatureGait.runFrom <= creatureGait.sprintFrom
  )) {
    issue(['footsteps', 'creatureGait'], 'creature gait speeds must rise: walk ≤ run ≤ sprint');
  }
  const { doors } = n;
  const ordered = (path: (string | number)[], gains: Record<DoorSoundState, number>) => {
    if (gains.ajar > gains.open || gains.closed > gains.ajar) {
      issue(path, 'door gains must never rise from open to ajar to closed');
    }
  };
  ordered(['doors'], doors);
  const seen = (list: readonly { material: string }[], path: string[]) => {
    const names = new Set<string>();
    list.forEach(({ material }, i) => {
      if (names.has(material))
        issue([...path, i, 'material'], `material "${material}" is listed twice`);
      names.add(material);
    });
  };
  seen(doors.materials, ['doors', 'materials']);
  seen(n.partitions.materials, ['partitions', 'materials']);
  doors.materials.forEach((m, i) => {
    ordered(['doors', 'materials', i], {
      open: m.open ?? doors.open,
      ajar: m.ajar ?? doors.ajar,
      closed: m.closed ?? doors.closed,
    });
  });
}

type VisibilityFields = z.output<typeof visibilitySchema>;

const whenValid = {
  when: (payload: { issues: readonly unknown[] }) => payload.issues.length === 0,
};

/** Adds an issue for every curve or band out of order, naming it. */
function checkVisibility(v: VisibilityFields, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path: ['visibility', ...path], message });
  };
  const curve = v.light.curve;
  if (curve[0]?.level !== 0 || curve.at(-1)?.level !== 1) {
    issue(['light', 'curve'], 'light.curve must start at level 0 and end at level 1');
  }
  curve.forEach((point, i) => {
    const before = curve[i - 1];
    if (before !== undefined && point.level <= before.level) {
      issue(['light', 'curve', i, 'level'], 'light.curve levels must rise');
    }
  });
  if (v.motion[0]?.fromSpeed !== 0) {
    issue(['motion', 0, 'fromSpeed'], 'the first motion band must start at 0 m/s');
  }
  v.motion.forEach((band, i) => {
    const before = v.motion[i - 1];
    if (before !== undefined && band.fromSpeed <= before.fromSpeed) {
      issue(['motion', i, 'fromSpeed'], 'motion bands must start at rising speeds');
    }
  });
  if (v.distance[0]?.metres !== 0) {
    issue(['distance', 0, 'metres'], 'the distance curve must start at 0 m');
  }
  v.distance.forEach((point, i) => {
    const before = v.distance[i - 1];
    if (before === undefined) return;
    if (point.metres <= before.metres) {
      issue(['distance', i, 'metres'], 'distance points must rise');
    }
    if (point.term > before.term) {
      issue(['distance', i, 'term'], 'distance falloff must never rise with distance');
    }
  });
}

/** Schema of one stealth tuning file, `src/content/data/stealth/<id>.json`. */
export const stealthSchema = z
  .strictObject({
    id: contentId.describe('Unique table id; the game reads "stealth".'),
    notes: z.string().min(1).describe('Where the numbers come from (bead, tuning status).'),
    visibility: visibilitySchema,
    noise: noiseSchema,
  })
  .superRefine((def, ctx) => {
    checkVisibility(def.visibility, ctx);
    checkNoise(def.noise, ctx);
  }, whenValid);

/** A stealth tuning table as written in JSON. */
export type StealthDefInput = z.input<typeof stealthSchema>;
/** A validated stealth tuning table. */
export type StealthDef = z.output<typeof stealthSchema>;
/** A loaded (deeply frozen) stealth tuning table. */
export type StealthEntry = Frozen<StealthDef>;
/** The visibility weights the sim's visibility rule reads (frozen). */
export type VisibilityTuning = Frozen<VisibilityFields>;
/** The sound propagation losses the sim's noise propagation reads (frozen). */
export type NoiseTuning = Frozen<NoiseFields>;
