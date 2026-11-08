// Light beams (mw-e03.17): sunlight shafts, crystals and spells cast a deterministic segmented ray
// through the level. What a beam meets is decided by world properties, never by pairing types:
//
// - `reflective` bounces it: a mirror with an optic (`light.optic`) is a flat disc facing its normal,
//   a reflective thing without one bounces it off its bounding sphere. At most `maxBounces` bounces
//   (default 8), so two mirrors facing each other end the trace instead of hanging it.
// - `transparent` (and `frozen` things that do not block light: ice) lets it through, dimmed and
//   re-coloured by the optic's tint. A lens is a transparent optic with `focus` > 1: it multiplies
//   the beam's intensity, and a focused beam is hot.
// - `opaque` stops it, and so do actors (creatures, the player), a thing that is neither reflective
//   nor transparent, and the level's static geometry (the light field's occluders).
// - A light receiver (`light.receiver`) is a sensor that swallows the beam; the beam's intensity there
//   is what its dwell logic reads (mechanisms/receivers.ts).
//
// A mirror's normal is its optic's normal turned about the vertical by the push rules' rotation
// (`push.config` angle, degrees), so rotating a mirror re-aims every beam that bounces off it on the
// next trace. Where a beam ends it lights the spot (a continuous `light` stimulus, so the light field
// shows the dot) and, when it has been focused, heats it through the one stimulus API: the fire rules
// do the rest. The trace is rebuilt every tick from components and properties, so it is derived state
// outside the world's snapshots (like the light field); only receivers keep dwell state.
// Only + - * / and the sim's own sin/cos/sqrt are used, so every trace is bit-for-bit repeatable.

import { defineComponent, type EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { CharacterController } from '../character/system';
import { CreatureComponent } from '../creatures/components';
import { PushConfigComponent } from '../push/state';
import { assignProperty, readProperty } from '../properties/components';
import { hasTag, TagsComponent } from '../signals/filter';
import { boundingSphereOf, PlacementComponent, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { applyStimulus } from '../stimulus/stimulus';
import { cos, sin } from '../math';
import type { Occluder, StaticOccluders } from './occluders';

/** Beam emitter kinds. */
export const BEAM_KINDS = ['sunlight', 'crystal', 'spell'] as const;
export type BeamKind = (typeof BEAM_KINDS)[number];

/** Optic kinds: a mirror bounces, a lens focuses, a pane only tints. */
export const OPTIC_KINDS = ['mirror', 'lens', 'pane'] as const;
export type OpticKind = (typeof OPTIC_KINDS)[number];

/** Bounces a beam survives unless its emitter says otherwise. */
export const DEFAULT_MAX_BOUNCES = 8;
/** Longest a beam segment runs, metres, unless its emitter says otherwise. */
export const DEFAULT_BEAM_RANGE = 40;
/** Segments one trace may have, so a pathological scene cannot make a tick expensive. */
export const MAX_BEAM_SEGMENTS = 64;
/** Light units a beam of intensity 1 puts where it ends (the light field's scale: 100 is full). */
export const BEAM_LIGHT_UNITS = 40;
/** Radius of the lit spot where a beam ends, metres. */
export const BEAM_SPOT_RADIUS = 1;
/** Heat a focused beam of intensity 1 delivers, °C per second. */
export const BEAM_HEAT_PER_SECOND = 400;
/** Radius of the heated spot where a focused beam ends on bare level geometry, metres. */
export const BEAM_HEAT_RADIUS = 0.25;
/** How alike (cosine of the angle between colours) a beam and a receiver's filter must be. */
export const COLOUR_MATCH = 0.9;

/** Colour as red, green and blue shares, each 0…1 (components use `Vec3`: x r, y g, z b). */
export type Colour = Vec3;
export const WHITE: Colour = Object.freeze({ x: 1, y: 1, z: 1 });

/** What a beam emitter defaults to, by kind. */
export const BEAM_PREFABS: Readonly<
  Record<BeamKind, { readonly intensity: number; readonly range: number; readonly colour: Colour }>
> = Object.freeze({
  sunlight: Object.freeze({ intensity: 1, range: 60, colour: WHITE }),
  crystal: Object.freeze({ intensity: 0.8, range: 30, colour: WHITE }),
  spell: Object.freeze({ intensity: 1.2, range: 30, colour: WHITE }),
});

/** A beam emitter (`light.beam`; a snapshot and save key, never renamed). Its origin is its placement. */
export interface BeamEmitter {
  readonly kind: BeamKind;
  /** Unit direction it shines along. */
  readonly direction: Vec3;
  /** Strength, 1 = a sunbeam. */
  readonly intensity: number;
  readonly colour: Colour;
  /** Longest a segment runs, metres. */
  readonly range: number;
  readonly maxBounces: number;
  readonly active: boolean;
}

export const BeamEmitterComponent = defineComponent<BeamEmitter>('light.beam');

/** The shape and optics of a mirror, lens or pane (`light.optic`). */
export interface Optic {
  readonly kind: OpticKind;
  /** Unit normal before the push rotation is applied. */
  readonly normal: Vec3;
  /** Radius of its disc, metres. */
  readonly radius: number;
  /** Intensity multiplier of a lens (1: none). */
  readonly focus: number;
  /** What it lets through of each colour channel, 0…1 (a pane or lens may tint). */
  readonly tint: Colour;
}

export const OpticComponent = defineComponent<Optic>('light.optic');

/** How a light receiver behaves once its beam goes. */
export const RECEIVER_MODES = ['momentary', 'latching'] as const;
export type ReceiverMode = (typeof RECEIVER_MODES)[number];

/** What defines a light receiver (a scene spawn's `lightReceiver` data). */
export interface LightReceiverSpec {
  /** Intensity at or above which it counts. */
  readonly threshold: number;
  /** Seconds it must be held at or above the threshold before it turns on. */
  readonly dwellSeconds: number;
  /** Only beams of about this colour count; null: any colour. */
  readonly filter: Colour | null;
  readonly mode: ReceiverMode;
  /** Radius of the sensor, metres. */
  readonly radius: number;
}

/** A light receiver (`mechanisms.lightReceiver`; a snapshot and save key, never renamed). */
export interface LightReceiver extends LightReceiverSpec {
  readonly active: boolean;
  /** Ticks the intensity has been at or above the threshold without a break. */
  readonly held: number;
  /** Matching intensity it got at the last tick. */
  readonly intensity: number;
}

export const LightReceiverComponent = defineComponent<LightReceiver>('mechanisms.lightReceiver');

/** One straight run of a beam. */
export interface BeamSegment {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly intensity: number;
  readonly colour: Colour;
}

/** Why a beam ended. */
export type BeamEnd = 'range' | 'wall' | 'opaque' | 'actor' | 'receiver' | 'bounces' | 'segments';

/** A traced beam. */
export interface BeamPath {
  readonly emitter: EntityId;
  readonly segments: readonly BeamSegment[];
  readonly end: BeamEnd;
  /** What it ended on (an actor, a receiver, an opaque thing), or null. */
  readonly target: EntityId | null;
  /** Intensity and colour of its last segment. */
  readonly intensity: number;
  readonly colour: Colour;
  /** It passed a lens (focus above 1). */
  readonly focused: boolean;
  readonly bounces: number;
}

/** Where beams read what the world cannot tell them by properties alone. */
export interface BeamOptions {
  /** The level's static geometry (the light field's `statics`); none: nothing but things block. */
  readonly statics?: Pick<StaticOccluders, 'along'>;
}

const EPS = 1e-6;

const known = <T>(value: T | undefined): T => value as T;

const isVec = (value: unknown): value is Vec3 => {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y, z } = value as Record<string, unknown>;
  return [x, y, z].every((n) => typeof n === 'number' && Number.isFinite(n));
};

function unit(what: string, value: Vec3): Vec3 {
  if (!isVec(value)) throw new RangeError(`${what} must be a vector`);
  const len = Math.sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
  if (!(len > 0)) throw new RangeError(`${what} must not be zero`);
  return Object.freeze({ x: value.x / len, y: value.y / len, z: value.z / len });
}

function colourOf(what: string, value: Colour): Colour {
  if (!isVec(value) || [value.x, value.y, value.z].some((n) => n < 0 || n > 1)) {
    throw new RangeError(`${what} must be red, green and blue each in [0, 1]`);
  }
  if (!(value.x > 0 || value.y > 0 || value.z > 0)) {
    throw new RangeError(`${what} must not be black`);
  }
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
}

/**
 * Makes `entity` a beam emitter at `origin` (a sunlight shaft, a crystal, a spell), shining along
 * `direction`. Like `World.add`, deferred to the end of the tick during a step; it is placed (a
 * point) when it has no placement.
 * @throws RangeError for a zero direction, a bad colour or an intensity, range or bounce count that
 * makes no sense.
 */
export function makeBeamEmitter(
  world: World<never>,
  entity: EntityId,
  kind: BeamKind,
  origin: Vec3,
  direction: Vec3,
  options: {
    readonly intensity?: number;
    readonly colour?: Colour;
    readonly range?: number;
    readonly maxBounces?: number;
    readonly active?: boolean;
  } = {},
): void {
  const prefab = BEAM_PREFABS[kind];
  const intensity = options.intensity ?? prefab.intensity;
  const range = options.range ?? prefab.range;
  const maxBounces = options.maxBounces ?? DEFAULT_MAX_BOUNCES;
  if (!(Number.isFinite(intensity) && intensity > 0)) {
    throw new RangeError('a beam needs an intensity above 0');
  }
  if (!(Number.isFinite(range) && range > 0))
    throw new RangeError('a beam needs a range above 0 m');
  if (!(Number.isInteger(maxBounces) && maxBounces >= 0)) {
    throw new RangeError('a beam needs a whole number of bounces, 0 or more');
  }
  world.add(entity, BeamEmitterComponent, {
    kind,
    direction: unit('beam direction', direction),
    intensity,
    colour: colourOf('beam colour', options.colour ?? prefab.colour),
    range,
    maxBounces,
    active: options.active ?? true,
  });
  if (!world.has(entity, PlacementComponent)) placeEntity(world, entity, origin);
}

/** Turns an emitter on or off (a spell ending, a cloud over the sun). False: not an emitter. */
export function setBeamActive(world: World<never>, entity: EntityId, active: boolean): boolean {
  const beam = world.get(entity, BeamEmitterComponent);
  if (beam === undefined) return false;
  if (beam.active !== active) world.set(entity, BeamEmitterComponent, { ...beam, active });
  return true;
}

/**
 * Makes `entity` a mirror, lens or pane: a disc of `radius` facing `normal` at its placement (placed
 * as a sphere of that radius when it has none). A mirror becomes `reflective`, a lens or pane
 * `transparent`; properties are what the beams read.
 * @throws RangeError for a zero normal, a radius, focus or tint that makes no sense.
 */
export function makeOptic(
  world: World<never>,
  entity: EntityId,
  kind: OpticKind,
  origin: Vec3,
  normal: Vec3,
  options: { readonly radius?: number; readonly focus?: number; readonly tint?: Colour } = {},
): void {
  const radius = options.radius ?? 0.5;
  const focus = options.focus ?? 1;
  if (!(Number.isFinite(radius) && radius > 0))
    throw new RangeError('an optic needs a radius above 0 m');
  if (!(Number.isFinite(focus) && focus >= 1))
    throw new RangeError('an optic focus must be 1 or more');
  world.add(entity, OpticComponent, {
    kind,
    normal: unit('optic normal', normal),
    radius,
    focus: kind === 'lens' ? focus : 1,
    tint: colourOf('optic tint', options.tint ?? WHITE),
  });
  if (!world.has(entity, PlacementComponent)) placeEntity(world, entity, origin, radius);
  if (kind === 'mirror') assignProperty(world, entity, 'reflective', true);
  else assignProperty(world, entity, 'transparent', true);
}

/**
 * Makes `entity` a light receiver at `origin`, off at first. Like `World.add`, deferred to the end of
 * the tick during a step; it is placed (a sphere of its radius) when it has no placement.
 * @throws RangeError for a threshold, dwell, radius or filter that makes no sense.
 */
export function makeLightReceiver(
  world: World<never>,
  entity: EntityId,
  origin: Vec3,
  spec: Partial<LightReceiverSpec> = {},
): void {
  const receiver = {
    threshold: 0.5,
    dwellSeconds: 0,
    filter: null,
    mode: 'momentary',
    radius: 0.3,
    ...spec,
  };
  if (!(Number.isFinite(receiver.threshold) && receiver.threshold > 0)) {
    throw new RangeError('a light receiver needs a threshold above 0');
  }
  if (!(Number.isFinite(receiver.dwellSeconds) && receiver.dwellSeconds >= 0)) {
    throw new RangeError('light receiver dwell must be 0 s or more');
  }
  if (!(Number.isFinite(receiver.radius) && receiver.radius > 0)) {
    throw new RangeError('a light receiver needs a radius above 0 m');
  }
  world.add(entity, LightReceiverComponent, {
    ...receiver,
    filter: receiver.filter === null ? null : colourOf('receiver filter', receiver.filter),
    active: false,
    held: 0,
    intensity: 0,
  });
  if (!world.has(entity, PlacementComponent)) placeEntity(world, entity, origin, receiver.radius);
}

/** Whether a beam of `beam` colour passes a receiver's `filter` (null: any colour does). */
export function colourPasses(beam: Colour, filter: Colour | null): boolean {
  if (filter === null) return true;
  const dot = beam.x * filter.x + beam.y * filter.y + beam.z * filter.z;
  const lengths =
    Math.sqrt(beam.x * beam.x + beam.y * beam.y + beam.z * beam.z) *
    Math.sqrt(filter.x * filter.x + filter.y * filter.y + filter.z * filter.z);
  return lengths > 0 && dot / lengths >= COLOUR_MATCH;
}

/** What a beam does to a thing it hits. */
type Reaction = 'reflect' | 'pass' | 'stop' | 'receive';

/** One thing a beam can meet this tick, flat numbers. */
interface Target {
  readonly entity: EntityId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Bounding radius, or the optic's disc radius when `planar`. */
  readonly r: number;
  readonly reaction: Reaction;
  readonly actor: boolean;
  /** A flat disc facing (nx, ny, nz); otherwise a sphere. */
  readonly planar: boolean;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly focus: number;
  readonly tint: Colour | null;
}

/** The mirror normal turned by the push rotation (degrees about the vertical, as the push rules do). */
function turned(normal: Vec3, degrees: number): Vec3 {
  if (degrees === 0) return normal;
  const half = (degrees * Math.PI) / 180;
  const c = cos(half);
  const s = sin(half);
  return { x: normal.x * c + normal.z * s, y: normal.y, z: normal.z * c - normal.x * s };
}

function isActor(world: World<never>, entity: EntityId): boolean {
  return (
    (world.isRegistered(CreatureComponent) && world.has(entity, CreatureComponent)) ||
    (world.isRegistered(CharacterController) && world.has(entity, CharacterController)) ||
    (world.isRegistered(TagsComponent) &&
      (hasTag(world, entity, 'player') || hasTag(world, entity, 'actor')))
  );
}

/** The distance along the ray from `o` along unit `d` to a target, or Infinity (a miss). */
function hitDistance(
  target: Target,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  max: number,
): number {
  const cx = target.x - ox;
  const cy = target.y - oy;
  const cz = target.z - oz;
  if (target.planar) {
    const denom = dx * target.nx + dy * target.ny + dz * target.nz;
    if (denom > -EPS && denom < EPS) return Infinity;
    const t = (cx * target.nx + cy * target.ny + cz * target.nz) / denom;
    if (!(t > EPS && t <= max)) return Infinity;
    const px = t * dx - cx;
    const py = t * dy - cy;
    const pz = t * dz - cz;
    return px * px + py * py + pz * pz <= target.r * target.r ? t : Infinity;
  }
  const along = cx * dx + cy * dy + cz * dz;
  const perp2 = cx * cx + cy * cy + cz * cz - along * along;
  const r2 = target.r * target.r;
  if (perp2 >= r2) return Infinity;
  const half = Math.sqrt(r2 - perp2);
  const enter = along - half;
  const t = enter > EPS ? enter : along + half > EPS ? EPS : Infinity;
  return t <= max ? t : Infinity;
}

/** The distance along the ray at which it enters a static occluder it crosses (0: it starts inside). */
function enterDistance(
  occ: Occluder,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  max: number,
): number {
  let t0 = 0;
  let t1 = max;
  // The caller only passes occluders the segment really crosses (StaticOccluders.along with no
  // growth), so a slab with d = 0 already holds the origin and nothing here can miss.
  const slab = (lo: number, hi: number, o: number, d: number): void => {
    if (d === 0) return;
    const a = (lo - o) / d;
    const b = (hi - o) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  };
  slab(occ.minX, occ.maxX, ox, dx);
  slab(occ.minY, occ.maxY, oy, dy);
  slab(occ.minZ, occ.maxZ, oz, dz);
  if (occ.cut) {
    const g0 = occ.nx * ox + occ.ny * oy + occ.nz * oz - occ.d;
    const gd = occ.nx * dx + occ.ny * dy + occ.nz * dz;
    if (gd > 0) t1 = Math.min(t1, -g0 / gd);
    else if (gd < 0) t0 = Math.max(t0, -g0 / gd);
  }
  return t0;
}

/** Traces beams and keeps this tick's paths and what each receiver was given. */
export class BeamTracer {
  private readonly statics: Pick<StaticOccluders, 'along'> | undefined;
  private current: readonly BeamPath[] = [];
  private received = new Map<EntityId, number>();

  constructor(options: BeamOptions = {}) {
    this.statics = options.statics;
  }

  /** This tick's beams, by emitter id. */
  get paths(): readonly BeamPath[] {
    return this.current;
  }

  /** The matching intensity `receiver` got at the last trace (0: none). */
  intensityAt(receiver: EntityId): number {
    return this.received.get(receiver) ?? 0;
  }

  private targets(world: World<never>): Target[] {
    const targets: Target[] = [];
    world.query(PlacementComponent).forEach((entity, placed) => {
      const receiver = world.has(entity, LightReceiverComponent);
      const optic = world.get(entity, OpticComponent);
      const actor = isActor(world, entity);
      const reflective = readProperty(world, entity, 'reflective');
      const opaque = readProperty(world, entity, 'opaque');
      const transparent =
        readProperty(world, entity, 'transparent') ||
        (readProperty(world, entity, 'frozen') && !opaque && !reflective);
      if (!(receiver || optic !== undefined || actor || reflective || opaque || transparent))
        return;
      const at = boundingSphereOf(world, entity, placed);
      // An optic whose properties were taken away is just a solid thing.
      const reaction: Reaction = receiver
        ? 'receive'
        : actor || opaque
          ? 'stop'
          : reflective
            ? 'reflect'
            : transparent
              ? 'pass'
              : 'stop';
      let nx = 0;
      let ny = 0;
      let nz = 0;
      let r = at.radius;
      const planar =
        optic !== undefined && !actor && (reaction === 'reflect' || reaction === 'pass');
      if (planar) {
        const push = world.isRegistered(PushConfigComponent)
          ? world.get(entity, PushConfigComponent)
          : undefined;
        const normal = turned(optic.normal, push?.angle ?? 0);
        nx = normal.x;
        ny = normal.y;
        nz = normal.z;
        r = optic.radius;
      }
      targets.push({
        entity,
        x: at.x,
        y: at.y,
        z: at.z,
        r,
        reaction,
        actor,
        planar,
        nx,
        ny,
        nz,
        focus: optic !== undefined && reaction === 'pass' ? optic.focus : 1,
        tint: optic !== undefined && reaction === 'pass' ? optic.tint : null,
      });
    });
    return targets;
  }

  /** Traces every active emitter against `world`, replacing the last tick's paths. */
  update(world: World<never>): void {
    this.received = new Map();
    const paths: BeamPath[] = [];
    this.current = paths;
    if (!world.isRegistered(BeamEmitterComponent)) return;
    const emitters: [EntityId, BeamEmitter][] = [];
    world.query(BeamEmitterComponent).forEach((entity, beam) => {
      if (beam.active && world.has(entity, PlacementComponent)) emitters.push([entity, beam]);
    });
    if (emitters.length === 0) return;
    const targets = this.targets(world);
    for (const [entity, beam] of emitters) {
      const path = this.trace(world, targets, entity, beam);
      paths.push(path);
      if (path.end !== 'receiver') continue;
      // A beam that ended on a receiver always has its target.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const target = path.target!;
      const receiver = known(world.get(target, LightReceiverComponent));
      if (colourPasses(path.colour, receiver.filter)) {
        this.received.set(target, (this.received.get(target) ?? 0) + path.intensity);
      }
    }
  }

  private trace(
    world: World<never>,
    targets: Target[],
    entity: EntityId,
    beam: BeamEmitter,
  ): BeamPath {
    const origin = known(world.get(entity, PlacementComponent));
    const segments: BeamSegment[] = [];
    let ox = origin.x;
    let oy = origin.y;
    let oz = origin.z;
    let dx = beam.direction.x;
    let dy = beam.direction.y;
    let dz = beam.direction.z;
    let intensity = beam.intensity;
    let colour = beam.colour;
    let focused = false;
    let bounces = 0;
    let skip: EntityId | null = entity;
    let end: BeamEnd = 'segments';
    let ended: EntityId | null = null;
    while (segments.length < MAX_BEAM_SEGMENTS) {
      let best = beam.range;
      let hit: Target | undefined;
      for (const target of targets) {
        if (target.entity === skip) continue;
        const t = hitDistance(target, ox, oy, oz, dx, dy, dz, best);
        if (t < best || (t === best && hit === undefined)) {
          best = t;
          hit = target;
        }
      }
      let wall = false;
      if (this.statics !== undefined) {
        const ex = ox + dx * best;
        const ey = oy + dy * best;
        const ez = oz + dz * best;
        for (const occluder of this.statics.along(ox, oy, oz, ex, ey, ez, 0)) {
          const t = enterDistance(occluder, ox, oy, oz, dx, dy, dz, best);
          // The segment ends where the nearest thing was hit, and this one crosses it.
          best = Math.min(best, t);
          wall = true;
        }
      }
      const px = ox + dx * best;
      const py = oy + dy * best;
      const pz = oz + dz * best;
      segments.push({
        from: { x: ox, y: oy, z: oz },
        to: { x: px, y: py, z: pz },
        intensity,
        colour,
      });
      if (wall) {
        end = 'wall';
        break;
      }
      if (hit === undefined) {
        end = 'range';
        break;
      }
      ended = hit.entity;
      if (hit.reaction === 'stop') {
        end = hit.actor ? 'actor' : 'opaque';
        break;
      }
      if (hit.reaction === 'receive') {
        end = 'receiver';
        break;
      }
      skip = hit.entity;
      ox = px;
      oy = py;
      oz = pz;
      if (hit.reaction === 'reflect') {
        if (bounces >= beam.maxBounces) {
          end = 'bounces';
          break;
        }
        bounces++;
        let nx = hit.nx;
        let ny = hit.ny;
        let nz = hit.nz;
        if (!hit.planar) {
          nx = px - hit.x;
          ny = py - hit.y;
          nz = pz - hit.z;
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
          nx /= len;
          ny /= len;
          nz /= len;
        }
        const facing = dx * nx + dy * ny + dz * nz;
        const k = 2 * facing;
        dx -= k * nx;
        dy -= k * ny;
        dz -= k * nz;
        continue;
      }
      // Passes through: dimmed and re-coloured by its tint, multiplied by a lens.
      intensity *= hit.focus;
      focused = focused || hit.focus > 1;
      if (hit.tint !== null) {
        const r = colour.x * hit.tint.x;
        const g = colour.y * hit.tint.y;
        const b = colour.z * hit.tint.z;
        const peak = Math.max(r, g, b);
        if (!(peak > 0)) {
          end = 'opaque';
          break;
        }
        intensity *= peak;
        colour = { x: r / peak, y: g / peak, z: b / peak };
      }
    }
    return {
      emitter: entity,
      segments,
      end,
      target: end === 'opaque' || end === 'actor' || end === 'receiver' ? ended : null,
      intensity,
      colour,
      focused,
      bounces,
    };
  }
}

/** Puts a beam's end into the world: a light spot, and heat when it was focused. */
function strike(world: World<never>, path: BeamPath): void {
  const last = known(path.segments[path.segments.length - 1]);
  const at = last.to;
  applyStimulus(world, {
    shape: { kind: 'sphere', center: at, radius: BEAM_SPOT_RADIUS },
    element: 'light',
    intensity: path.intensity * BEAM_LIGHT_UNITS,
    source: path.emitter,
  });
  if (!path.focused) return;
  const heat = (path.intensity * BEAM_HEAT_PER_SECOND) / world.clock.hz;
  applyStimulus(world, {
    shape:
      path.target !== null
        ? { kind: 'contact', target: path.target }
        : { kind: 'sphere', center: at, radius: BEAM_HEAT_RADIUS },
    element: 'heat',
    intensity: heat,
    falloff: 'none',
    source: path.emitter,
  });
}

/**
 * The beams system: traces every emitter and applies the light (and heat) where each ends. Add it
 * after the stimulus system; stimuli it applies resolve next tick. Receivers read `tracer` after it.
 */
export function beamsSystem<TInput>(tracer: BeamTracer): System<TInput> {
  return {
    name: 'beams',
    run: ({ world: w }) => {
      const world: World<never> = w;
      tracer.update(world);
      for (const path of tracer.paths) strike(world, path);
    },
  };
}
