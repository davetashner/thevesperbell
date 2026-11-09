// Scenes (mw-e00.21): a level as data. A scene places level-kit pieces on a grid and lists entity
// spawns (markers such as the player start, and props). The scene loader (src/sim/scene) turns it
// into sim entities and static colliders, and src/game binds render objects to them. Kept small on
// purpose so scenes can be written by hand or, later, exported from Blender via glTF extras.
//
// Grid snapping: `at` is in grid cells (`grid` metres each) and must be a multiple of
// SCENE_SNAP_STEP; rotation is a yaw in quarter turns. Every piece and prop a scene names must exist
// (checked by the content loader through `ref`).
//
// Patrol routines (mw-e11.9) are level data too: a scene names its `waypoints` (a point with a dwell,
// a look direction, a scan arc and an idle cue) and its `routes` over them (loop, ping-pong,
// random-weighted graph, or a guard post), and a creature spawn's `routine` lists the routes it
// walks, each in an optional window of hours. Every name is checked within the scene, like signal
// bindings: a route naming a waypoint the scene does not have fails validation. A creature spawn's
// `leash` (mw-e01.17) ties it to a post: a radius in metres around a point (default its spawn), and
// its `carries` (mw-e01.5) lists what it drops where it dies, on top of its definition's loot table.

import { z } from 'zod';
import { contentId, ref } from '../schema.ts';
import { worldPropertiesSchema } from '../world-properties.ts';
import { interactableSchema } from './interaction.ts';
import { ITEM_STACK_GUARD } from './item.ts';
import { KIT_PURPOSES, vec3Schema } from './kit.ts';
import { FOOTSTEP_SURFACES } from './material.ts';

/** Placements snap to this fraction of a grid cell. */
export const SCENE_SNAP_STEP = 0.25;

/** Allowed yaw rotations, degrees about +y (counter-clockwise seen from above). */
export const SCENE_YAWS = [0, 90, 180, 270] as const;
export type SceneYaw = (typeof SCENE_YAWS)[number];

const onGrid = (n: number): boolean => Number.isInteger(n / SCENE_SNAP_STEP);

const gridPosition = vec3Schema
  .refine((at) => at.every(onGrid), {
    message: `must snap to the grid: every coordinate a multiple of ${String(SCENE_SNAP_STEP)} cells`,
  })
  .describe('Position in grid cells (x, y, z), snapped to SCENE_SNAP_STEP.');

const yaw = z
  .literal(SCENE_YAWS)
  .default(0)
  .describe('Rotation about +y in degrees: 0, 90, 180 or 270.');

/** Horizontal sides of a part, in the piece's own axes (before the placement's yaw). */
export const LEDGE_SIDES = ['+x', '-x', '+z', '-z'] as const;

/**
 * Switches auto-detected ledges off, or forces them on, for one edge or several (mw-e03.22). Ledges
 * are the top edges of solid boxes with a drop beneath them; see src/sim/climb/ledges.ts.
 */
export const ledgeOverrideSchema = z.strictObject({
  side: z
    .enum(LEDGE_SIDES)
    .optional()
    .describe(
      'Top edge on this side of the piece (its own axes, before yaw); omit for every side.',
    ),
  part: z
    .int()
    .min(0)
    .optional()
    .describe('Index of the part in the kit piece; omit for every part.'),
  ledge: z
    .boolean()
    .describe('false: never a ledge (decoration); true: always a ledge (the whole edge).'),
});

/**
 * Makes a placement or spawn breakable (mw-e03.11): its profile, what it spills and the passage it
 * opens. Its hit points and impact threshold are its world properties (`hp`, `fragile`).
 */
export const sceneBreakableSchema = z.strictObject({
  profile: ref('breakable').describe('Breakable profile: resistances, debris, break loudness.'),
  contents: z
    .array(ref('testprop'))
    .optional()
    .describe('Props it spills when it breaks (props with a body; mw-e03.39).'),
  reveals: contentId
    .optional()
    .describe('Passage it opens when it breaks: names the passageRevealed event (nav, quests).'),
});

/** Door states a scene can place a door in (mw-e03.18). */
export const SCENE_DOOR_STATES = ['closed', 'open', 'jammed'] as const;

/** Switch kinds (mw-e03.18; the sim's SWITCH_KINDS). */
export const SWITCH_KIND_IDS = ['lever', 'button', 'crank', 'wheel'] as const;

/** Most positions a crank or wheel may have. */
export const MAX_SWITCH_POSITIONS = 8;

/**
 * Makes a spawn a door (mw-e03.18): its profile (kind, size, speed, material, what it shuts out), the
 * lock it carries and how it starts. The door stands in the spawn's doorway: the spawn point is the
 * middle of the bottom of the closed leaf, and the spawn's yaw turns it with its doorway.
 */
export const sceneDoorSchema = z.strictObject({
  profile: ref('door').describe('Door profile: kind, size, speed, material, what it shuts out.'),
  lock: ref('lock')
    .optional()
    .describe('The lock it carries: what keys, picks and spells get past.'),
  locked: z
    .boolean()
    .optional()
    .describe('Starts locked; defaults to true when it has a lock (needs one).'),
  state: z
    .enum(SCENE_DOOR_STATES)
    .default('closed')
    .describe('How it starts: closed, open or jammed.'),
  hinge: z
    .enum(['left', 'right'])
    .default('left')
    .describe(
      'Hinged and trapdoor: the side the hinge is on (−x or +x before yaw); sliding: the side it slides to.',
    ),
  swing: z
    .enum(['forward', 'back'])
    .default('forward')
    .describe('Hinged: swings towards +z (forward) or −z (back) before yaw.'),
});

/**
 * Makes a spawn a switch (mw-e03.18): a lever toggles, a button is momentary, a crank or wheel steps
 * through its positions. Signal graphs read it through lever and button nodes bound to the spawn.
 */
export const sceneSwitchSchema = z.strictObject({
  kind: z.enum(SWITCH_KIND_IDS).describe('lever, button, crank or wheel.'),
  positions: z
    .int()
    .min(2)
    .max(MAX_SWITCH_POSITIONS)
    .optional()
    .describe('Positions it steps through (crank and wheel; a lever has 2, a button none).'),
  initial: z.int().min(0).default(0).describe('Position it starts in (0 = off).'),
});

/**
 * Makes a spawn a pressure plate (mw-e03.19): it weighs what rests on it, crates, bodies and actors
 * with what they carry and wear, and is on while the total is in its window. The spawn point is the
 * middle of its top surface; the footprint is axis-aligned. Signal graphs read it through lever nodes
 * bound to the spawn; a signal into a `mechanism` receiver bound to it resets a latching plate.
 */
export const scenePlateSchema = z.strictObject({
  minWeight: z.number().positive().describe('Lightest total weight that turns it on, kg.'),
  maxWeight: z
    .number()
    .positive()
    .optional()
    .describe('Heaviest total weight that keeps it on, kg; absent: no ceiling (too heavy fails).'),
  hysteresis: z
    .number()
    .min(0)
    .default(0)
    .describe('Margin, kg, by which the window widens once it is on, so a jittering load holds.'),
  mode: z
    .enum(['momentary', 'latching'])
    .default('momentary')
    .describe('momentary follows its load; latching stays on until a signal resets it.'),
  armSeconds: z
    .number()
    .min(0)
    .default(0)
    .describe('Seconds the load must stay in the window before it turns on.'),
  width: z.number().positive().default(1).describe('Footprint along x, metres.'),
  depth: z.number().positive().default(1).describe('Footprint along z, metres.'),
  hidden: z
    .boolean()
    .default(false)
    .describe('The trap variant: nothing to see or prompt; wire it to trap signals.'),
});

/**
 * Makes a spawn an impact switch (mw-e03.20): something struck from afar, by an arrow, a thrown
 * object, a strike, a spell or a shove, turns it on. The variant is a prefab (bullseye, bell, crystal,
 * counterweight); every other field overrides the prefab's setting. The spawn point is the middle of
 * its spherical hit zone. Signal graphs read it through lever nodes bound to the spawn; a signal into
 * a `mechanism` receiver bound to it resets it.
 */
const supportShare = z.number().min(0).max(1);

/**
 * Makes a rope hold its span to hit points (mw-e03.13): hits wear its `hp` down instead of severing
 * it at once, and the load of what hangs from its span can snap it.
 */
export const sceneSupportSchema = z.strictObject({
  rating: z
    .number()
    .positive()
    .optional()
    .describe(
      'Heaviest load its span carries, kg: what hangs from it and rests on that. Over it, the weakest rope of the span snaps. Omit: never overloads.',
    ),
  resistances: z
    .strictObject({
      blunt: supportShare.optional().describe('Share of blunt damage ignored.'),
      slash: supportShare.optional().describe('Share of slash damage ignored.'),
      pierce: supportShare.optional().describe('Share of pierce damage ignored (1: a chain).'),
      force: supportShare.optional().describe('Share of a shove (force) ignored.'),
    })
    .default({})
    .describe('Share of each kind of hit it ignores; a kind left out is 0.'),
  span: contentId
    .optional()
    .describe(
      'Ropes of a scene with the same span share one load and fail together (a bridge’s two ropes); what hangs from one hangs from the span.',
    ),
});

/**
 * Makes a spawn a rope (mw-e05.13, mw-e03.13): a cord from the spawn point straight down `length`
 * metres, or to `to`. By default slash or pierce damage (an arrow with a cutting head, a thrown blade,
 * a spell) severs it at once; with `support` it has hit points and a load rating instead. Whatever
 * names it in `suspendedFrom` hangs from it and falls as a physics object when it is cut, burnt or
 * snapped. It gets the `cuttable` world property.
 */
export const sceneRopeSchema = z.strictObject({
  length: z
    .number()
    .positive()
    .optional()
    .describe('How far it hangs straight down, metres (or give `to`).'),
  to: gridPosition.optional().describe('Its other anchor, grid cells (or give `length`).'),
  radius: z.number().positive().optional().describe('Half its thickness, metres (default 0.05).'),
  support: sceneSupportSchema
    .optional()
    .describe('Gives it hit points and a load rating (mw-e03.13): see the support fields.'),
});

/** Rope bridge prefab (mw-e03.13): planks hung between two ropes, expanded into spawns. */
export const sceneBridgeSchema = z.strictObject({
  to: gridPosition.describe(
    'The far end, grid cells: level with the spawn and along x or z, so a bridge runs straight.',
  ),
  planks: z.int().min(1).max(64).describe('How many planks, evenly spaced from end to end.'),
  plank: ref('testprop').describe('The plank prop: its first size axis is the bridge’s width.'),
  rating: z
    .number()
    .positive()
    .describe('Heaviest load the bridge carries, kg: planks, what rests on them, and who walks.'),
  resistances: sceneSupportSchema.shape.resistances.describe(
    'Share of each kind of hit its two ropes ignore.',
  ),
  width: z
    .number()
    .positive()
    .describe('Distance between the two ropes, metres: the plank prop’s width.'),
});

const colourSchema = z
  .tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
  .refine(([r, g, b]) => r > 0 || g > 0 || b > 0, { message: 'a colour cannot be black' });

/**
 * Makes a spawn a light source (mw-e03.16): flammable fuel plus a light that shines only while it
 * burns, which water, wind, a hand smother or running out of fuel put out and heat relights. The
 * prefab sets fuel, ignition point, light and wind resistance; the spawn's own `properties` do not
 * override them.
 */
export const sceneLightSourceSchema = z.strictObject({
  variant: z
    .enum(['candle', 'torch', 'sconce', 'brazier', 'lantern', 'fireplace'])
    .describe('Prefab: its fuel, light, ignition point and how much wind it takes to blow it out.'),
  unlit: z.boolean().optional().describe('Starts dark; heat lights it (default false).'),
  infiniteFuel: z
    .boolean()
    .optional()
    .describe('Never runs out of fuel while lit (default false).'),
  tint: colourSchema
    .optional()
    .describe(
      'Colour of its rendered light, [r, g, b] 0–1 (mw-ju8.43); the prefab default (flame or lamp) when absent. Looks only: the sim light level is unchanged.',
    ),
});

/**
 * Makes a spawn a light beam emitter (mw-e03.17): a sunlight shaft, crystal or spell that casts a ray
 * along `direction` from the spawn point. Mirrors bounce it, lenses focus it, opaque things and
 * actors stop it, and light receivers turn it into signals.
 */
export const sceneBeamEmitterSchema = z.strictObject({
  kind: z
    .enum(['sunlight', 'crystal', 'spell'])
    .describe('Prefab: sets default strength and reach.'),
  direction: vec3Schema.describe('Direction it shines along (any non-zero vector).'),
  intensity: z.number().positive().optional().describe('Strength; 1 is a sunbeam.'),
  colour: colourSchema.optional().describe('Red, green, blue shares, 0…1 (default white).'),
  range: z.number().positive().optional().describe('Longest a segment runs, metres.'),
  maxBounces: z.int().min(0).optional().describe('Bounces it survives (default 8).'),
  active: z.boolean().default(true).describe('Shines from the start.'),
});

/**
 * Makes a spawn a mirror, lens or pane (mw-e03.17): a disc of `radius` facing `normal`. A mirror is
 * `reflective`, a lens or pane `transparent`. A rotatable mirror turns its normal with the push rules.
 */
export const sceneOpticSchema = z.strictObject({
  kind: z.enum(['mirror', 'lens', 'pane']).describe('mirror bounces, lens focuses, pane tints.'),
  normal: vec3Schema.describe('Direction its face points (any non-zero vector).'),
  radius: z.number().positive().optional().describe('Radius of its disc, metres (default 0.5).'),
  focus: z.number().min(1).optional().describe('Lens only: intensity multiplier (default 1).'),
  tint: colourSchema.optional().describe('What it lets through of each colour (default all).'),
});

/**
 * Makes a spawn a light receiver (mw-e03.17): on once light of its colour has been at or above the
 * threshold for the dwell time. Signal graphs read it through lever nodes bound to the spawn.
 */
export const sceneLightReceiverSchema = z.strictObject({
  threshold: z.number().positive().default(0.5).describe('Intensity at or above which it counts.'),
  dwellSeconds: z
    .number()
    .min(0)
    .default(0)
    .describe('Seconds it must be held before it turns on.'),
  filter: colourSchema.optional().describe('Only light of about this colour counts (default any).'),
  mode: z
    .enum(['momentary', 'latching'])
    .default('momentary')
    .describe('momentary goes off with the light; latching until a signal resets it.'),
  radius: z.number().positive().default(0.3).describe('Radius of the sensor, metres.'),
});

export const sceneImpactSwitchSchema = z.strictObject({
  variant: z
    .enum(['bullseye', 'bell', 'crystal', 'counterweight', 'target'])
    .describe(
      'Prefab: bullseye (pierce, small zone), bell (any impact, rings), crystal (charge or light), counterweight (slash, or released by its rope), target (any projectile at or above the spawn’s `shootable` impulse, latching).',
    ),
  minEnergy: z
    .number()
    .min(0)
    .optional()
    .describe('Least energy that counts, J (the delivered amount for an element).'),
  damageTypes: z
    .array(z.enum(['blunt', 'slash', 'pierce']))
    .optional()
    .describe('Damage types it accepts.'),
  elements: z
    .array(z.enum(['heat', 'cold', 'water', 'charge', 'force', 'light']))
    .optional()
    .describe('Elements it accepts.'),
  radius: z.number().positive().optional().describe('Radius of the hit zone, metres.'),
  mode: z
    .enum(['momentary', 'latching'])
    .optional()
    .describe('momentary stays on for holdSeconds after the last hit; latching until reset.'),
  holdSeconds: z.number().min(0).optional().describe('Momentary: seconds it stays on.'),
  loudness: z
    .number()
    .min(0)
    .nullable()
    .optional()
    .describe('Noise made when struck, dB at 1 m; null for silent.'),
});

/**
 * Makes a spawn a lootable container (mw-e18.3): a chest, barrel, bookshelf or corpse. What it holds
 * from the start, plus its loot table rolled once on the first open; both persist with the level.
 */
export const sceneContainerSchema = z.strictObject({
  loot: ref('loot-table')
    .optional()
    .describe(
      'Loot table rolled into it the first time it is opened (once; saves keep the result).',
    ),
  contents: z
    .array(
      z.strictObject({
        item: ref('item').describe('An item it holds from the start.'),
        count: z.int().min(1).max(ITEM_STACK_GUARD).default(1).describe('Units of it; default 1.'),
      }),
    )
    .default([])
    .describe('What it holds from the start, before any roll.'),
  lock: ref('lock')
    .optional()
    .describe('The lock it carries: unlocked and picked like a door’s (mw-e03.18).'),
  locked: z
    .boolean()
    .optional()
    .describe('Starts locked; defaults to true when it has a lock (needs one).'),
  stash: z
    .strictObject({
      capacityKg: z
        .number()
        .positive()
        .max(1000)
        .describe('Most the bodies stashed in it may weigh together, kg.'),
    })
    .optional()
    .describe('Room for bodies (mw-e03.23): a carried body goes in if it fits.'),
});

const localOffset = z
  .tuple([z.number().min(-5).max(5), z.number().min(-1).max(5), z.number().min(-5).max(5)])
  .describe('Metres in the spot’s frame: x right of the opening, y up, z out of it.');

/**
 * Makes a spawn a hiding spot (mw-e03.23): a wardrobe, barrel or haystack an actor can slip into to
 * break line of sight. The spawn's `yaw` is which way its opening faces.
 */
export const sceneHidingSchema = z.strictObject({
  capacity: z.int().min(1).max(8).default(1).describe('Actors that fit at once; default 1.'),
  concealment: z
    .number()
    .min(0)
    .max(1)
    .default(1)
    .describe('How well it hides whoever is inside, 0–1; 1 takes them out of every sight query.'),
  peek: z.boolean().default(true).describe('The occupant may look out through the opening.'),
  enterDb: z.number().min(0).max(120).optional().describe('Noise of getting in, dB at 1 m; 30.'),
  exitDb: z.number().min(0).max(120).optional().describe('Noise of getting out, dB at 1 m; 24.'),
  size: z
    .tuple([
      z.number().positive().max(6),
      z.number().positive().max(6),
      z.number().positive().max(6),
    ])
    .optional()
    .describe('Greybox box drawn for it, metres along x, y, z, standing on the spawn point.'),
  look: z.enum(['wood', 'hay']).default('wood').describe('Colour of that box.'),
  inside: localOffset.optional().describe('Where an occupant stands; the spot’s origin.'),
  eye: localOffset.optional().describe('Where the peek camera sits; 1.5 m above `inside`.'),
  exits: z
    .array(localOffset)
    .min(1)
    .max(6)
    .optional()
    .describe('Exit points in order of preference; one 0.9 m out of the opening.'),
});

/**
 * Places a signal graph in the scene (mw-e03.18, mw-e03.21). A node's entity name is a spawn id
 * unless `bindings` maps it to another.
 */
export const sceneSignalSchema = z.strictObject({
  graph: ref('signal-graph').describe('The graph to place.'),
  bindings: z
    .record(contentId, contentId)
    .default({})
    .describe('Binding name → spawn id, for names that are not themselves spawn ids.'),
  checkpoints: z
    .array(contentId)
    .default([])
    .describe(
      'Volume nodes of the graph that are checkpoints: entering one requests an autosave (mw-e30.5).',
    ),
});

/** How a route is walked (mw-e11.9). */
export const ROUTE_KINDS = ['loop', 'ping-pong', 'random', 'post'] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];

/** A named point of a scene that routes walk through (mw-e11.9). */
export const sceneWaypointSchema = z
  .strictObject({
    id: contentId.describe('Name of the waypoint, unique in the scene, e.g. yard-gate.'),
    at: gridPosition,
    dwellS: z
      .number()
      .nonnegative()
      .optional()
      .describe(
        'Seconds a guard stands here; default: the follow-route step’s dwellS (a post holds forever).',
      ),
    look: z
      .number()
      .min(0)
      .lt(360)
      .optional()
      .describe('Direction it faces while it stands here, degrees: 0 faces +z, 90 faces +x.'),
    scanArc: z
      .number()
      .positive()
      .max(360)
      .optional()
      .describe('Degrees it sweeps its gaze across, centred on look, while it stands here.'),
    scanS: z
      .number()
      .positive()
      .default(6)
      .describe('Seconds one full sweep of the scan arc takes (there and back).'),
    idle: contentId
      .optional()
      .describe(
        'Idle action cue played on arrival (e.g. guard-lean, guard-warm-hands, guard-check-door).',
      ),
  })
  .refine((wp) => wp.scanArc === undefined || wp.look !== undefined, {
    message: 'a scan arc needs a look direction to centre on',
    path: ['scanArc'],
  });

/** A weighted way from one waypoint to another of a random route (mw-e11.9). */
export const sceneRouteLinkSchema = z.strictObject({
  from: contentId.describe('Waypoint it leaves.'),
  to: contentId.describe('Waypoint it goes to.'),
  weight: z.int().min(1).default(1).describe('Relative chance of taking this way; default 1.'),
});

/**
 * A patrol route over the scene's waypoints (mw-e11.9): a loop (A→B→C→A), a ping-pong (A→B→C→B→A),
 * a random-weighted graph (each next waypoint drawn by link weight from the creature's own seeded
 * stream) or a post (one waypoint, held, scanning).
 */
export const sceneRouteSchema = z.strictObject({
  id: contentId.describe('Name of the route, unique in the scene, e.g. yard-loop.'),
  kind: z.enum(ROUTE_KINDS).describe('loop, ping-pong, random (weighted graph) or post.'),
  waypoints: z
    .array(contentId)
    .min(1)
    .describe('Waypoint ids in walking order (random: the graph’s waypoints, each once).'),
  links: z
    .array(sceneRouteLinkSchema)
    .optional()
    .describe('Random routes only: the weighted ways between its waypoints.'),
});

/** A route a creature walks, in a window of hours of the day (mw-e11.9). */
export const sceneRoutineSchema = z
  .strictObject({
    route: contentId.describe('Route id of this scene.'),
    hours: z
      .tuple([z.number().min(0).max(24), z.number().min(0).max(24)])
      .optional()
      .describe(
        'From and to, hours of the day (wraps past midnight when from > to); omit for always.',
      ),
  })
  .refine(({ hours }) => hours === undefined || hours[0] !== hours[1], {
    message: 'the window is empty: from equals to',
    path: ['hours'],
  });

export const scenePlacementSchema = z.strictObject({
  piece: ref('kit').describe('Id of the kit piece.'),
  at: gridPosition,
  yaw,
  scale: z
    .tuple([z.number().positive(), z.number().positive(), z.number().positive()])
    .default([1, 1, 1])
    .describe('Stretch along the piece’s own x, y, z (e.g. a 2 m floor tile scaled 5× is 10 m).'),
  purpose: z.enum(KIT_PURPOSES).optional().describe('Overrides the piece’s purpose (colour code).'),
  properties: worldPropertiesSchema
    .optional()
    .describe(
      'World properties of the piece over the level material, e.g. { "climbable": "ivy" } or a wooden material.',
    ),
  ledges: z
    .array(ledgeOverrideSchema)
    .optional()
    .describe('Ledge overrides, applied in order (a later one wins over an earlier one).'),
  breakable: sceneBreakableSchema
    .optional()
    .describe('Makes the piece breakable, e.g. a cracked wall the knight can smash (mw-e03.11).'),
});

/**
 * A creature's leash (mw-e01.17): how far from its post it may chase in Combat. Past the radius it
 * drops its target, searches at the leash edge and walks back to the post, keeping its wounds.
 */
export const sceneLeashSchema = z
  .strictObject({
    radius: z
      .number()
      .positive()
      .describe('Metres from the post, measured on the level, past which a chase ends.'),
    post: gridPosition.optional().describe('The post, grid cells; absent = the spawn point.'),
  })
  .describe('Leash: radius in metres around a post (default the spawn point).');

export const sceneSpawnSchema = z.strictObject({
  id: contentId.describe('Name of the spawn, unique in the scene (e.g. player-start).'),
  at: gridPosition,
  yaw,
  prop: ref('testprop').optional().describe('Prop to spawn; without one the spawn is a marker.'),
  tags: z.array(z.string().min(1)).default([]).describe('Free-form tags for systems and tools.'),
  interact: interactableSchema
    .optional()
    .describe('Makes the spawned entity interactable: its affordances (mw-e02.5).'),
  targetable: ref('targetable')
    .optional()
    .describe('Makes the spawned entity a lock-on target with this profile (mw-e02.16).'),
  item: z
    .strictObject({
      id: ref('item').describe('The item lying here.'),
      count: z
        .int()
        .min(1)
        .max(ITEM_STACK_GUARD)
        .default(1)
        .describe('Units in the one world item (a pile of arrows); default 1.'),
    })
    .optional()
    .describe(
      'Places an item here as a world item the player can take, drop and throw (mw-e17.7).',
    ),
  creature: ref('creature')
    .optional()
    .describe('Creature to spawn here (mw-e12.4); faces the spawn’s yaw.'),
  faction: ref('faction')
    .optional()
    .describe('Faction the spawned creature joins instead of its definition’s (needs creature).'),
  patrol: z
    .array(gridPosition)
    .min(1)
    .optional()
    .describe(
      'Patrol route for the spawned creature: waypoints in grid cells, walked in order (needs creature; AI, e11, walks it).',
    ),
  routine: z
    .array(sceneRoutineSchema)
    .min(1)
    .optional()
    .describe(
      'Routes the spawned creature walks (mw-e11.9): the first whose window holds the hour runs (needs creature; not with patrol).',
    ),
  leash: sceneLeashSchema
    .optional()
    .describe(
      'Ties the spawned creature to a post (mw-e01.17): in Combat it chases only this far from the post, then searches and walks home (needs creature).',
    ),
  repopulate: z
    .strictObject({
      afterDays: z
        .int()
        .min(1)
        .max(365)
        .describe(
          'World days after the kill before the creature returns; 1 = once the player has slept through a night.',
        ),
    })
    .optional()
    .describe(
      'Opts the spawned creature in to returning after it is killed (mw-ju8.29): it is spawned fresh at its origin when the scene next loads, or at once when the player is out of sight and far away. Not for bosses or gatekeepers (needs creature).',
    ),
  presence: z
    .strictObject({
      phases: z
        .array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))
        .min(1)
        .describe(
          'Ids of the clock phases (time.phase: dawn, day, dusk, night) the spawn is there for.',
        ),
    })
    .optional()
    .describe(
      'The spawn is only there during these phases of the day (mw-ju8.14, mw-e27.12): its creature is not spawned and its `interact` is switched off in any other phase, and both come and go as the clock crosses a phase boundary while the player is in the scene.',
    ),
  carries: z
    .array(
      z.strictObject({
        item: ref('item').describe('An item the creature carries.'),
        count: z.int().min(1).max(ITEM_STACK_GUARD).default(1).describe('Units of it; default 1.'),
      }),
    )
    .min(1)
    .optional()
    .describe(
      'What the spawned creature carries and drops where it dies, as world items (mw-e01.5), e.g. the slice skeleton’s key (needs creature).',
    ),
  properties: worldPropertiesSchema
    .optional()
    .describe(
      'World properties of the spawned entity, e.g. a torch: { "burning": true, "fuel": 3600 } (mw-e03.37). A spawn with properties is placed in the sim, so the light field and stimuli reach it.',
    ),
  questCritical: z
    .boolean()
    .optional()
    .describe(
      'The quest needs this world object (a statue part, a counterweight; mw-e17.14): it must name a `recovery` anchor, because it is carried physically and can be dropped, thrown or lost (ADR-0003).',
    ),
  recovery: gridPosition
    .optional()
    .describe(
      'Where the object returns to, grid cells (the middle of its base), if it ends up below the scene or out of bounds; `object.recovered` is emitted (mw-e17.14).',
    ),
  breakable: sceneBreakableSchema
    .optional()
    .describe(
      'Makes the spawned entity breakable, e.g. a pot that spills its contents (mw-e03.11).',
    ),
  door: sceneDoorSchema
    .optional()
    .describe('Makes the spawned entity a door: profile, lock and starting state (mw-e03.18).'),
  switch: sceneSwitchSchema
    .optional()
    .describe('Makes the spawned entity a lever, button, crank or wheel (mw-e03.18).'),
  plate: scenePlateSchema
    .optional()
    .describe(
      'Makes the spawned entity a pressure plate that weighs what rests on it (mw-e03.19).',
    ),
  rope: sceneRopeSchema
    .optional()
    .describe(
      'Makes the spawned entity a cuttable rope hanging down from its position (mw-e05.13).',
    ),
  bridge: sceneBridgeSchema
    .optional()
    .describe(
      'Makes the spawn one end of a rope bridge (mw-e03.13): two support ropes and their planks, hung level from the spawn to `to`.',
    ),
  suspendedFrom: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Spawn id of the rope this movable prop hangs from (mw-e05.13): it is held in place until the rope is cut or burnt, then falls.',
    ),
  lightSource: sceneLightSourceSchema
    .optional()
    .describe('Makes the spawned entity a light source that can be put out and relit (mw-e03.16).'),
  impactSwitch: sceneImpactSwitchSchema
    .optional()
    .describe(
      'Makes the spawned entity an impact switch that distant hits and spells trigger (mw-e03.20).',
    ),
  beamEmitter: sceneBeamEmitterSchema
    .optional()
    .describe('Makes the spawned entity a light beam emitter (mw-e03.17).'),
  optic: sceneOpticSchema
    .optional()
    .describe('Makes the spawned entity a mirror, lens or pane for light beams (mw-e03.17).'),
  lightReceiver: sceneLightReceiverSchema
    .optional()
    .describe('Makes the spawned entity a light receiver that beams switch on (mw-e03.17).'),
  container: sceneContainerSchema
    .optional()
    .describe(
      'Makes the spawned entity a lootable container: loot table, contents and lock (mw-e18.3).',
    ),
  bulky: contentId
    .optional()
    .describe(
      'Makes a movable prop a shoulder-carry (a body, a statue part; mw-e03.23): heavier than a hand-carry, and it fits in a container with room for bodies. The id says what it is.',
    ),
  hiding: sceneHidingSchema
    .optional()
    .describe('Makes the spawned entity a hiding spot an actor can slip into (mw-e03.23).'),
});

const lightLevel = z.number().min(0).max(1);
const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: 'must be a #RRGGBB colour' });

/** A box of the scene with its own ambient light (mw-e03.37; see src/sim/light/field.ts). */
export const sceneAmbientZoneSchema = z
  .strictObject({
    id: contentId.describe('Name of the zone, e.g. moonlit-yard.'),
    min: vec3Schema.describe('Lower corner, grid cells.'),
    max: vec3Schema.describe('Upper corner, grid cells; above min on every axis.'),
    level: lightLevel.describe('Ambient level inside, 0–1.'),
  })
  .refine(({ min, max }) => max[0] > min[0] && max[1] > min[1] && max[2] > min[2], {
    message: 'max must be above min on every axis',
    path: ['max'],
  });

/** Light from far away along one direction: moonlight, sun (mw-e03.37). */
export const sceneDirectionalLightSchema = z.strictObject({
  id: contentId.describe('Name of the light, e.g. moon.'),
  direction: vec3Schema
    .refine((d) => d.some((v) => v !== 0), { message: 'direction must not be zero' })
    .describe('Direction the light travels, e.g. [0, -1, 0] straight down.'),
  level: lightLevel.describe('Level where it reaches, 0–1.'),
  reach: z
    .number()
    .positive()
    .describe('How far back towards the light a position must be clear to receive it, metres.'),
});

/** One keyframe of a scene's day and night look (mw-ju8.43). */
export const sceneTimeOfDayKeySchema = z.strictObject({
  minute: z.int().min(0).max(1439).describe('Minute of the day it applies at, 0–1439.'),
  ambient: lightLevel.describe('Rendered ambient fill level, 0–1.'),
  directional: lightLevel.describe('Rendered level of the key light (sun or moon), 0–1.'),
  sky: hexColour.optional().describe('Sky colour, #RRGGBB.'),
});

/**
 * A scene's day and night look (mw-ju8.43): keyframes over the game day that the renderer blends
 * between (wrapping past midnight) for its ambient fill, key light and sky. Render-only: the sim's
 * light field keeps the scene's static `ambient` and `directional` levels, so stealth is the same at
 * noon and at night. Scenes without it keep their fixed look.
 */
export const sceneTimeOfDaySchema = z
  .strictObject({
    keyframes: z.array(sceneTimeOfDayKeySchema).min(2),
  })
  .refine(
    ({ keyframes }) => {
      const minutes = keyframes.map((key) => key.minute);
      const sorted = [...new Set(minutes)].sort((x, y) => x - y);
      return minutes.length === sorted.length && minutes.every((m, i) => m === sorted[i]);
    },
    { message: 'keyframes must ascend by minute', path: ['keyframes'] },
  );

/**
 * The scene's static lighting (mw-e03.37), loaded into the sim's light field; the renderer mirrors
 * it. Without it a scene is dark apart from its light-emitting and burning entities.
 */
export const sceneLightSchema = z.strictObject({
  ambient: lightLevel.optional().describe('Ambient level wherever no ambient zone applies, 0–1.'),
  ambientZones: z
    .array(sceneAmbientZoneSchema)
    .default([])
    .describe('Boxes with their own ambient level; later zones win where they overlap.'),
  directional: z
    .array(sceneDirectionalLightSchema)
    .default([])
    .describe('Directional lights (moon, sun); the brightest is the rendered key light.'),
  timeOfDay: sceneTimeOfDaySchema
    .optional()
    .describe('Day and night look of the rendered light, following the game clock (mw-ju8.43).'),
});

/** The room id that stands for everywhere outside the scene's rooms (open terrain). */
export const OUTSIDE_ROOM = 'outside';

const roomRef = contentId.describe(`A room id of this scene, or "${OUTSIDE_ROOM}".`);

/** A room for sound propagation: an axis-aligned box (mw-e09.3). */
export const sceneRoomSchema = z
  .strictObject({
    id: contentId
      .refine((id) => id !== OUTSIDE_ROOM, { message: `"${OUTSIDE_ROOM}" is reserved` })
      .describe('Name of the room, unique in the scene, e.g. guard-room.'),
    min: vec3Schema.describe('Lower corner, grid cells.'),
    max: vec3Schema.describe('Upper corner, grid cells; above min on every axis.'),
  })
  .refine(({ min, max }) => max[0] > min[0] && max[1] > min[1] && max[2] > min[2], {
    message: 'max must be above min on every axis',
    path: ['max'],
  });

/** An opening sound passes through between two rooms: a doorway, an arch, a hatch (mw-e09.3). */
export const scenePortalSchema = z.strictObject({
  id: contentId.describe('Name of the portal, unique in the scene, e.g. guard-room-door.'),
  rooms: z
    .tuple([roomRef, roomRef])
    .describe(`The two rooms it joins (one may be "${OUTSIDE_ROOM}").`),
  at: vec3Schema.describe(
    'Its middle, grid cells: where a listener on the far side hears a sound come from.',
  ),
  door: z
    .string()
    .min(1)
    .optional()
    .describe('Spawn id of the door in it; its state (open, ajar, closed) sets the loss.'),
});

/** The material of the wall or floor between two touching rooms (mw-e09.3). */
export const scenePartitionSchema = z.strictObject({
  rooms: z.tuple([contentId, contentId]).describe('The two touching rooms.'),
  material: contentId.describe(
    'Material id of what separates them; its wall or floor gain comes from the stealth tuning.',
  ),
});

/**
 * The scene's rooms and portals for sound propagation (mw-e09.3). Rooms that touch (side by side:
 * a wall; stacked: a floor) transmit through their partition; everything else goes through portals.
 */
export const sceneAcousticsSchema = z.strictObject({
  rooms: z.array(sceneRoomSchema).default([]).describe('Rooms; they must not overlap.'),
  portals: z.array(scenePortalSchema).default([]).describe('Openings between rooms.'),
  partitions: z
    .array(scenePartitionSchema)
    .default([])
    .describe('Materials of partitions between touching rooms; the rest use the tuning default.'),
});

const cameraSchema = z.strictObject({
  position: vec3Schema.describe('Camera position in metres.'),
  target: vec3Schema.describe('Point the camera looks at, metres.'),
});

/**
 * A backdrop layer (mw-ju8.1): one painted image on a curved, unlit card behind the scene. It hangs on
 * a cylinder arc `radius` m from the camera, centred on a compass `bearing` (0 faces +z, 90 faces +x),
 * and follows the camera by `follow` (1 = infinitely far, no parallax; less lets the layer slide a
 * little against the level). Not tiled, so it has no seams. The renderer loads it only when the file
 * is there (unapproved images stay in assets/_incoming) and shows the flat sky colour otherwise.
 */
export const sceneBackdropSchema = z.strictObject({
  image: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._/-]*\.(png|webp|jpg)$/, {
      message: 'must be a relative image path such as backdrop-valley-01/far-mountains-castle.png',
    })
    .describe('Image path under the backdrop folder (assets/_incoming in dev).'),
  bearing: z
    .number()
    .min(0)
    .lt(360)
    .default(0)
    .describe('Compass direction the card is centred on, degrees: 0 faces +z, 90 faces +x.'),
  arc: z
    .number()
    .min(20)
    .max(360)
    .default(100)
    .describe('How much of the horizon the card spans, degrees; its height follows the image.'),
  radius: z
    .number()
    .min(20)
    .max(190)
    .default(150)
    .describe('Distance from the camera, m; must stay inside the camera far plane.'),
  centreY: z.number().default(25).describe('Height of the image centre above the camera plane, m.'),
  follow: z
    .number()
    .min(0)
    .max(1)
    .default(1)
    .describe('Share of the camera movement the card follows: 1 never parallaxes, 0 stays put.'),
});

/** Sky, distance fog and backdrop layer of an outdoor scene (mw-ju8.1). */
export const sceneEnvironmentSchema = z.strictObject({
  sky: hexColour.optional().describe('Flat sky colour behind everything, #RRGGBB.'),
  fog: z
    .strictObject({
      color: hexColour.describe('Fog colour, #RRGGBB.'),
      near: z.number().min(0).describe('Distance where fog starts, m.'),
      far: z.number().positive().describe('Distance where the fog is solid, m.'),
    })
    .refine(({ near, far }) => far > near, {
      message: 'far must be beyond near',
      path: ['far'],
    })
    .optional()
    .describe('Distance fog that blends the level into the backdrop.'),
  backdrop: sceneBackdropSchema.optional().describe('Painted backdrop layer behind the level.'),
});

/**
 * A tagged box of the scene (mw-ju8.1): data only for now, e.g. a river a later bead lets the player
 * swim in. Systems pick regions by tag.
 */
export const sceneRegionSchema = z
  .strictObject({
    id: contentId.describe('Name of the region, unique in the scene, e.g. river.'),
    min: vec3Schema.describe('Lower corner, grid cells.'),
    max: vec3Schema.describe('Upper corner, grid cells; above min on every axis.'),
    tags: z.array(z.string()).default([]).describe('Free-form tags, e.g. water.'),
  })
  .refine(({ min, max }) => max[0] > min[0] && max[1] > min[1] && max[2] > min[2], {
    message: 'max must be above min on every axis',
    path: ['max'],
  });

/**
 * A box of the scene tagged with an acoustic surface (mw-e09.4): a carpet on a wooden floor, a gravel
 * path, a creaky bridge. `surfaceAt` (src/sim/surfaces) reads the highest `priority` box holding a
 * position, whatever collider is underfoot; the first listed wins a tie. The box must reach the
 * feet: its y range includes the floor height.
 */
export const sceneSurfaceSchema = z
  .strictObject({
    id: contentId.describe('Name of the surface region, unique in the scene, e.g. hall-carpet.'),
    min: vec3Schema.describe('Lower corner, grid cells.'),
    max: vec3Schema.describe('Upper corner, grid cells; above min on every axis.'),
    surface: z
      .enum(FOOTSTEP_SURFACES)
      .describe('The footstep surface (audio bible §7.3) of everything inside, e.g. carpet.'),
    priority: z
      .int()
      .default(0)
      .describe('Where boxes overlap, the higher priority wins; the first listed wins a tie.'),
  })
  .refine(({ min, max }) => max[0] > min[0] && max[1] > min[1] && max[2] > min[2], {
    message: 'max must be above min on every axis',
    path: ['max'],
  });

/**
 * A way out of the scene into another (mw-e01.11): a box the player walks into, the scene it leads to
 * and the named spawn of that scene the player arrives at, facing the way the spawn's yaw says.
 * Arrival spawns are ordinary marker spawns by convention called `arrive-from-<this scene id>`; the
 * content check (src/content/transition-checks.ts) fails a transition whose target scene or spawn
 * does not exist, naming both.
 */
export const sceneTransitionSchema = z
  .strictObject({
    id: contentId.describe('Name of the transition, unique in the scene, e.g. north-gate.'),
    min: vec3Schema.describe('Lower corner of the volume, grid cells.'),
    max: vec3Schema.describe('Upper corner of the volume, grid cells; above min on every axis.'),
    scene: ref('scene').describe('The scene it leads to.'),
    spawn: contentId.describe(
      'The spawn of that scene the player arrives at; its yaw is the way the player faces.',
    ),
    follow: z
      .boolean()
      .default(false)
      .describe('Companions flagged to follow travel with the player through it (none exist yet).'),
  })
  .refine(({ min, max }) => max[0] > min[0] && max[1] > min[1] && max[2] > min[2], {
    message: 'max must be above min on every axis',
    path: ['max'],
  });

/**
 * Places an ambience zone in a scene (mw-e28.13): over the named region (a tagged box in `regions`),
 * or over the whole scene when `region` is left out. Where several apply the later entry wins.
 */
export const sceneAmbienceSchema = z.strictObject({
  zone: ref('ambience').describe('The ambience zone that plays here.'),
  region: contentId
    .optional()
    .describe('Id of one of the scene’s regions; leave out to cover the whole scene.'),
});

export const sceneSchema = z
  .strictObject({
    id: contentId.describe('Scene id; also the ?scene= URL value.'),
    name: z.string().min(1).describe('Display name shown on screen.'),
    description: z.string().default('').describe('What the scene is for.'),
    grid: z.number().positive().default(1).describe('Size of one grid cell in metres.'),
    camera: cameraSchema.describe('Where the view camera starts.'),
    placements: z.array(scenePlacementSchema).min(1).describe('Kit pieces in the scene.'),
    spawns: z.array(sceneSpawnSchema).default([]).describe('Entity spawns: markers and props.'),
    waypoints: z
      .array(sceneWaypointSchema)
      .default([])
      .describe('Named points patrol routes walk through (mw-e11.9).'),
    routes: z
      .array(sceneRouteSchema)
      .default([])
      .describe('Patrol routes and guard posts over the waypoints (mw-e11.9).'),
    light: sceneLightSchema
      .optional()
      .describe('Static lighting: ambient level, ambient zones, directional lights (mw-e03.37).'),
    signals: z
      .array(sceneSignalSchema)
      .default([])
      .describe('Signal graphs wiring its switches, volumes and doors (mw-e03.18).'),
    acoustics: sceneAcousticsSchema
      .optional()
      .describe('Rooms, portals and partitions for sound propagation (mw-e09.3).'),
    environment: sceneEnvironmentSchema
      .optional()
      .describe('Outdoor look: sky colour, distance fog and a painted backdrop (mw-ju8.1).'),
    regions: z
      .array(sceneRegionSchema)
      .default([])
      .describe('Tagged boxes, e.g. a river (mw-ju8.1); data only until a system reads them.'),
    surfaces: z
      .array(sceneSurfaceSchema)
      .default([])
      .describe('Boxes tagged with a footstep surface, e.g. carpet on a wooden floor (mw-e09.4).'),
    transitions: z
      .array(sceneTransitionSchema)
      .default([])
      .describe('Volumes that lead to another scene, and where the player arrives (mw-e01.11).'),
    ambience: z
      .array(sceneAmbienceSchema)
      .default([])
      .describe('Ambience zones placed over regions of the scene or all of it (mw-e28.13).'),
  })
  .superRefine((scene, ctx) => {
    const transitionIds = new Set<string>();
    scene.transitions.forEach((transition, index) => {
      if (transitionIds.has(transition.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['transitions', index, 'id'],
          message: `transition id "${transition.id}" is used twice in this scene`,
        });
      }
      transitionIds.add(transition.id);
      if (transition.scene.id === scene.id) {
        ctx.addIssue({
          code: 'custom',
          path: ['transitions', index, 'scene'],
          message: `transition "${transition.id}" leads back into its own scene`,
        });
      }
    });
    const surfaceIds = new Set<string>();
    scene.surfaces.forEach((surface, index) => {
      if (surfaceIds.has(surface.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['surfaces', index, 'id'],
          message: `surface region id "${surface.id}" is used twice in this scene`,
        });
      }
      surfaceIds.add(surface.id);
    });
    const regionIds = new Set<string>();
    scene.regions.forEach((region, index) => {
      if (regionIds.has(region.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['regions', index, 'id'],
          message: `region id "${region.id}" is used twice in this scene`,
        });
      }
      regionIds.add(region.id);
    });
    scene.ambience.forEach((placed, index) => {
      if (placed.region === undefined || regionIds.has(placed.region)) return;
      ctx.addIssue({
        code: 'custom',
        path: ['ambience', index, 'region'],
        message: `ambience zone "${placed.zone.id}" names region "${placed.region}", which this scene does not have`,
      });
    });
    const seen = new Set<string>();
    scene.spawns.forEach((spawn, index) => {
      if (seen.has(spawn.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['spawns', index, 'id'],
          message: `spawn id "${spawn.id}" is used twice in this scene`,
        });
      }
      seen.add(spawn.id);
      checkMechanism(spawn, index, ctx);
      if (
        spawn.suspendedFrom !== undefined &&
        !scene.spawns.some((other) => other.id === spawn.suspendedFrom && other.rope !== undefined)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['spawns', index, 'suspendedFrom'],
          message: `spawn "${spawn.id}" hangs from "${spawn.suspendedFrom}", which is not a rope spawn of this scene`,
        });
      }
      if (spawn.creature !== undefined) return;
      for (const key of [
        'faction',
        'patrol',
        'routine',
        'leash',
        'carries',
        'repopulate',
      ] as const) {
        if (spawn[key] === undefined) continue;
        ctx.addIssue({
          code: 'custom',
          path: ['spawns', index, key],
          message: `spawn "${spawn.id}" sets ${key} but spawns no creature`,
        });
      }
    });
    scene.signals.forEach((signal, index) => {
      signal.checkpoints.forEach((node, at) => {
        if (signal.checkpoints.indexOf(node) === at) return;
        ctx.addIssue({
          code: 'custom',
          path: ['signals', index, 'checkpoints', at],
          message: `checkpoint "${node}" is listed twice`,
        });
      });
      for (const [name, id] of Object.entries(signal.bindings)) {
        if (seen.has(id)) continue;
        ctx.addIssue({
          code: 'custom',
          path: ['signals', index, 'bindings', name],
          message: `binding "${name}" names spawn "${id}", which this scene does not have`,
        });
      }
    });
    if (scene.acoustics !== undefined) checkAcoustics(scene.spawns, scene.acoustics, ctx);
    checkRoutes(scene, ctx);
  });

type SpawnDef = z.output<typeof sceneSpawnSchema>;

type AcousticsDef = z.output<typeof sceneAcousticsSchema>;

/**
 * Waypoint and route names are unique, routes name waypoints the scene has (mw-e11.9 AC-5) in the
 * shape their kind needs, and routines name routes the scene has.
 */
function checkRoutes(
  scene: {
    readonly spawns: readonly SpawnDef[];
    readonly waypoints: readonly z.output<typeof sceneWaypointSchema>[];
    readonly routes: readonly z.output<typeof sceneRouteSchema>[];
  },
  ctx: z.RefinementCtx,
): void {
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path, message });
  };
  const waypoints = new Set<string>();
  scene.waypoints.forEach((wp, i) => {
    if (waypoints.has(wp.id)) issue(['waypoints', i, 'id'], `waypoint id "${wp.id}" is used twice`);
    waypoints.add(wp.id);
  });
  const routes = new Set<string>();
  scene.routes.forEach((route, i) => {
    const at = (...path: (string | number)[]) => ['routes', i, ...path];
    const name = `route "${route.id}"`;
    if (routes.has(route.id)) issue(at('id'), `route id "${route.id}" is used twice`);
    routes.add(route.id);
    route.waypoints.forEach((id, w) => {
      if (!waypoints.has(id)) {
        issue(at('waypoints', w), `${name} names waypoint "${id}", which this scene does not have`);
      }
    });
    const count = route.waypoints.length;
    if (route.kind === 'post' && count !== 1) {
      issue(at('waypoints'), `${name} is a post: it holds exactly one waypoint`);
    }
    if (route.kind === 'ping-pong' && count < 2) {
      issue(at('waypoints'), `${name} is a ping-pong: it needs at least two waypoints`);
    }
    if (route.kind !== 'random') {
      if (route.links !== undefined)
        issue(at('links'), `${name} is a ${route.kind}: only a random route has links`);
      return;
    }
    route.waypoints.forEach((id, w) => {
      if (route.waypoints.indexOf(id) !== w) {
        issue(at('waypoints', w), `${name} lists waypoint "${id}" twice`);
      }
    });
    const links = route.links ?? [];
    const own = new Set(route.waypoints);
    links.forEach((link, l) => {
      for (const end of ['from', 'to'] as const) {
        if (!own.has(link[end])) {
          issue(
            at('links', l, end),
            `${name} links waypoint "${link[end]}", which it does not list`,
          );
        }
      }
    });
    if (count < 2) return;
    route.waypoints.forEach((id, w) => {
      if (links.some((link) => link.from === id)) return;
      issue(at('waypoints', w), `${name} has no link leaving waypoint "${id}"`);
    });
  });
  scene.spawns.forEach((spawn, s) => {
    if (spawn.routine === undefined) return;
    if (spawn.patrol !== undefined) {
      issue(['spawns', s, 'routine'], `spawn "${spawn.id}" sets both patrol and routine`);
    }
    spawn.routine.forEach((entry, r) => {
      if (routes.has(entry.route)) return;
      issue(
        ['spawns', s, 'routine', r, 'route'],
        `spawn "${spawn.id}" names route "${entry.route}", which this scene does not have`,
      );
    });
  });
}

/** Room, portal and partition names must be unique and name what the scene has. */
function checkAcoustics(
  spawns: readonly SpawnDef[],
  acoustics: AcousticsDef,
  ctx: z.RefinementCtx,
): void {
  const { rooms, portals, partitions } = acoustics;
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path: ['acoustics', ...path], message });
  };
  const roomIds = new Set<string>();
  rooms.forEach((room, i) => {
    if (roomIds.has(room.id)) issue(['rooms', i, 'id'], `room id "${room.id}" is used twice`);
    roomIds.add(room.id);
  });
  const doors = new Set(spawns.filter((s) => s.door !== undefined).map((s) => s.id));
  const pair = (list: readonly [string, string], path: (string | number)[], outside: boolean) => {
    list.forEach((id, side) => {
      if (roomIds.has(id) || (outside && id === OUTSIDE_ROOM)) return;
      issue([...path, side], `names room "${id}", which this scene does not have`);
    });
    if (list[0] === list[1]) issue(path, `joins room "${list[0]}" to itself`);
  };
  const portalIds = new Set<string>();
  portals.forEach((portal, i) => {
    if (portalIds.has(portal.id))
      issue(['portals', i, 'id'], `portal id "${portal.id}" is used twice`);
    portalIds.add(portal.id);
    pair(portal.rooms, ['portals', i, 'rooms'], true);
    if (portal.door !== undefined && !doors.has(portal.door)) {
      issue(['portals', i, 'door'], `names door "${portal.door}", which no spawn of this scene is`);
    }
  });
  const pairs = new Set<string>();
  partitions.forEach((partition, i) => {
    pair(partition.rooms, ['partitions', i, 'rooms'], false);
    const key = [...partition.rooms].sort().join('|');
    if (pairs.has(key)) issue(['partitions', i, 'rooms'], 'this partition is listed twice');
    pairs.add(key);
  });
}

/** A spawn's door and switch data must agree with each other and with its other fields. */
function checkMechanism(spawn: SpawnDef, index: number, ctx: z.RefinementCtx): void {
  const issue = (key: string, message: string) => {
    ctx.addIssue({
      code: 'custom',
      path: ['spawns', index, key],
      message: `spawn "${spawn.id}" ${message}`,
    });
  };
  const { door } = spawn;
  if (door !== undefined) {
    if (spawn.switch !== undefined) issue('switch', 'cannot be both a door and a switch');
    if (spawn.interact !== undefined) {
      issue('interact', 'is a door: its affordances follow its state, so it declares none');
    }
    if (door.locked === true && door.lock === undefined)
      issue('door', 'starts locked but has no lock');
  }
  const { container } = spawn;
  if (container !== undefined) {
    const others = [
      ['door', 'a door'],
      ['switch', 'a switch'],
      ['plate', 'a plate'],
      ['impactSwitch', 'an impact switch'],
      ['lightSource', 'a light source'],
      ['item', 'an item'],
      ['creature', 'a creature'],
    ] as const;
    for (const [key, what] of others) {
      if (spawn[key] !== undefined) issue(key, `cannot be both a container and ${what}`);
    }
    if (spawn.interact !== undefined) {
      issue('interact', 'is a container: its affordances follow its lock, so it declares none');
    }
    if (container.locked === true && container.lock === undefined) {
      issue('container', 'starts locked but has no lock');
    }
  }
  if (spawn.bulky !== undefined && spawn.prop === undefined) {
    issue('bulky', 'is carried but is not a movable prop');
  }
  if (spawn.hiding !== undefined) {
    for (const [key, what] of [
      ['container', 'a container'],
      ['door', 'a door'],
      ['switch', 'a switch'],
      ['plate', 'a plate'],
      ['item', 'an item'],
      ['creature', 'a creature'],
    ] as const) {
      if (spawn[key] !== undefined) issue(key, `cannot be both a hiding spot and ${what}`);
    }
    if (spawn.interact !== undefined) {
      issue(
        'interact',
        'is a hiding spot: its affordances follow who is inside, so it declares none',
      );
    }
  }
  const { plate } = spawn;
  if (plate !== undefined) {
    const others = [
      ['door', 'a door'],
      ['switch', 'a switch'],
      ['item', 'an item'],
      ['creature', 'a creature'],
    ] as const;
    for (const [key, what] of others) {
      if (spawn[key] !== undefined) issue(key, `cannot be both a plate and ${what}`);
    }
    if (plate.maxWeight !== undefined && plate.maxWeight < plate.minWeight) {
      issue('plate', 'has a maxWeight below its minWeight');
    }
  }
  if (spawn.rope !== undefined) {
    if ((spawn.rope.length === undefined) === (spawn.rope.to === undefined)) {
      issue('rope', 'needs exactly one of length and to');
    }
    if (spawn.rope.to !== undefined && spawn.rope.support === undefined) {
      issue(
        'rope',
        'runs to another point but has no support: a cuttable rope hangs straight down',
      );
    }
    for (const [key, what] of [
      ['door', 'a door'],
      ['switch', 'a switch'],
      ['plate', 'a plate'],
      ['impactSwitch', 'an impact switch'],
      ['container', 'a container'],
      ['item', 'an item'],
      ['creature', 'a creature'],
      ['suspendedFrom', 'hanging from a rope'],
    ] as const) {
      if (spawn[key] !== undefined) issue(key, `cannot be both a rope and ${what}`);
    }
  }
  if (spawn.suspendedFrom !== undefined) {
    if (spawn.prop === undefined) issue('suspendedFrom', 'hangs but is not a movable prop');
  }
  const { bridge } = spawn;
  if (bridge !== undefined) {
    const [x0, y0, z0] = spawn.at;
    const [x1, y1, z1] = bridge.to;
    if (y1 !== y0) issue('bridge', 'must run level: `to` is at another height');
    if ((x1 === x0) === (z1 === z0)) {
      issue('bridge', 'must run along x or z, and be longer than nothing');
    }
    for (const [key, what] of [
      ['rope', 'a rope'],
      ['door', 'a door'],
      ['switch', 'a switch'],
      ['plate', 'a plate'],
      ['impactSwitch', 'an impact switch'],
      ['container', 'a container'],
      ['item', 'an item'],
      ['creature', 'a creature'],
      ['prop', 'a prop'],
      ['suspendedFrom', 'hanging from a rope'],
    ] as const) {
      if (spawn[key] !== undefined) issue(key, `cannot be both a rope bridge and ${what}`);
    }
  }
  const { impactSwitch } = spawn;
  if (impactSwitch !== undefined) {
    const others = [
      ['door', 'a door'],
      ['switch', 'a switch'],
      ['plate', 'a plate'],
      ['item', 'an item'],
      ['creature', 'a creature'],
    ] as const;
    for (const [key, what] of others) {
      if (spawn[key] !== undefined) issue(key, `cannot be both an impact switch and ${what}`);
    }
    const { damageTypes, elements } = impactSwitch;
    if (damageTypes?.length === 0 && elements?.length === 0) {
      issue('impactSwitch', 'accepts no damage type and no element');
    }
  }
  const own = spawn.switch;
  if (own === undefined) return;
  const positions = own.positions ?? (own.kind === 'button' ? 1 : 2);
  if (own.kind !== 'crank' && own.kind !== 'wheel' && own.positions !== undefined) {
    issue('switch', `is a ${own.kind}: only a crank or wheel sets positions`);
  }
  if (own.initial >= positions) {
    issue('switch', `starts in position ${String(own.initial)} of ${String(positions)}`);
  }
}

export type SceneDef = z.output<typeof sceneSchema>;
export type SceneDefInput = z.input<typeof sceneSchema>;
export type ScenePlacementDef = z.output<typeof scenePlacementSchema>;
export type SceneTransitionDef = z.output<typeof sceneTransitionSchema>;
export type SceneSpawnDef = z.output<typeof sceneSpawnSchema>;
export type SceneLightDef = z.output<typeof sceneLightSchema>;
export type SceneEnvironmentDef = z.output<typeof sceneEnvironmentSchema>;
export type SceneBackdropDef = z.output<typeof sceneBackdropSchema>;
export type SceneDoorDef = z.output<typeof sceneDoorSchema>;
export type SceneSwitchDef = z.output<typeof sceneSwitchSchema>;
export type SceneImpactSwitchDef = z.output<typeof sceneImpactSwitchSchema>;
export type SceneBeamEmitterDef = z.output<typeof sceneBeamEmitterSchema>;
export type ScenePlateDef = z.output<typeof scenePlateSchema>;
export type SceneSignalDef = z.output<typeof sceneSignalSchema>;
export type SceneContainerDef = z.output<typeof sceneContainerSchema>;
export type SceneAcousticsDef = z.output<typeof sceneAcousticsSchema>;
export type SceneWaypointDef = z.output<typeof sceneWaypointSchema>;
export type SceneRouteDef = z.output<typeof sceneRouteSchema>;
export type SceneRoutineDef = z.output<typeof sceneRoutineSchema>;
