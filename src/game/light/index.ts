// Light in the game (mw-e03.37). The sim's LightField (src/sim/light) decides how lit every position
// is; the renderer only mirrors it, so what looks lit is what guards see. This module wires the field
// into the game world and turns its state into what the renderer draws:
//
// - `createGameLight`: one field per world, and one collider sink that feeds both the physics port and
//   the field's static occluders under one handle (ColliderFanOut), so a level piece that burns away
//   stops blocking light and movement together (mw-e03.42). Hand `colliders` to the scene loader and
//   to installGamePhysics as `levelColliders`.
// - `installGameLight`: registers the field on the world and adds its per-tick system. Add it after
//   the physics objects (so moved props light from where they are now).
// - `selectLights`: the per-frame cap. The style bible allows at most 8 dynamic point lights per
//   pixel (High; 4 on Low), so the renderer keeps a fixed pool and fills it with the emitters that
//   matter most to the camera: those whose reach is nearest to it.
// - `lightReadout` and `lightProbe`: the e2e's view of sim and render light (AC-1, AC-3).

import {
  ColliderFanOut,
  installLightField,
  LightField,
  lightFieldSystem,
  PlacementComponent,
  readProperty,
  type EntityId,
  type LightEmitterView,
  type LoadedScene,
  type StaticColliderSink,
  type Vec3,
  type World,
} from '@sim/index';

export interface GameLight {
  readonly field: LightField;
  /** The level's collider sink: `physics` first, the field's static occluders following. */
  readonly colliders: ColliderFanOut;
}

/** A light field and the collider sink that feeds it and `physics` together. */
export function createGameLight(physics: StaticColliderSink): GameLight {
  const field = new LightField();
  return { field, colliders: new ColliderFanOut(physics, field.statics) };
}

/**
 * Registers `field` on `world` (which needs world properties and placements, e.g. from
 * installGamePhysics) and adds the system that gathers its sources every tick.
 */
export function installGameLight<T>(world: World<T>, field: LightField): World<T> {
  const sim = world as unknown as World<never>; // the light field never reads inputs
  installLightField(sim, field);
  world.addSystem(lightFieldSystem<T>(field));
  return world;
}

/** How many lights of each kind the renderer's pool holds. */
export interface LightCaps {
  readonly points: number;
  readonly spots: number;
}

/** The lights the renderer draws this frame. */
export interface LightSelection {
  readonly points: readonly LightEmitterView[];
  readonly spots: readonly LightEmitterView[];
}

/** How far `focus` is from the edge of what `light` reaches (negative inside it). */
function reachDistance(light: LightEmitterView, focus: Vec3): number {
  const { x, y, z } = light.position;
  return Math.hypot(x - focus.x, y - focus.y, z - focus.z) - light.radius;
}

/**
 * The emitters to draw: point lights and spotlights each capped by `caps`, the ones whose reach is
 * nearest `focus` first (ties keep the field's order, so the choice is stable frame to frame).
 */
export function selectLights(
  lights: readonly LightEmitterView[],
  focus: Vec3,
  caps: LightCaps,
): LightSelection {
  const ranked = lights
    .map((light, index) => ({ light, index, distance: reachDistance(light, focus) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ light }) => light);
  return {
    points: ranked.filter((light) => light.cone === null).slice(0, caps.points),
    spots: ranked.filter((light) => light.cone !== null).slice(0, caps.spots),
  };
}

/** Whether an emitter is a fire (burning), so the renderer tints it as flame rather than lamplight. */
export function isFire(world: World, light: LightEmitterView): boolean {
  return light.entity !== null && readProperty(world as World<never>, light.entity, 'burning');
}

/** A scene spawn that starts as a light source (a torch, a burning crate, a lamp): what the e2e watches. */
export interface LightSpawn {
  readonly id: string;
  readonly entity: EntityId;
}

/**
 * The spawns of `loaded` whose world properties make them light sources (`burning` or
 * `lightEmitter`), in scene order. Other property spawns (the perf-baseline's pushable crates,
 * mw-e32.1) are not watched, so a busy scene does not republish their light every frame.
 */
export function lightSpawns(loaded: LoadedScene): LightSpawn[] {
  return loaded.spawns
    .filter(
      ({ spawn }) =>
        spawn.lightSource !== undefined ||
        spawn.properties?.burning !== undefined ||
        spawn.properties?.lightEmitter !== undefined,
    )
    .map(({ entity, spawn }) => ({ id: spawn.id, entity }));
}

/** An [r, g, b] colour, each 0-1. */
export type Tint = readonly [number, number, number];

/**
 * The colour tints that `loaded`'s light source spawns declare (`lightSource.tint`), by entity, for
 * the light rig. Spawns without a tint keep the rig's flame or lamp colour.
 */
export function lightTints(loaded: LoadedScene): Map<EntityId, Tint> {
  const tints = new Map<EntityId, Tint>();
  for (const { entity, spawn } of loaded.spawns) {
    if (spawn.lightSource?.tint !== undefined) tints.set(entity, spawn.lightSource.tint);
  }
  return tints;
}

/** One watched spawn: the sim level where it stands and the intensity its rendered light has. */
export interface LightSpawnReadout {
  readonly entity: EntityId;
  readonly sim: number;
  readonly rendered: number;
}

/** Sim and rendered light of the watched spawns as of the last tick (AC-3). */
export interface LightReadout {
  readonly tick: number;
  readonly spawns: Readonly<Record<string, LightSpawnReadout>>;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * What the e2e reads: for each watched spawn still in the world, the sim's light level at its
 * placement and the intensity of the rendered light drawn for it (0 when none is).
 */
export function lightReadout(
  world: World,
  field: LightField,
  spawns: readonly LightSpawn[],
  rendered: ReadonlyMap<EntityId, number>,
): LightReadout {
  const out: Record<string, LightSpawnReadout> = {};
  for (const { id, entity } of spawns) {
    const at = world.isAlive(entity) ? world.get(entity, PlacementComponent) : undefined;
    if (at === undefined) continue;
    out[id] = {
      entity,
      sim: round(field.levelAt(at)),
      rendered: round(rendered.get(entity) ?? 0),
    };
  }
  return { tick: world.tick, spawns: out };
}

/** Points at the centre of every 1 m cell of the box `min`–`max` (x, z), `height` above its top. */
export function probeGrid(min: Vec3, max: Vec3, height: number): Vec3[] {
  const points: Vec3[] = [];
  for (let z = Math.floor(min.z) + 0.5; z < max.z; z++) {
    for (let x = Math.floor(min.x) + 0.5; x < max.x; x++) {
      if (x > min.x && z > min.z) points.push({ x, y: max.y + height, z });
    }
  }
  return points;
}

/** One probe point: where it is, the sim's level there and where it lands on screen. */
export interface LightProbeSample {
  readonly at: Vec3;
  readonly level: number;
  /** Normalised device coordinates, x and y in −1…1 when on screen. */
  readonly ndc: { readonly x: number; readonly y: number };
}

/**
 * The parity probe (AC-1): the sim's level at every point the camera can see (`visible`), with its
 * screen position from `project`. The e2e reads the rendered luminance there and rank-correlates.
 */
export function lightProbe(
  field: LightField,
  points: readonly Vec3[],
  project: (point: Vec3) => { readonly x: number; readonly y: number; readonly z: number },
  visible: (point: Vec3) => boolean,
): LightProbeSample[] {
  const samples: LightProbeSample[] = [];
  for (const at of points) {
    const ndc = project(at);
    if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1 || Math.abs(ndc.z) > 1 || !visible(at)) continue;
    samples.push({
      at,
      level: round(field.levelAt(at)),
      ndc: { x: round(ndc.x), y: round(ndc.y) },
    });
  }
  return samples;
}
