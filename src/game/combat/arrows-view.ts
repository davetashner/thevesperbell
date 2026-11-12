// Arrows on screen (mw-e05.21): the glue between the sim's arrows (src/sim/combat/arrows) and their
// grey-box shafts (src/render/combat/arrow.ts). Presentation only: nothing here writes to the sim.
//
// - `readArrowTransform` places a shaft for render sync: its tip at the arrow's position, pointing
//   along its flight (its velocity in the air, its landing direction at rest). The shaft model's tip
//   is at its origin and it points along +z.
// - `bindArrows` gives every arrow without one a shaft after each step, whether flying or at rest;
//   render sync drops a shaft when its arrow leaves the world (shattered, expired). A creature's
//   projectile attack (an archer's shot, mw-ju8.19) flies as a `ProjectileComponent`, not an arrow
//   of the bow system; it gets the same shaft, pointing along its flight.
// - `arrowReadout` is what the e2e reads (#app[data-arrows]): how many arrows fly, are stuck or lie
//   dropped, and the latest arrow's state, where it is, what it is stuck in and whether its shaft is
//   drawn and on screen.
//
// No arrow, no cost: a world without the arrow system binds and reports nothing, and one whose arrows
// are all bound only walks two empty-or-small queries per step.

import {
  ArrowComponent,
  arrowDirection,
  ArrowRestComponent,
  ProjectileComponent,
  type EntityId,
  type Vec3,
  type World,
} from '@sim/index';
import type { ProjectToNdc } from '../creatures';
import type { Quat, RenderSync, SceneBinding, SimView, Transform } from '../loop/render-sync';
import { withWobble } from '../vfx/arrow-fx.ts';

/** The rotation that turns +z onto unit direction `d`. */
export function pointAlong(d: Vec3): Quat {
  const w = 1 + d.z;
  // Pointing straight back along −z: half a turn about +y.
  if (w < 1e-9) return { x: 0, y: 1, z: 0, w: 0 };
  const x = -d.y + 0;
  const y = d.x;
  const length = Math.sqrt(x * x + y * y + w * w);
  return { x: x / length, y: y / length, z: 0, w: w / length };
}

/** An arrow's transform for render sync (see the file header); undefined for anything else. */
export function readArrowTransform(view: SimView, entity: EntityId): Transform | undefined {
  const flight = view.isRegistered(ArrowComponent) ? view.get(entity, ArrowComponent) : undefined;
  if (flight !== undefined) {
    return { position: flight.position, rotation: pointAlong(arrowDirection(flight)) };
  }
  const shot = view.isRegistered(ProjectileComponent)
    ? view.get(entity, ProjectileComponent)
    : undefined;
  if (shot !== undefined) {
    return { position: shot.position, rotation: pointAlong(shot.direction) };
  }
  const rest = view.isRegistered(ArrowRestComponent)
    ? view.get(entity, ArrowRestComponent)
    : undefined;
  if (rest === undefined) return undefined;
  return { position: rest.position, rotation: pointAlong(rest.direction) };
}

/**
 * `readArrowTransform` with the quiver of an arrow that just stuck (mw-e29.11): `wobble` gives the
 * angle in radians (0 when the arrow is still), applied about the shaft's own sideways axis at its tip.
 */
export function readWobbledArrowTransform(
  view: SimView,
  entity: EntityId,
  wobble: (arrow: EntityId) => number,
): Transform | undefined {
  const transform = readArrowTransform(view, entity);
  if (transform === undefined) return undefined;
  const angle = wobble(entity);
  if (angle === 0) return transform;
  return { position: transform.position, rotation: withWobble(transform.rotation, angle) };
}

/**
 * Binds a shaft to every arrow not bound yet (call after each sim step); `create` builds it. Returns
 * how many it bound.
 */
export function bindArrows<TObject>(
  world: World<never>,
  sync: RenderSync,
  create: (entity: EntityId) => SceneBinding<TObject>,
): number {
  const unbound: EntityId[] = [];
  const collect = (entity: EntityId): void => {
    if (!sync.has(entity)) unbound.push(entity);
  };
  if (world.isRegistered(ArrowComponent)) {
    world.query(ArrowComponent).forEach(collect);
    world.query(ArrowRestComponent).forEach(collect);
  }
  if (world.isRegistered(ProjectileComponent)) world.query(ProjectileComponent).forEach(collect);
  for (const entity of unbound) sync.bind(entity, create(entity));
  return unbound.length;
}

/** Where an arrow is in its life. */
export type ArrowState = 'flying' | 'stuck' | 'dropped';

/** The latest arrow in a readout. */
export interface LatestArrow {
  readonly entity: EntityId;
  /** Arrow content id. */
  readonly arrow: string;
  readonly state: ArrowState;
  /** Its tip, metres (rounded to 0.1 mm). */
  readonly position: Vec3;
  /** What it is stuck in or lying on (an entity, or null for unbound level geometry); null flying. */
  readonly in: EntityId | null;
  /** It has a shaft. */
  readonly drawn: boolean;
  /** Its tip projects inside the camera's view. */
  readonly onScreen: boolean;
}

/** The arrows now (see the file header). */
export interface ArrowReadout {
  readonly flying: number;
  readonly stuck: number;
  readonly dropped: number;
  /** How many of the stuck and dropped arrows came to rest whole (the rest are broken; whole ones can be taken back). */
  readonly intact: number;
  /** The arrow with the highest entity id (the latest loosed), or null with none. */
  readonly latest: LatestArrow | null;
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4 + 0;

const inView = ({ x, y, z }: Vec3): boolean => Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= 1;

/**
 * `world`'s arrows (all zero without the arrow system). Without `project`, none counts as on screen.
 */
export function arrowReadout(
  world: World<never>,
  isBound: (entity: EntityId) => boolean,
  project: ProjectToNdc = () => ({ x: 2, y: 2, z: 2 }),
): ArrowReadout {
  const counts = { flying: 0, stuck: 0, dropped: 0, intact: 0 };
  if (!world.isRegistered(ArrowComponent)) return { ...counts, latest: null };
  let latest: Omit<LatestArrow, 'drawn' | 'onScreen'> | undefined;
  const note = (entry: Omit<LatestArrow, 'drawn' | 'onScreen'>, intact = false): void => {
    counts[entry.state] += 1;
    if (intact) counts.intact += 1;
    if (latest === undefined || entry.entity > latest.entity) latest = entry;
  };
  world.query(ArrowComponent).forEach((entity, flight) => {
    note({ entity, arrow: flight.arrow, state: 'flying', position: flight.position, in: null });
  });
  world.query(ArrowRestComponent).forEach((entity, rest) => {
    note(
      { entity, arrow: rest.arrow, state: rest.state, position: rest.position, in: rest.in },
      rest.intact,
    );
  });
  if (latest === undefined) return { ...counts, latest: null };
  const { x, y, z } = latest.position;
  const drawn = isBound(latest.entity);
  return {
    ...counts,
    latest: {
      ...latest,
      position: { x: round(x), y: round(y), z: round(z) },
      drawn,
      onScreen: drawn && inView(project(latest.position)),
    },
  };
}
