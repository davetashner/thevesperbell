// Scene layout (mw-e00.21): turns a scene (kit pieces placed on a grid, plus spawns) into world-space
// parts. Both the sim (static colliders, piece entities) and the renderer (greybox meshes) build from
// the same parts, so what you see is what collides. Pieces only turn in quarter turns, so every part
// stays axis-aligned and the maths is exact: rotations use a table of 0/±1 (no trigonometry), and a
// wedge's rise direction just turns with it.
//
// Coordinates: metres, +y up; yaw turns counter-clockwise seen from above (a right-handed rotation
// about +y, the same as Three.js `rotation.y`), so yaw 90 turns local +z into world +x.

import type { KitPurpose, KitShape, RouteKind, SceneYaw } from '@content/index';
import type { PatrolRoute, PatrolRoutine, PatrolWaypoint } from '../ai/routes';
import type { RampRise } from '../character/greybox';
import type { CreatureLeash } from '../creatures/components';
import type { InteractableSpec } from '../interaction/affordance';
import type { LightEnvironment } from '../light/field';
import type { DoorHinge, DoorSwing, SwitchKind } from '../mechanisms/components';
import type { StaticColliderDesc } from '../physics/static-colliders';
import type { WorldPropertyValues } from '../properties/spec';
import type { Vec3 } from '../stimulus/shapes';

/** A unit quaternion. */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** Three numbers: x, y, z. */
export type Triple = readonly [number, number, number];

/** One shape of a kit piece, relative to the piece's origin (see src/content/types/kit.ts). */
export interface KitPartSpec {
  readonly shape: KitShape;
  readonly size: Triple;
  readonly offset: Triple;
  readonly collider: boolean;
}

/** A kit piece as the layout needs it; `GameEntry<'kit'>` satisfies it. */
export interface KitPieceSpec {
  readonly id: string;
  readonly purpose: KitPurpose;
  readonly parts: readonly KitPartSpec[];
}

/** A horizontal side of a part: the face whose outward normal points along that axis. */
export type LedgeSide = '+x' | '-x' | '+z' | '-z';

/**
 * Switches ledges of a placed piece off (`ledge: false`) or forces them on (`ledge: true`), for one
 * part and side or for all of them (mw-e03.22). Sides are the piece's own (before yaw).
 */
export interface LedgeOverrideSpec {
  readonly side?: LedgeSide | undefined;
  /** Index of the part in the kit piece. */
  readonly part?: number | undefined;
  readonly ledge: boolean;
}

/**
 * World properties a placement gives its piece over the level material (mw-e03.22): the data-file
 * form, whose material is a reference.
 */
export type ScenePropertiesSpec = {
  readonly [K in Exclude<keyof WorldPropertyValues, 'material'>]?:
    WorldPropertyValues[K] | undefined;
} & { readonly material?: { readonly id: string } | undefined };

/** A breakable placement or spawn as written in data (mw-e03.11): its profile and instance data. */
export interface SceneBreakableSpec {
  readonly profile: { readonly id: string };
  /** Props it spills when it breaks. */
  readonly contents?: readonly { readonly id: string }[] | undefined;
  /** Passage it reveals when it breaks. */
  readonly reveals?: string | undefined;
}

/** A breakable as laid out: plain ids. */
export interface SceneBreakable {
  readonly profile: string;
  readonly contents: readonly string[];
  readonly reveals?: string;
}

/** A door spawn as written in data (mw-e03.18): its profile, lock and how it starts. */
export interface SceneDoorSpec {
  readonly profile: { readonly id: string };
  readonly lock?: { readonly id: string } | undefined;
  readonly locked?: boolean | undefined;
  readonly state?: 'closed' | 'open' | 'jammed' | undefined;
  readonly hinge?: DoorHinge | undefined;
  readonly swing?: DoorSwing | undefined;
}

/** A door as laid out: plain ids. */
export interface SceneDoor {
  readonly profile: string;
  readonly lock?: string;
  readonly locked?: boolean;
  readonly state?: 'closed' | 'open' | 'jammed';
  readonly hinge?: DoorHinge;
  readonly swing?: DoorSwing;
}

/** A switch spawn (mw-e03.18). */
export interface SceneSwitchSpec {
  readonly kind: SwitchKind;
  readonly positions?: number | undefined;
  readonly initial?: number | undefined;
}

/** A container spawn as written in data (mw-e18.3): its loot table, contents and lock. */
export interface SceneContainerSpec {
  readonly loot?: { readonly id: string } | undefined;
  readonly contents?:
    readonly { readonly item: { readonly id: string }; readonly count: number }[] | undefined;
  readonly lock?: { readonly id: string } | undefined;
  readonly locked?: boolean | undefined;
}

/** A container as laid out: plain ids. */
export interface SceneContainer {
  readonly loot?: string;
  readonly contents: readonly { readonly item: string; readonly count: number }[];
  readonly lock?: string;
  readonly locked?: boolean;
}

/** A signal graph placed in a scene (mw-e03.18): its id and binding renames. */
export interface SceneSignalSpec {
  readonly graph: { readonly id: string };
  readonly bindings?: Readonly<Record<string, string>> | undefined;
  /** Volume node ids of the graph that are checkpoints (autosave triggers, mw-e30.5). */
  readonly checkpoints?: readonly string[] | undefined;
}

/**
 * A placed signal graph as laid out: binding name → spawn id, for names that are not spawn ids, and
 * the graph's volume nodes that are checkpoints.
 */
export interface SceneSignal {
  readonly graph: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly checkpoints: readonly string[];
}

/** A way into another scene as written in data (mw-e01.11): a box in grid cells and where it leads. */
export interface SceneTransitionSpec {
  readonly id: string;
  readonly min: Triple;
  readonly max: Triple;
  readonly scene: { readonly id: string };
  readonly spawn: string;
  readonly follow: boolean;
}

/** A way into another scene as laid out: its volume in metres and where it leads. */
export interface SceneTransition {
  readonly id: string;
  readonly min: Vec3;
  readonly max: Vec3;
  /** The scene it leads to. */
  readonly scene: string;
  /** The spawn of that scene the player arrives at. */
  readonly spawn: string;
  /** Companions flagged to follow travel through it. */
  readonly follow: boolean;
}

/** A tagged box as written in data (mw-ju8.1): a river, a pool. */
export interface SceneRegionSpec {
  readonly id: string;
  readonly min: Triple;
  readonly max: Triple;
  readonly tags: readonly string[];
}

/** A tagged box as laid out: its corners in metres (water: wading and swimming, mw-e02.14). */
export interface SceneRegion {
  readonly id: string;
  readonly min: Vec3;
  readonly max: Vec3;
  readonly tags: readonly string[];
}

export interface ScenePlacementSpec {
  readonly piece: { readonly id: string };
  /** Grid cells. */
  readonly at: Triple;
  readonly yaw: SceneYaw;
  readonly scale: Triple;
  readonly purpose?: KitPurpose | undefined;
  /** World properties of the piece over the level material (e.g. climbable ivy). */
  readonly properties?: ScenePropertiesSpec | undefined;
  /** Ledge overrides, applied in order. */
  readonly ledges?: readonly LedgeOverrideSpec[] | undefined;
  /** Makes the piece breakable (mw-e03.11). */
  readonly breakable?: SceneBreakableSpec | undefined;
}

export interface SceneSpawnSpec {
  readonly id: string;
  /** Grid cells. */
  readonly at: Triple;
  readonly yaw: SceneYaw;
  readonly prop?: { readonly id: string } | undefined;
  readonly tags: readonly string[];
  /** Makes the spawned entity interactable (mw-e02.5). */
  readonly interact?: InteractableSpec | undefined;
  /** Makes the spawned entity a lock-on target with this profile (mw-e02.16). */
  readonly targetable?: { readonly id: string } | undefined;
  /** An item lying here as a world item (mw-e17.7). */
  readonly item?: { readonly id: { readonly id: string }; readonly count: number } | undefined;
  /** A creature to spawn here (mw-e12.4). */
  readonly creature?: { readonly id: string } | undefined;
  /** The faction the creature joins instead of its definition's. */
  readonly faction?: { readonly id: string } | undefined;
  /** The creature's patrol route, grid cells. */
  readonly patrol?: readonly Triple[] | undefined;
  /** The routes the creature walks, by route id, each in its window of hours (mw-e11.9). */
  readonly routine?: readonly SceneRoutineSpec[] | undefined;
  /** The creature's leash (mw-e01.17): metres around its post, grid cells (default the spawn). */
  readonly leash?: { readonly radius: number; readonly post?: Triple | undefined } | undefined;
  /** Opts the creature in to returning after a kill (mw-ju8.29). */
  readonly repopulate?: { readonly afterDays: number } | undefined;
  /** The clock phases the spawn's creature and interaction are there for (mw-ju8.14); absent = always. */
  readonly presence?: { readonly phases: readonly string[] } | undefined;
  /** What the creature carries and drops where it dies (mw-e01.5). */
  readonly carries?:
    readonly { readonly item: { readonly id: string }; readonly count: number }[] | undefined;
  /** World properties of the spawned entity (mw-e03.37: a torch that burns). */
  readonly properties?: ScenePropertiesSpec | undefined;
  /** Makes the spawned entity breakable (mw-e03.11). */
  readonly breakable?: SceneBreakableSpec | undefined;
  /** Makes the spawned entity a door (mw-e03.18). */
  readonly door?: SceneDoorSpec | undefined;
  /** Makes the spawned entity a switch (mw-e03.18). */
  readonly switch?: SceneSwitchSpec | undefined;
  /** Makes the spawned entity a lootable container (mw-e18.3). */
  readonly container?: SceneContainerSpec | undefined;
}

/** A named point routes walk through, grid cells (mw-e11.9). */
export interface SceneWaypointSpec {
  readonly id: string;
  readonly at: Triple;
  readonly dwellS?: number | undefined;
  readonly look?: number | undefined;
  readonly scanArc?: number | undefined;
  readonly scanS?: number | undefined;
  readonly idle?: string | undefined;
}

/** A patrol route over a scene's waypoints, by id (mw-e11.9). */
export interface SceneRouteSpec {
  readonly id: string;
  readonly kind: RouteKind;
  readonly waypoints: readonly string[];
  readonly links?:
    readonly { readonly from: string; readonly to: string; readonly weight: number }[] | undefined;
}

/** One entry of a spawn's routine (mw-e11.9). */
export interface SceneRoutineSpec {
  readonly route: string;
  readonly hours?: readonly [number, number] | undefined;
}

/** A box with its own ambient level, in grid cells (mw-e03.37). */
export interface SceneAmbientZoneSpec {
  readonly id: string;
  readonly min: Triple;
  readonly max: Triple;
  readonly level: number;
}

/** A directional light: direction of travel, level, and reach in metres (mw-e03.37). */
export interface SceneDirectionalLightSpec {
  readonly id: string;
  readonly direction: Triple;
  readonly level: number;
  readonly reach: number;
}

/** A scene's static lighting (mw-e03.37). */
export interface SceneLightSpec {
  readonly ambient?: number | undefined;
  readonly ambientZones?: readonly SceneAmbientZoneSpec[] | undefined;
  readonly directional?: readonly SceneDirectionalLightSpec[] | undefined;
}

/** A scene as the layout needs it; `GameEntry<'scene'>` satisfies it. */
export interface SceneSpec {
  readonly id: string;
  /** Metres per grid cell. */
  readonly grid: number;
  readonly placements: readonly ScenePlacementSpec[];
  readonly spawns: readonly SceneSpawnSpec[];
  /** Static lighting for the light field (mw-e03.37); none: dark but for emitters. */
  readonly light?: SceneLightSpec | undefined;
  /** Signal graphs wiring the scene's switches, volumes and doors (mw-e03.18). */
  readonly signals?: readonly SceneSignalSpec[] | undefined;
  /** Named points patrol routes walk through (mw-e11.9). */
  readonly waypoints?: readonly SceneWaypointSpec[] | undefined;
  /** Patrol routes and guard posts over the waypoints (mw-e11.9). */
  readonly routes?: readonly SceneRouteSpec[] | undefined;
  /** Volumes leading to other scenes (mw-e01.11). */
  readonly transitions?: readonly SceneTransitionSpec[] | undefined;
  /** Tagged boxes: rivers and pools (mw-ju8.1). */
  readonly regions?: readonly SceneRegionSpec[] | undefined;
}

/** Finds a kit piece by id (undefined when there is none). */
export type KitLookup = (id: string) => KitPieceSpec | undefined;

/** One part of one placed piece, in world space. */
export interface ScenePart {
  /** Index of the placement in the scene. */
  readonly placement: number;
  readonly piece: string;
  /** The placement's purpose, or else the piece's. */
  readonly purpose: KitPurpose;
  readonly shape: KitShape;
  /** Centre of the part, world metres. */
  readonly center: Vec3;
  /** Size along the part's own (unrotated) axes after the placement's scale, metres. */
  readonly size: Vec3;
  readonly yaw: SceneYaw;
  readonly rotation: Quat;
  /** World-space bounds (axis-aligned, exact for every part). */
  readonly min: Vec3;
  readonly max: Vec3;
  /** The static collider for the part, when it is solid. */
  readonly collider: StaticColliderDesc | undefined;
}

/** One placed piece: its origin and rotation, and the bounds of all its parts. */
export interface ScenePiecePlacement {
  readonly placement: number;
  readonly piece: string;
  readonly purpose: KitPurpose;
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly min: Vec3;
  readonly max: Vec3;
  /** The placement's world properties, when it sets any. */
  readonly properties?: ScenePropertiesSpec;
  /** The placement's ledge overrides, when it has any. */
  readonly ledges?: readonly LedgeOverrideSpec[];
  /** The piece's breakable profile and instance data, when it is breakable (mw-e03.11). */
  readonly breakable?: SceneBreakable;
}

/** One spawn in world space. */
export interface SceneSpawnPlacement {
  readonly id: string;
  readonly position: Vec3;
  readonly yaw: SceneYaw;
  readonly rotation: Quat;
  readonly prop: string | undefined;
  readonly tags: readonly string[];
  /** Its affordances, when the spawn is interactable (see src/sim/interaction). */
  readonly interact?: InteractableSpec | undefined;
  /** Its lock-on target profile, when it is targetable (see src/sim/targeting). */
  readonly targetable?: string | undefined;
  /** The item lying here (see src/sim/items), when there is one. */
  readonly item?: { readonly id: string; readonly count: number };
  /** The creature spawned here (see src/sim/creatures), when there is one. */
  readonly creature?: string;
  /** The faction that creature joins instead of its definition's. */
  readonly faction?: string;
  /** That creature's patrol route, world metres. */
  readonly patrol?: readonly Vec3[];
  /** The routes that creature walks, world metres (mw-e11.9). */
  readonly routine?: readonly PatrolRoutine[];
  /** That creature's leash, world metres (mw-e01.17): the post defaults to the spawn point. */
  readonly leash?: CreatureLeash;
  /** Returns after a kill once `afterDays` world days have passed (mw-ju8.29). */
  readonly repopulate?: { readonly afterDays: number };
  /** The clock phases that spawn's creature and interaction are there for (mw-ju8.14); absent = always. */
  readonly presence?: { readonly phases: readonly string[] };
  /** What that creature carries and drops where it dies (mw-e01.5), in order. */
  readonly carries?: readonly { readonly item: string; readonly count: number }[];
  /** Its world properties, when the spawn sets any (mw-e03.37). */
  readonly properties?: ScenePropertiesSpec;
  /** Its breakable profile and instance data, when it is breakable (mw-e03.11). */
  readonly breakable?: SceneBreakable;
  /** Its door data, when it is a door (mw-e03.18). */
  readonly door?: SceneDoor;
  /** Its switch data, when it is a switch (mw-e03.18). */
  readonly switch?: SceneSwitchSpec;
  /** Its container data, when it is a container (mw-e18.3). */
  readonly container?: SceneContainer;
}

export interface SceneLayout {
  readonly id: string;
  readonly pieces: readonly ScenePiecePlacement[];
  readonly parts: readonly ScenePart[];
  readonly spawns: readonly SceneSpawnPlacement[];
  /** The scene's static lighting in metres, for `LightField.setEnvironment` (mw-e03.37). */
  readonly light: LightEnvironment;
  /** Its placed signal graphs, in scene order (mw-e03.18). */
  readonly signals: readonly SceneSignal[];
  /** Its ways into other scenes, in scene order, in metres (mw-e01.11). */
  readonly transitions: readonly SceneTransition[];
  /** Its tagged boxes (water), in scene order, in metres. */
  readonly regions: readonly SceneRegion[];
}

/** Thrown when a scene names a kit piece the lookup does not have. */
export class SceneLayoutError extends Error {
  override readonly name = 'SceneLayoutError';
}

/** cos/sin of each yaw, exact. */
const TURNS: Record<SceneYaw, { readonly cos: number; readonly sin: number }> = {
  0: { cos: 1, sin: 0 },
  90: { cos: 0, sin: 1 },
  180: { cos: -1, sin: 0 },
  270: { cos: 0, sin: -1 },
};

const RISES: Record<SceneYaw, RampRise> = { 0: '+z', 90: '+x', 180: '-z', 270: '-x' };

const HALF = Math.SQRT1_2;
const ROTATIONS: Record<SceneYaw, Quat> = {
  0: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
  90: Object.freeze({ x: 0, y: HALF, z: 0, w: HALF }),
  180: Object.freeze({ x: 0, y: 1, z: 0, w: 0 }),
  270: Object.freeze({ x: 0, y: -HALF, z: 0, w: HALF }),
};

/** The rotation of a yaw, as a unit quaternion. */
export function yawRotation(yaw: SceneYaw): Quat {
  return ROTATIONS[yaw];
}

const vec = (x: number, y: number, z: number): Vec3 => Object.freeze({ x, y, z });

/** Turns `v` by `yaw` about +y. */
export function rotateYaw(v: Vec3, yaw: SceneYaw): Vec3 {
  const { cos, sin } = TURNS[yaw];
  // `+ 0` turns the -0 a zero coefficient can produce into 0, so equal layouts compare equal.
  return vec(v.x * cos + v.z * sin + 0, v.y, -v.x * sin + v.z * cos + 0);
}

function minOf(a: Vec3, b: Vec3): Vec3 {
  return vec(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
}

function maxOf(a: Vec3, b: Vec3): Vec3 {
  return vec(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
}

function gridToWorld(at: Triple, grid: number): Vec3 {
  return vec(at[0] * grid, at[1] * grid, at[2] * grid);
}

function layoutPart(
  part: KitPartSpec,
  placement: ScenePlacementSpec,
  index: number,
  origin: Vec3,
  purpose: KitPurpose,
): ScenePart {
  const { scale, yaw } = placement;
  const size = vec(part.size[0] * scale[0], part.size[1] * scale[1], part.size[2] * scale[2]);
  const offset = rotateYaw(
    vec(part.offset[0] * scale[0], part.offset[1] * scale[1], part.offset[2] * scale[2]),
    yaw,
  );
  const center = vec(origin.x + offset.x, origin.y + offset.y, origin.z + offset.z);
  const turned = rotateYaw(size, yaw);
  const half = vec(Math.abs(turned.x) / 2, turned.y / 2, Math.abs(turned.z) / 2);
  const min = vec(center.x - half.x, center.y - half.y, center.z - half.z);
  const max = vec(center.x + half.x, center.y + half.y, center.z + half.z);
  const collider: StaticColliderDesc | undefined = !part.collider
    ? undefined
    : part.shape === 'wedge'
      ? Object.freeze({ kind: 'ramp', min, max, rises: RISES[yaw] })
      : Object.freeze({ kind: 'box', min, max });
  return Object.freeze({
    placement: index,
    piece: placement.piece.id,
    purpose,
    shape: part.shape,
    center,
    size,
    yaw,
    rotation: ROTATIONS[yaw],
    min,
    max,
    collider,
  });
}

/** A breakable's data-file form as plain ids. */
function breakableOf(spec: SceneBreakableSpec): SceneBreakable {
  return Object.freeze({
    profile: spec.profile.id,
    contents: Object.freeze((spec.contents ?? []).map((prop) => prop.id)),
    ...(spec.reveals !== undefined && { reveals: spec.reveals }),
  });
}

/** A door's data-file form as plain ids. */
function doorOf(spec: SceneDoorSpec): SceneDoor {
  return Object.freeze({
    profile: spec.profile.id,
    ...(spec.lock !== undefined && { lock: spec.lock.id }),
    ...(spec.locked !== undefined && { locked: spec.locked }),
    ...(spec.state !== undefined && { state: spec.state }),
    ...(spec.hinge !== undefined && { hinge: spec.hinge }),
    ...(spec.swing !== undefined && { swing: spec.swing }),
  });
}

/** A switch's data without absent fields. */
function switchOf(spec: SceneSwitchSpec): SceneSwitchSpec {
  return Object.freeze({
    kind: spec.kind,
    ...(spec.positions !== undefined && { positions: spec.positions }),
    ...(spec.initial !== undefined && { initial: spec.initial }),
  });
}

/** A container's data-file form as plain ids. */
function containerOf(spec: SceneContainerSpec): SceneContainer {
  return Object.freeze({
    ...(spec.loot !== undefined && { loot: spec.loot.id }),
    contents: Object.freeze(
      (spec.contents ?? []).map(({ item, count }) => Object.freeze({ item: item.id, count })),
    ),
    ...(spec.lock !== undefined && { lock: spec.lock.id }),
    ...(spec.locked !== undefined && { locked: spec.locked }),
  });
}

/**
 * The scene's routes in world metres by id (mw-e11.9): each waypoint resolved from its id, and a
 * random route's links to indices into its waypoints.
 * @throws SceneLayoutError when a route names a waypoint the scene does not have.
 */
function sceneRoutes(scene: SceneSpec): Map<string, PatrolRoute> {
  const points = new Map<string, PatrolWaypoint>();
  for (const wp of scene.waypoints ?? []) {
    points.set(
      wp.id,
      Object.freeze({
        id: wp.id,
        at: gridToWorld(wp.at, scene.grid),
        ...(wp.dwellS !== undefined && { dwellS: wp.dwellS }),
        ...(wp.look !== undefined && { look: wp.look }),
        ...(wp.scanArc !== undefined && { scanArc: wp.scanArc }),
        ...(wp.scanS !== undefined && { scanS: wp.scanS }),
        ...(wp.idle !== undefined && { idle: wp.idle }),
      }),
    );
  }
  const routes = new Map<string, PatrolRoute>();
  for (const route of scene.routes ?? []) {
    const waypoints = route.waypoints.map((id) => {
      const wp = points.get(id);
      if (wp === undefined) {
        throw new SceneLayoutError(
          `scene "${scene.id}" route "${route.id}" names unknown waypoint "${id}"`,
        );
      }
      return wp;
    });
    const index = (id: string) => {
      const i = route.waypoints.indexOf(id);
      if (i < 0) {
        throw new SceneLayoutError(
          `scene "${scene.id}" route "${route.id}" links waypoint "${id}", which it does not list`,
        );
      }
      return i;
    };
    routes.set(
      route.id,
      Object.freeze({
        id: route.id,
        kind: route.kind,
        waypoints: Object.freeze(waypoints),
        ...(route.links !== undefined && {
          links: Object.freeze(
            route.links.map((link) =>
              Object.freeze({ from: index(link.from), to: index(link.to), weight: link.weight }),
            ),
          ),
        }),
      }),
    );
  }
  return routes;
}

/** A spawn's routine with its routes resolved (mw-e11.9). */
function routineOf(
  scene: SceneSpec,
  routes: ReadonlyMap<string, PatrolRoute>,
  spawn: SceneSpawnSpec,
  entries: readonly SceneRoutineSpec[],
): readonly PatrolRoutine[] {
  return Object.freeze(
    entries.map(({ route: id, hours }) => {
      const route = routes.get(id);
      if (route === undefined) {
        throw new SceneLayoutError(
          `scene "${scene.id}" spawn "${spawn.id}" names unknown route "${id}"`,
        );
      }
      return Object.freeze({
        route,
        ...(hours !== undefined && { hours: Object.freeze([hours[0], hours[1]] as const) }),
      });
    }),
  );
}

/**
 * Lays out every placement and spawn of `scene` in world space, in scene order.
 * @throws SceneLayoutError when a placement names a piece `kit` does not have, or a route or
 * routine names a waypoint or route the scene does not have.
 */
export function layoutScene(scene: SceneSpec, kit: KitLookup): SceneLayout {
  const pieces: ScenePiecePlacement[] = [];
  const parts: ScenePart[] = [];
  scene.placements.forEach((placement, index) => {
    const piece = kit(placement.piece.id);
    if (piece === undefined) {
      throw new SceneLayoutError(
        `scene "${scene.id}" placement ${String(index)} uses unknown kit piece "${placement.piece.id}"`,
      );
    }
    if (piece.parts.length === 0) {
      throw new SceneLayoutError(`kit piece "${piece.id}" has no parts`);
    }
    const origin = gridToWorld(placement.at, scene.grid);
    const purpose = placement.purpose ?? piece.purpose;
    const own = piece.parts.map((part) => layoutPart(part, placement, index, origin, purpose));
    parts.push(...own);
    pieces.push(
      Object.freeze({
        placement: index,
        piece: piece.id,
        purpose,
        position: origin,
        rotation: ROTATIONS[placement.yaw],
        min: own.map((p) => p.min).reduce(minOf),
        max: own.map((p) => p.max).reduce(maxOf),
        ...(placement.properties !== undefined && { properties: placement.properties }),
        ...(placement.ledges !== undefined && { ledges: placement.ledges }),
        ...(placement.breakable !== undefined && { breakable: breakableOf(placement.breakable) }),
      }),
    );
  });
  const routes = sceneRoutes(scene);
  const spawns = scene.spawns.map((spawn) =>
    Object.freeze({
      id: spawn.id,
      position: gridToWorld(spawn.at, scene.grid),
      yaw: spawn.yaw,
      rotation: ROTATIONS[spawn.yaw],
      prop: spawn.prop?.id,
      tags: Object.freeze([...spawn.tags]),
      interact: spawn.interact,
      targetable: spawn.targetable?.id,
      ...(spawn.item !== undefined && {
        item: Object.freeze({ id: spawn.item.id.id, count: spawn.item.count }),
      }),
      ...(spawn.creature !== undefined && { creature: spawn.creature.id }),
      ...(spawn.faction !== undefined && { faction: spawn.faction.id }),
      ...(spawn.patrol !== undefined && {
        patrol: Object.freeze(spawn.patrol.map((at) => gridToWorld(at, scene.grid))),
      }),
      ...(spawn.routine !== undefined && {
        routine: routineOf(scene, routes, spawn, spawn.routine),
      }),
      ...(spawn.leash !== undefined && {
        leash: Object.freeze({
          radius: spawn.leash.radius,
          post: gridToWorld(spawn.leash.post ?? spawn.at, scene.grid),
        }),
      }),
      ...(spawn.repopulate !== undefined && {
        repopulate: Object.freeze({ afterDays: spawn.repopulate.afterDays }),
      }),
      ...(spawn.presence !== undefined && {
        presence: Object.freeze({ phases: Object.freeze([...spawn.presence.phases]) }),
      }),
      ...(spawn.carries !== undefined && {
        carries: Object.freeze(
          spawn.carries.map(({ item, count }) => Object.freeze({ item: item.id, count })),
        ),
      }),
      ...(spawn.properties !== undefined && { properties: spawn.properties }),
      ...(spawn.breakable !== undefined && { breakable: breakableOf(spawn.breakable) }),
      ...(spawn.door !== undefined && { door: doorOf(spawn.door) }),
      ...(spawn.switch !== undefined && { switch: switchOf(spawn.switch) }),
      ...(spawn.container !== undefined && { container: containerOf(spawn.container) }),
    }),
  );
  return Object.freeze({
    id: scene.id,
    pieces: Object.freeze(pieces),
    parts: Object.freeze(parts),
    spawns: Object.freeze(spawns),
    light: sceneLight(scene.light, scene.grid),
    signals: Object.freeze(
      (scene.signals ?? []).map((signal) =>
        Object.freeze({
          graph: signal.graph.id,
          bindings: Object.freeze({ ...signal.bindings }),
          checkpoints: Object.freeze([...(signal.checkpoints ?? [])]),
        }),
      ),
    ),
    regions: Object.freeze(
      (scene.regions ?? []).map((r) =>
        Object.freeze({
          id: r.id,
          min: gridToWorld(r.min, scene.grid),
          max: gridToWorld(r.max, scene.grid),
          tags: Object.freeze([...r.tags]),
        }),
      ),
    ),
    transitions: Object.freeze(
      (scene.transitions ?? []).map((t) =>
        Object.freeze({
          id: t.id,
          min: gridToWorld(t.min, scene.grid),
          max: gridToWorld(t.max, scene.grid),
          scene: t.scene.id,
          spawn: t.spawn,
          follow: t.follow,
        }),
      ),
    ),
  });
}

/**
 * A scene's light data as the light field takes it (mw-e03.37): zone bounds from grid cells to
 * metres; directions and reach as written. Values are validated by the field.
 */
export function sceneLight(light: SceneLightSpec | undefined, grid: number): LightEnvironment {
  if (light === undefined) return Object.freeze({});
  return Object.freeze({
    ...(light.ambient !== undefined && { ambient: light.ambient }),
    ambientZones: Object.freeze(
      (light.ambientZones ?? []).map((zone) =>
        Object.freeze({
          id: zone.id,
          min: gridToWorld(zone.min, grid),
          max: gridToWorld(zone.max, grid),
          level: zone.level,
        }),
      ),
    ),
    directional: Object.freeze(
      (light.directional ?? []).map((d) =>
        Object.freeze({ id: d.id, direction: vec(...d.direction), level: d.level, reach: d.reach }),
      ),
    ),
  });
}
