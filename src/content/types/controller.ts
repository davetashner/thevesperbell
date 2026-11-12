// Character controller tuning (mw-e02.2): the numbers behind how the player moves. Feel is found by
// iteration, so every speed, acceleration time, jump height and timing window the kinematic
// controller (src/sim/character) reads lives here as data, not in code. One file per profile,
// `src/content/data/controller/<id>.json`; the player uses `player`.
//
// Per-class overrides (mw-e02.3): a profile's `classes` holds, per class, only the values that class
// changes (the thief crouches faster); `controllerTuningFor` merges one over the profile, so every
// other value comes from the base. Each merged class profile is validated like the base, so a bad
// override fails the load with its path (`classes.thief.speeds.crouch`). Armor load effects are not
// overrides: they are modifiers on top of whichever profile applies (ADR-0003, mw-e17.13).
// The `stealth` block (mw-e02.10) holds the slow walk and the normalised noise and visibility of every
// stance × gait; the sim publishes them as each character's MovementProfile for stealth (mw-e09).
// The debug console's ctl.get / ctl.set / ctl.dump (src/tools/console/controller.ts) edit the live
// values, and in dev a saved controller file is applied without a page reload.
//
// Units: metres, seconds, metres per second, metres per second squared, degrees; the two input
// timing windows are whole milliseconds so the sim converts them to ticks with `ReadonlyClock.ticksFor`.

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId } from '../schema.ts';

/** The longest coyote time the design allows (mw-e02.2: ≤ 120 ms). */
export const MAX_COYOTE_MS = 120;
/** The longest jump buffer the design allows (mw-e02.2: ≤ 150 ms). */
export const MAX_JUMP_BUFFER_MS = 150;

const metres = z.number().positive();
const speed = z.number().positive().max(50);
const seconds = z.number().positive().max(2);

const capsuleSchema = z
  .strictObject({
    radius: metres.max(1).describe('Capsule radius, m.'),
    height: metres
      .max(4)
      .describe('Standing capsule height, feet to crown, m; at least 2 × radius.'),
    crouchHeight: metres
      .max(4)
      .describe(
        'Crouched capsule height, m; at least 2 × radius and at most height. The feet stay put, the top lowers.',
      ),
  })
  .describe('The player’s collision capsule (vertical, feet at the character position).');

const speedsSchema = z
  .strictObject({
    run: speed.describe('Top speed with the move input fully deflected, m/s. Partial input walks.'),
    sprint: speed.describe('Top speed while sprint is held, m/s; at least run.'),
    crouch: speed.describe('Top speed while crouched, m/s; at most run.'),
  })
  .describe('Top ground speeds, m/s. Analog input scales them (half deflection = half speed).');

const footstepSchema = z
  .strictObject({
    walk: metres.max(5).describe('Walking, m.'),
    run: metres.max(5).describe('Running, m.'),
    sprint: metres.max(5).describe('Sprinting, m.'),
    crouch: metres.max(5).describe('Crouching, m.'),
  })
  .describe(
    'Ground distance between footsteps per gait, m (half a stride): footstep events come from the ' +
      'distance travelled, not from animation.',
  );

/**
 * How the sim names what the character is doing (mw-e02.6): the speeds at which the published
 * locomotion state turns from idle to walk to run, how long a hard landing shows, and how far apart
 * footsteps fall. Presentation reads these states and events; movement itself never does.
 */
export const gaitTuningSchema = z
  .strictObject({
    walkFrom: z
      .number()
      .positive()
      .max(10)
      .describe(
        'Horizontal speed from which a character with move input walks (below: idle), m/s.',
      ),
    runFrom: z
      .number()
      .positive()
      .max(20)
      .describe('Horizontal speed from which it runs (below: walk), m/s; above walkFrom.'),
    landingMs: z
      .int()
      .min(0)
      .max(1000)
      .describe('How long the landing state lasts after a hard landing, whole ms.'),
    hardLanding: z
      .number()
      .min(0)
      .max(50)
      .describe('Impact speed from which a landing counts as hard (shows the landing state), m/s.'),
    footstep: footstepSchema,
  })
  .describe(
    'Locomotion states and events (mw-e02.6): gait speed thresholds, landing and footstep spacing.',
  );

/** Gait thresholds, landing and footstep spacing (see gaitTuningSchema). */
export type GaitTuning = z.output<typeof gaitTuningSchema>;

/** The longest landing recovery after a staggering launch the design allows, ms. */
export const MAX_LAUNCH_RECOVERY_MS = 1000;

export const launchTuningSchema = z
  .strictObject({
    airControl: z
      .number()
      .min(0)
      .max(1)
      .describe(
        'Share of ground acceleration available while flying from an impulse the player chose (a self-cast Gust), 0–1; a staggering launch (a blast, a troll’s blow) has none.',
      ),
    recoveryMs: z
      .int()
      .min(0)
      .max(MAX_LAUNCH_RECOVERY_MS)
      .describe(
        `After a staggering launch lands, movement and jump input are ignored this long, whole ms (≤ ${String(MAX_LAUNCH_RECOVERY_MS)}).`,
      ),
    mass: z
      .number()
      .positive()
      .max(1000)
      .describe(
        'The character’s mass for force stimuli (its `weight` world property), kg: a blast’s impulse in N·s over this is the velocity change it gets.',
      ),
  })
  .describe(
    'Being thrown by an impulse (mw-e02.15): explosions, Gust, Thunderclap and heavy blows launch the character into a ragdoll-free airborne state.',
  );

/** How being thrown handles (see launchTuningSchema). */
export type LaunchTuning = z.output<typeof launchTuningSchema>;

const heightM = z.number().positive().max(5);
const traversalMs = z.int().min(1).max(3000);

export const ledgeTuningSchema = z
  .strictObject({
    autoMantleHeight: heightM.describe(
      'Ledges up to this high above the feet are mantled by walking into them, no jump needed, m.',
    ),
    mantleHeight: heightM.describe(
      'Ledges up to this high are mantled by pressing jump at them (every class), m; at least autoMantleHeight.',
    ),
    hangReach: heightM.describe(
      'Highest ledge above the feet a grab reaches (ledge hang, capability-gated), m; at least mantleHeight.',
    ),
    hangDepth: heightM.describe(
      'How far below the ledge top the feet hang, m; at most hangReach. Grabs lower than this pull straight up.',
    ),
    reach: z
      .number()
      .positive()
      .max(3)
      .describe(
        'How far ahead of the capsule a jump press finds a ledge to mantle or grab from the ground, m.',
      ),
    grabReach: z
      .number()
      .positive()
      .max(1)
      .describe(
        'How far ahead of the capsule hands catch a ledge in the air, or walking into one (auto-mantle), m.',
      ),
    maxTopSlope: z
      .number()
      .min(0)
      .lt(90)
      .describe('Steepest ledge top a mantle stands on, degrees.'),
    autoMantleMs: traversalMs.describe(
      'Duration of a mantle onto a ledge up to autoMantleHeight, whole ms.',
    ),
    mantleMs: traversalMs.describe('Duration of a mantle onto a higher ledge, whole ms.'),
    pullUpMs: traversalMs.describe(
      'Duration of a pull-up from a hang (or a catch low on a ledge), whole ms.',
    ),
    grabMs: traversalMs.describe('Duration of catching a ledge into a hang, whole ms.'),
    lowerMs: traversalMs.describe('Duration of lowering over an edge into a hang, whole ms.'),
    shimmySpeed: z
      .number()
      .positive()
      .max(10)
      .describe('Sideways speed while hanging, at full stick deflection, m/s.'),
    shimmyGap: z
      .number()
      .min(0)
      .max(2)
      .describe('Widest gap between ledges a shimmy crosses, m; wider gaps stop it.'),
    slipGraceMs: z
      .int()
      .min(0)
      .max(10_000)
      .describe(
        'How long hands hold a ledge that became impossible to hold (frozen, burning) before the character drops, whole ms.',
      ),
    jumpBack: z
      .strictObject({
        away: z.number().min(0).max(20).describe('Speed away from the wall, m/s.'),
        up: z.number().min(0).max(20).describe('Upward speed, m/s.'),
      })
      .describe('Jumping off a hang, away from the wall.'),
  })
  .describe(
    'Mantling and ledge hangs (mw-e02.12): heights, reach, sim-driven move durations, shimmy and slipping.',
  );

/** Mantle and ledge-hang tuning (see ledgeTuningSchema). */
export type LedgeTuning = z.output<typeof ledgeTuningSchema>;

const climbSpeed = z.number().positive().max(10);

/** The climbing grades (the `climbable` world property without `none`), in the order they are listed. */
export const CLIMB_GRADES = ['ladder', 'rope', 'ivy', 'rough', 'sheer'] as const;

export const climbTuningSchema = z
  .strictObject({
    speeds: z
      .strictObject({
        ladder: climbSpeed.describe('Climbing speed on a ladder, m/s.'),
        rope: climbSpeed.describe('Climbing speed on a rope, m/s.'),
        ivy: climbSpeed.describe('Climbing speed on ivy, m/s.'),
        rough: climbSpeed.describe('Climbing speed on rough stone or timber, m/s.'),
        sheer: climbSpeed.describe('Climbing speed on a sheer face (with a tool), m/s.'),
      })
      .describe(
        'Surface-space speed per climbing grade at full stick deflection, m/s (a frozen surface climbs at its own grade’s speed).',
      ),
    walkOn: z
      .array(z.enum(CLIMB_GRADES))
      .describe(
        'Grades a character attaches to by walking into them; every other grade needs a jump at it (or a catch in the air), so bumping a stone wall never starts a climb.',
      ),
    reach: z
      .number()
      .positive()
      .max(1)
      .describe('How far ahead of the capsule a surface or rope can be caught, m.'),
    handHeight: heightM.describe(
      'Hands above the feet while climbing, m: the surface must reach this high, and a ledge this high above the feet is pulled up onto.',
    ),
    maxCornerAngle: z
      .number()
      .min(0)
      .max(90)
      .describe('Sharpest turn between two faces a climber follows round a corner, degrees.'),
    slipGraceMs: z
      .int()
      .min(0)
      .max(10_000)
      .describe(
        'How long a climber holds a surface that became impossible to hold (frozen, burning) before falling, whole ms.',
      ),
    staminaPerSecond: z
      .number()
      .min(0)
      .max(1000)
      .describe(
        'Stamina drained while climbing (characters with a stamina pool), stamina/s; at 0 stamina the climber falls. Progression may change it (mw-e10.9).',
      ),
    staminaByDifficulty: z
      .tuple([z.number().min(0).max(10), z.number().min(0).max(10), z.number().min(0).max(10)])
      .optional()
      .describe(
        'Multiplier on staminaPerSecond for climb difficulty 1, 2 and 3 (ladders, ropes and ivy / rough stone and timber / sheer faces), so harder climbs tire faster (mw-e10.9); absent = 1, 1.5 and 2.',
      ),
    jumpOff: z
      .strictObject({
        away: z.number().min(0).max(20).describe('Speed away from the surface, m/s.'),
        up: z.number().min(0).max(20).describe('Upward speed, m/s.'),
      })
      .describe('Jumping off a climbed surface.'),
  })
  .describe(
    'Climbing ladders, ropes, ivy and rough walls (mw-e02.13): speeds per grade, what attaches by walking, reach, corners, slipping, stamina and the jump off.',
  );

/** Climbing tuning (see climbTuningSchema). */
export type ClimbTuning = z.output<typeof climbTuningSchema>;

const waterSpeed = z.number().positive().max(10);

export const waterTuningSchema = z
  .strictObject({
    wadeDepth: z
      .number()
      .positive()
      .max(2)
      .describe('Water at least this deep at the feet slows the character to a wade, m.'),
    swimDepth: z
      .number()
      .positive()
      .max(3)
      .describe(
        'Water deeper than this at the feet is swum in (light and medium load) or sunk in (heavy and overloaded), m.',
      ),
    sinkFromLoadClass: z
      .enum(['light', 'medium', 'heavy', 'overloaded'])
      .describe(
        'The lightest armor load class that sinks in deep water (medium: the owner’s "going in the river makes you sink with all the armor"); lighter loads swim.',
      ),
    wadeScale: z
      .number()
      .positive()
      .max(1)
      .describe('Wading speed as a share of the run speed (no sprint while wading), 0–1.'),
    swimSpeed: z
      .strictObject({
        light: waterSpeed.describe('Swim speed at light load, m/s.'),
        medium: waterSpeed.describe('Swim speed at medium load, m/s.'),
      })
      .describe('Swim speed per armor load class (heavy and overloaded sink, they do not swim).'),
    swimAccelTime: z
      .number()
      .positive()
      .max(5)
      .describe('Time for a swimmer to reach full speed and to stop, s.'),
    staminaPerSecond: z
      .strictObject({
        light: z
          .number()
          .min(0)
          .max(1000)
          .describe('Stamina drained while swimming at light load, stamina/s.'),
        medium: z
          .number()
          .min(0)
          .max(1000)
          .describe('Stamina drained while swimming at medium load, stamina/s.'),
      })
      .describe(
        'Stamina drained while swimming (characters with a stamina pool); none for heavy loads, which sink.',
      ),
    floatDepth: z
      .number()
      .positive()
      .max(3)
      .describe(
        'How far below the surface a floating swimmer’s feet hang, m (the head stays above).',
      ),
    diveSpeed: waterSpeed.describe('Descent speed of a swimmer who dives (crouch held), m/s.'),
    riseSpeed: waterSpeed.describe('Speed a swimmer floats back up to the surface, m/s.'),
    sinkSpeed: waterSpeed.describe(
      'Speed a heavily loaded character descends through deep water, m/s.',
    ),
    sinkScale: z
      .number()
      .positive()
      .max(1)
      .describe(
        'Walking speed along the bottom for a character that sank, as a share of the run speed, 0–1.',
      ),
    headHeight: z
      .number()
      .positive()
      .max(3)
      .describe(
        'Height of the mouth above the feet, m: breath runs out while the surface is above it.',
      ),
    breathSeconds: z
      .number()
      .positive()
      .max(600)
      .describe('Breath underwater before drowning starts (20 by the design), s.'),
    breathRecoverSeconds: z
      .number()
      .positive()
      .max(600)
      .describe('Time for an empty breath meter to refill once the head is above water, s.'),
    drowning: z
      .strictObject({
        intervalMs: z
          .int()
          .min(100)
          .max(60_000)
          .describe('Time between drowning damage events once breath has run out, whole ms.'),
        damage: z
          .number()
          .min(0)
          .max(10_000)
          .describe(
            'Placeholder damage per drowning event until the damage model (e04) prices it, points.',
          ),
      })
      .describe('What running out of breath does.'),
  })
  .describe(
    'Wading, swimming, sinking and breath (mw-e02.14): depths, speeds per load class, floating, breath and the drowning hook. Placeholder values to tune in play.',
  );

/** Water tuning (see waterTuningSchema). */
export type WaterTuning = z.output<typeof waterTuningSchema>;

/** The stances a movement profile names (mw-e02.10). */
export const MOVEMENT_STANCES = ['standing', 'crouched'] as const;

/** A stance. */
export type MovementStance = (typeof MOVEMENT_STANCES)[number];

/** The gaits a movement profile names (mw-e02.10), quietest moving gait first after `still`. */
export const STEALTH_GAITS = ['still', 'slowWalk', 'walk', 'run', 'sprint'] as const;

/** A gait of the movement profile. */
export type StealthGait = (typeof STEALTH_GAITS)[number];

const multiplier = z.number().min(0).max(1);

const stanceGaitSchema = z
  .strictObject({
    noise: multiplier.describe(
      'Footstep noise multiplier, 0–1 (stand-sprint is 1): what stealth noise (mw-e09.5) scales by.',
    ),
    visibility: multiplier.describe(
      'Visibility multiplier, 0–1 (stand-sprint is 1): what visibility scoring (mw-e09.2) scales by.',
    ),
  })
  .describe('Normalised noise and visibility of one stance at one gait.');

const stanceRowShape = Object.fromEntries(
  STEALTH_GAITS.map((gait) => [gait, stanceGaitSchema.describe(`At the ${gait} gait.`)]),
) as Record<StealthGait, typeof stanceGaitSchema>;

const stanceRowSchema = z.strictObject(stanceRowShape);

const stanceTableSchema = z
  .strictObject(
    Object.fromEntries(
      MOVEMENT_STANCES.map((stance) => [stance, stanceRowSchema.describe(`Every gait ${stance}.`)]),
    ) as Record<MovementStance, typeof stanceRowSchema>,
  )
  .describe('Noise and visibility for every stance × gait (every combination must be defined).');

/** What the state of the ground adds to a footstep's loudness (mw-e02.11). */
export const footstepSurfacesSchema = z
  .strictObject({
    wetFrom: z
      .number()
      .min(0)
      .max(1)
      .describe('Wetness at or above which a step on the ground counts as wet, 0–1.'),
    wetDb: z
      .number()
      .min(-20)
      .max(20)
      .describe('What a wet surface adds to the material’s footstep loudness (splash, slap), dB.'),
    frozenDb: z
      .number()
      .min(-20)
      .max(20)
      .describe('What frozen ground adds to the material’s footstep loudness (crunch), dB.'),
  })
  .describe(
    'Footstep loudness by ground state (mw-e02.11): surface dB = the material’s footstepLoudness ' +
      'plus wetDb when wet plus frozenDb when frozen; loudness = noise × 10^(dB/20).',
  );

/** Wet and frozen ground footstep tuning (see footstepSurfacesSchema). */
export type FootstepSurfaces = z.output<typeof footstepSurfacesSchema>;

export const stealthTuningSchema = z
  .strictObject({
    slowWalk: z
      .strictObject({
        speed: speed.describe(
          'Top speed while the slow-walk modifier is held, m/s; at most speeds.crouch.',
        ),
        deflection: z
          .number()
          .gt(0)
          .lt(1)
          .describe(
            'Move-stick deflection at or below which moving counts as a slow walk (a light stick), 0–1.',
          ),
      })
      .describe('The slow walk: the quietest gait, from the modifier or a light stick.'),
    profiles: stanceTableSchema,
    surfaces: footstepSurfacesSchema
      .optional()
      .describe(
        'How wet and frozen ground changes footstep loudness; absent = the sim’s defaults.',
      ),
  })
  .describe(
    'Movement profiles for stealth (mw-e02.10): the slow walk and the noise and visibility of every stance × gait.',
  );

/** Stealth movement tuning (see stealthTuningSchema). */
export type StealthTuning = z.output<typeof stealthTuningSchema>;

/** Every tuning value the controller reads (a profile without its id, name and notes). */
const tuningShape = {
  capsule: capsuleSchema,
  speeds: speedsSchema,
  accelTime: seconds.describe('Time to reach run speed from rest on the ground, s.'),
  decelTime: seconds.describe(
    'Time to stop from run speed on the ground once input is released, s.',
  ),
  airControl: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Share of ground acceleration available in the air, 0–1; with no input the player keeps momentum.',
    ),
  gravity: z.number().positive().max(100).describe('Downward acceleration, m/s².'),
  maxFallSpeed: speed.describe('Terminal falling speed, m/s.'),
  jumpApex: metres.max(5).describe('Jump height from standing, feet to feet, m.'),
  coyoteMs: z
    .int()
    .min(0)
    .max(MAX_COYOTE_MS)
    .describe(
      `After walking off a ledge a jump still works for this long, whole ms (≤ ${String(MAX_COYOTE_MS)}).`,
    ),
  jumpBufferMs: z
    .int()
    .min(0)
    .max(MAX_JUMP_BUFFER_MS)
    .describe(
      `A jump pressed this long before landing fires on landing, whole ms (≤ ${String(MAX_JUMP_BUFFER_MS)}).`,
    ),
  stepHeight: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Tallest step walked up without jumping, m; also how far the player snaps down to stay on stairs and ramps. Below crouchHeight.',
    ),
  slopeLimit: z
    .number()
    .gt(0)
    .lt(90)
    .describe('Steepest walkable slope, degrees; steeper ground is a wall the player slides off.'),
  gait: gaitTuningSchema
    .optional()
    .describe('Locomotion states and events; absent = the sim’s defaults (DEFAULT_GAIT_TUNING).'),
  launch: launchTuningSchema
    .optional()
    .describe('Being thrown by an impulse; absent = the sim’s defaults (DEFAULT_LAUNCH_TUNING).'),
  ledge: ledgeTuningSchema
    .optional()
    .describe('Mantling and ledge hangs; absent = the sim’s defaults (DEFAULT_LEDGE_TUNING).'),
  climb: climbTuningSchema
    .optional()
    .describe('Climbing surfaces and ropes; absent = the sim’s defaults (DEFAULT_CLIMB_TUNING).'),
  stealth: stealthTuningSchema
    .optional()
    .describe(
      'MovementStance and gait movement profiles; absent = the sim’s defaults (DEFAULT_STEALTH_TUNING).',
    ),
  water: waterTuningSchema
    .optional()
    .describe('Wading, swimming and breath; absent = the sim’s defaults (DEFAULT_WATER_TUNING).'),
};

/**
 * Runs a cross-field check only once every field passed its own bounds, so one bad value is reported
 * once (the same guard as locomotion.ts).
 */
const whenValid = {
  when: (payload: { issues: readonly unknown[] }) => payload.issues.length === 0,
};

type TuningFields = z.output<z.ZodObject<typeof tuningShape>>;

/** Adds an issue for every inconsistency between fields, naming them. */
function checkTuning(t: TuningFields, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path, message });
  };
  const { radius, height, crouchHeight } = t.capsule;
  if (height < 2 * radius) {
    issue(
      ['capsule', 'height'],
      `capsule.height (${String(height)} m) must be at least 2 × radius`,
    );
  }
  if (crouchHeight < 2 * radius || crouchHeight > height) {
    issue(
      ['capsule', 'crouchHeight'],
      `capsule.crouchHeight (${String(crouchHeight)} m) must be between 2 × radius and height`,
    );
  }
  if (t.speeds.sprint < t.speeds.run) {
    issue(['speeds', 'sprint'], 'speeds.sprint must not be lower than speeds.run');
  }
  if (t.speeds.crouch > t.speeds.run) {
    issue(['speeds', 'crouch'], 'speeds.crouch must not be higher than speeds.run');
  }
  if (t.stepHeight >= crouchHeight) {
    issue(['stepHeight'], 'stepHeight must be lower than capsule.crouchHeight');
  }
  if (t.stealth !== undefined && t.stealth.slowWalk.speed > t.speeds.crouch) {
    issue(
      ['stealth', 'slowWalk', 'speed'],
      'stealth.slowWalk.speed must not be higher than speeds.crouch',
    );
  }
  if (t.gait !== undefined && t.gait.runFrom <= t.gait.walkFrom) {
    issue(['gait', 'runFrom'], 'gait.runFrom must be higher than gait.walkFrom');
  }
  const { ledge } = t;
  if (ledge !== undefined) {
    if (ledge.autoMantleHeight <= t.stepHeight) {
      issue(['ledge', 'autoMantleHeight'], 'ledge.autoMantleHeight must be higher than stepHeight');
    }
    if (ledge.mantleHeight < ledge.autoMantleHeight) {
      issue(
        ['ledge', 'mantleHeight'],
        'ledge.mantleHeight must not be lower than autoMantleHeight',
      );
    }
    if (ledge.hangReach < ledge.mantleHeight) {
      issue(['ledge', 'hangReach'], 'ledge.hangReach must not be lower than mantleHeight');
    }
    if (ledge.hangDepth > ledge.hangReach) {
      issue(['ledge', 'hangDepth'], 'ledge.hangDepth must not be higher than hangReach');
    }
  }
}

/** Controller tuning without the entry fields: what the sim's controller reads. */
export const controllerTuningSchema = z
  .strictObject(tuningShape)
  .superRefine(checkTuning, whenValid);

/** Validated controller tuning (the sim reads it frozen). */
export type ControllerTuning = z.output<typeof controllerTuningSchema>;

/** The four playable classes (CONSTITUTION §1), which may each override controller values. */
export const PLAYER_CLASSES = ['knight', 'archer', 'sorcerer', 'thief'] as const;

/** A playable class. */
export type PlayerClass = (typeof PLAYER_CLASSES)[number];

/**
 * A class's changes to a profile: any tuning value, nested objects merged field by field (arrays are
 * replaced whole). Bounds and units are those of the base fields; the merged profile is validated.
 */
export const controllerOverrideSchema = z
  .strictObject(tuningShape)
  .partial()
  .extend({
    capsule: capsuleSchema.partial().optional(),
    speeds: speedsSchema.partial().optional(),
    gait: gaitTuningSchema
      .partial()
      .extend({ footstep: footstepSchema.partial().optional() })
      .optional(),
    launch: launchTuningSchema.partial().optional(),
    ledge: ledgeTuningSchema
      .partial()
      .extend({ jumpBack: ledgeTuningSchema.shape.jumpBack.partial().optional() })
      .optional(),
    climb: climbTuningSchema
      .partial()
      .extend({
        speeds: climbTuningSchema.shape.speeds.partial().optional(),
        jumpOff: climbTuningSchema.shape.jumpOff.partial().optional(),
      })
      .optional(),
    water: waterTuningSchema
      .partial()
      .extend({
        swimSpeed: waterTuningSchema.shape.swimSpeed.partial().optional(),
        staminaPerSecond: waterTuningSchema.shape.staminaPerSecond.partial().optional(),
        drowning: waterTuningSchema.shape.drowning.partial().optional(),
      })
      .optional(),
    stealth: stealthTuningSchema
      .partial()
      .extend({
        slowWalk: stealthTuningSchema.shape.slowWalk.partial().optional(),
        surfaces: footstepSurfacesSchema.partial().optional(),
        profiles: z
          .strictObject(
            Object.fromEntries(
              MOVEMENT_STANCES.map((stance) => [
                stance,
                z
                  .strictObject(
                    Object.fromEntries(
                      STEALTH_GAITS.map((gait) => [gait, stanceGaitSchema.partial().optional()]),
                    ),
                  )
                  .partial()
                  .optional(),
              ]),
            ),
          )
          .partial()
          .optional(),
      })
      .optional(),
  })
  .describe(
    'Values one class changes; every value it leaves out comes from the base profile (mw-e02.3).',
  );

/** A class's changes to a controller profile (see controllerOverrideSchema). */
export type ControllerOverride = z.output<typeof controllerOverrideSchema>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `base` with `override` merged over it: objects field by field, everything else replaced. */
function mergeDeep(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) return override;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) merged[key] = mergeDeep(base[key], value);
  return merged;
}

/**
 * `base` with a class override merged over it (see controllerOverrideSchema). Not validated: the
 * load validates every class's merged profile (controllerSchema), the console validates its edits.
 */
export function mergeControllerTuning(
  base: Frozen<ControllerTuning>,
  override: Frozen<ControllerOverride>,
): Frozen<ControllerTuning> {
  return mergeDeep(base, override) as Frozen<ControllerTuning>;
}

const ENTRY_FIELDS = new Set(['$schema', 'id', 'name', 'notes', 'classes']);

/** A profile's tuning values without its entry fields (id, name, notes, classes). */
export function tuningOf(profile: Frozen<ControllerTuning>): Frozen<ControllerTuning> {
  return Object.fromEntries(
    Object.entries(profile).filter(([key]) => !ENTRY_FIELDS.has(key)),
  ) as Frozen<ControllerTuning>;
}

function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * The tuning a character of class `playerClass` moves with: the profile's values with that class's
 * override merged over them (all of the base when the class has none, or with no class). A new,
 * deep-frozen object holding only tuning values.
 */
export function controllerTuningFor(
  profile: Frozen<ControllerDef>,
  playerClass?: PlayerClass,
): Frozen<ControllerTuning> {
  const override = playerClass === undefined ? undefined : profile.classes?.[playerClass];
  const base = structuredClone(tuningOf(profile));
  return freeze(override === undefined ? base : mergeControllerTuning(base, override));
}

/** Adds an issue for every class whose merged profile is invalid, under `classes.<class>`. */
function checkClasses(
  def: TuningFields & {
    readonly classes?: Partial<Record<PlayerClass, ControllerOverride>> | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  for (const playerClass of PLAYER_CLASSES) {
    const override = def.classes?.[playerClass];
    if (override === undefined) continue;
    const merged = mergeControllerTuning(tuningOf(def), override);
    for (const issue of controllerTuningSchema.safeParse(merged).error?.issues ?? []) {
      ctx.addIssue({
        code: 'custom',
        path: ['classes', playerClass, ...issue.path],
        message: `with the ${playerClass} override: ${issue.message}`,
      });
    }
  }
}

/** One controller profile: `src/content/data/controller/<id>.json`. */
export const controllerSchema = z
  .strictObject({
    id: contentId.describe('Profile id, e.g. "player".'),
    name: z.string().min(1).describe('Display name (debug tools and docs).'),
    notes: z
      .string()
      .min(1)
      .describe('Why these values (feel targets, references), for owner review.'),
    ...tuningShape,
    classes: z
      .partialRecord(z.enum(PLAYER_CLASSES), controllerOverrideSchema)
      .optional()
      .describe(
        'Per-class overrides (mw-e02.3): class → only the values it changes; the rest come from this profile. Armor load effects are not overrides (mw-e17.13).',
      ),
  })
  .superRefine(checkTuning, whenValid)
  .superRefine(checkClasses, whenValid);

/** A controller profile as written in a data file. */
export type ControllerDefInput = z.input<typeof controllerSchema>;
/** A loaded controller profile. */
export type ControllerDef = z.output<typeof controllerSchema>;

/** Id of the profile the player character uses. */
export const PLAYER_CONTROLLER_ID = 'player';
