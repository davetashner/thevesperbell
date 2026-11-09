// Noise propagation (mw-e09.3): how loud a sound is where a listener stands, and where it seems to
// come from. Constitution: sound travels like it does in a building, so closing a door or taking the
// long way round keeps a thief quiet, and a guard hears the doorway a sound came through, never the
// thief behind the wall (no omniscience).
//
//   perceived level = loudness at 1 m + distance gain over the path + every door, wall and floor gain
//   distance gain   = −20·log10(path metres), none within 1 m (inverse square: −6 dB per doubling)
//
// The search runs over the sound graph (graph.ts) from the source's room. A sound reaches a portal of
// its room in a straight line and passes it with the portal's gain (its door's state: open, ajar,
// closed; a level-supplied resolver reads it at propagation time, so door changes apply to the next
// sound at once). It passes a partition into a touching room with the wall or floor gain and carries
// on in a straight line from where it was. Each arrival is a label {room, point, accumulated loss,
// path length}; a label whose loss and length are both no better than one already settled at the
// same room and point is dropped, so the routes kept are exactly the ones some listener could hear
// loudest (both quantities only grow along a route). Labels are settled loudest first and never
// expanded below the audibility floor: the search is bounded by the floor, not by the level's size.
// Routes are compared as max(1, length) × 10^(loss / 20), which orders exactly as the level does
// (level = loudness − 20·log10 of it), so the search takes no log per step: one pow per distinct
// gain, and one log per listener for the level it reports.
//
// A listener takes the loudest route into its room. Its perceived position is the last portal that
// route came through, or the source itself when the route came straight or only through partitions
// (muffled, but from the right direction). Everything is pure and deterministic: log goes through
// simMath, distances through Math.sqrt.

import type { DoorSoundState, NoiseTuning, PartitionKind } from '@content/index';
import { log, pow } from '../math';
import type { Vec3 } from '../stimulus/shapes';
import { roomAt, type SoundGraph, type SoundPortal, type SoundRoom } from './graph';

/** Mirrors the shipped `noise` block of src/content/data/stealth/stealth.json (pinned by a test). */
export const DEFAULT_NOISE_TUNING: NoiseTuning = Object.freeze({
  audibleFloor: 10,
  doors: Object.freeze({
    open: 0,
    ajar: -6,
    closed: -20,
    materials: Object.freeze([
      Object.freeze({ material: 'iron', ajar: -8, closed: -25 }),
      Object.freeze({ material: 'stone', ajar: -8, closed: -28 }),
    ]),
  }),
  partitions: Object.freeze({
    wall: -30,
    floor: -25,
    materials: Object.freeze([
      Object.freeze({ material: 'stone', wall: -35, floor: -35 }),
      Object.freeze({ material: 'wood', wall: -18, floor: -15 }),
    ]),
  }),
  impact: Object.freeze({ minEnergy: 1, refEnergy: 10, refDb: 60, dbPerDecade: 10, maxDb: 100 }),
  footsteps: Object.freeze({
    gaitDb: Object.freeze({ sneak: 25, walk: 40, run: 55, sprint: 65 }),
    creatureGait: Object.freeze({
      walkFrom: 0.2,
      runFrom: 2.5,
      sprintFrom: 6,
      stride: Object.freeze({ walk: 0.75, run: 1.6, sprint: 2.05 }),
    }),
    landing: Object.freeze({
      minHeight: 0.5,
      curve: Object.freeze([
        Object.freeze({ height: 0.5, db: 30 }),
        Object.freeze({ height: 1, db: 45 }),
        Object.freeze({ height: 2, db: 60 }),
        Object.freeze({ height: 3, db: 70 }),
        Object.freeze({ height: 5, db: 82 }),
        Object.freeze({ height: 10, db: 95 }),
      ]),
    }),
  }),
});

/** The gain, dB (≤ 0), of `metres` of travel: −20·log10(metres), none within 1 m. */
export function distanceGainDb(metres: number): number {
  return metres <= 1 ? 0 : (-20 * log(metres)) / Math.LN10;
}

/** The gain, dB (≤ 0), of a door of `material` (null: the default) in `state`. */
export function doorGainDb(
  state: DoorSoundState,
  material: string | null,
  tuning: NoiseTuning = DEFAULT_NOISE_TUNING,
): number {
  const own = tuning.doors.materials.find((m) => m.material === material);
  return own?.[state] ?? tuning.doors[state];
}

/** The gain, dB (≤ 0), through a partition of `kind` made of `material` (null: the default). */
export function partitionGainDb(
  kind: PartitionKind,
  material: string | null,
  tuning: NoiseTuning = DEFAULT_NOISE_TUNING,
): number {
  const own = tuning.partitions.materials.find((m) => m.material === material);
  return own?.[kind] ?? tuning.partitions[kind];
}

/** A portal's gain right now, dB (≤ 0): its door's state and material (see system.ts). */
export type PortalGain = (portal: SoundPortal) => number;

/** Every portal open: no door gains. */
export const OPEN_PORTALS: PortalGain = () => 0;

/** What a listener hears of one noise. */
export interface HeardNoise {
  /** Perceived level, dB. */
  readonly level: number;
  /** Where it seems to come from: the last portal it came through, else the source. */
  readonly perceived: Vec3;
  /** The id of that portal, or null when it came straight or only through partitions. */
  readonly via: string | null;
  /**
   * dB lost to doors, walls and floors on the route (≥ 0), distance excluded: the occlusion the
   * audio engine (e28) filters by when it reuses this result.
   */
  readonly occlusion: number;
  /** Length of the route, metres. */
  readonly distance: number;
}

/** One noise propagated through a level: ask it what any position hears. */
export interface NoiseField {
  readonly source: Vec3;
  /** Level at 1 m from the source, dB. */
  readonly loudness: number;
  /** The audibility floor it was bounded by, dB. */
  readonly floor: number;
  /** Routes settled by the search (diagnostics, budgets). */
  readonly routes: number;
  /** What `position` hears, or null when nothing reaches it at or above the floor. */
  hear(position: Vec3): HeardNoise | null;
}

export interface PropagateOptions {
  readonly tuning?: NoiseTuning;
  /** Portal gains; default every portal open. */
  readonly portalGain?: PortalGain;
}

/** A sound arriving somewhere: at the source (`portal` −1) or a portal, inside `room`. */
interface Label {
  readonly room: number;
  readonly portal: number;
  readonly point: Vec3;
  /** Accumulated door, wall and floor loss, dB ≥ 0. */
  readonly loss: number;
  readonly length: number;
  /** The last portal passed, or −1. */
  readonly via: number;
  /** 10^(loss / 20): the loss as an amplitude factor. */
  readonly factor: number;
  /**
   * max(1, length) × factor: the level at `point` (the most any listener beyond it can hear) as a
   * number that falls as the level rises, so routes are ordered without a log per step.
   */
  readonly key: number;
  /** Order pushed, the tie-break that keeps the search deterministic. */
  readonly seq: number;
}

/** A value present by construction (noUncheckedIndexedAccess cannot see it; lint forbids `!`). */
function known<T>(value: T | undefined): T {
  return value as T;
}

/** `items[index]` for an index in range by construction (kept in this module: it is hot). */
function item<T>(items: readonly T[], index: number): T {
  return known(items[index]);
}

const NO_LABELS: readonly Label[] = Object.freeze([]);

function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Louder (smaller key) first; equal keys in push order. */
const before = (a: Label, b: Label): boolean => a.key < b.key || (a.key === b.key && a.seq < b.seq);

/** The amplitude factor of a loss of `db` dB (≥ 0 for a loss). */
const amplitude = (db: number): number => pow(10, db / 20);

/** A binary max-heap of labels. */
class LabelHeap {
  private readonly items: Label[] = [];

  get size(): number {
    return this.items.length;
  }

  push(label: Label): void {
    const items = this.items;
    items.push(label);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const up = item(items, parent);
      if (!before(label, up)) break;
      items[i] = up;
      i = parent;
    }
    items[i] = label;
  }

  /** Removes and returns the loudest label (call only when size > 0). */
  pop(): Label {
    const items = this.items;
    const top = item(items, 0);
    const last = known(items.pop());
    const n = items.length;
    if (n === 0) return top;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= n) break;
      const right = left + 1;
      let child = left;
      if (right < n && before(item(items, right), item(items, left))) child = right;
      const next = item(items, child);
      if (!before(next, last)) break;
      items[i] = next;
      i = child;
    }
    items[i] = last;
    return top;
  }
}

/** Whether a settled label is no worse than `label` in both loss and length. */
function dominated(settled: readonly Label[], label: Label): boolean {
  for (const l of settled) if (l.loss <= label.loss && l.length <= label.length) return true;
  return false;
}

/** Each room's partition gains under a tuning, worked out once (rooms and tunings are frozen). */
const partitionGainCache = new WeakMap<NoiseTuning, WeakMap<SoundRoom, readonly number[]>>();

function partitionGains(room: SoundRoom, tuning: NoiseTuning): readonly number[] {
  let byRoom = partitionGainCache.get(tuning);
  if (byRoom === undefined) {
    byRoom = new WeakMap();
    partitionGainCache.set(tuning, byRoom);
  }
  let gains = byRoom.get(room);
  if (gains === undefined) {
    gains = room.partitions.map((p) => partitionGainDb(p.kind, p.material, tuning));
    byRoom.set(room, gains);
  }
  return gains;
}

/**
 * Propagates a noise of `loudness` dB at 1 m from `source` through `graph`.
 * @throws RangeError when `loudness` or `source` is not finite.
 */
export function propagateNoise(
  graph: SoundGraph,
  source: Vec3,
  loudness: number,
  options: PropagateOptions = {},
): NoiseField {
  if (!Number.isFinite(loudness)) {
    throw new RangeError(`loudness must be finite, got ${String(loudness)}`);
  }
  if (!Number.isFinite(source.x) || !Number.isFinite(source.y) || !Number.isFinite(source.z)) {
    throw new RangeError('source must be a finite position');
  }
  const tuning = options.tuning ?? DEFAULT_NOISE_TUNING;
  const portalGain = options.portalGain ?? OPEN_PORTALS;
  const floor = tuning.audibleFloor;
  const { rooms, portals } = graph;
  const stride = portals.length + 1;
  /** Settled labels by room × point (−1 = the source), for the dominance check. */
  const settled = new Map<number, Label[]>();
  /** Settled labels per room, in settle order, for listeners (only rooms the noise reached). */
  const byRoom = new Map<number, Label[]>();
  /** Portal gains, read once per propagation (lazily: only portals the search reaches). */
  const gains = new Map<number, number>();
  const gainOf = (index: number): number => {
    let gain = gains.get(index);
    if (gain === undefined) {
      gain = portalGain(item(portals, index));
      gains.set(index, gain);
    }
    return gain;
  };
  /** Amplitude factors by gain, so each distinct gain costs one pow per noise. */
  const factors = new Map<number, number>();
  const factorOf = (gain: number): number => {
    let factor = factors.get(gain);
    if (factor === undefined) {
      factor = amplitude(-gain);
      factors.set(gain, factor);
    }
    return factor;
  };
  /** The largest key still at or above the floor: level ≥ floor ⇔ key ≤ limit. */
  const limit = amplitude(loudness - floor);
  const heap = new LabelHeap();
  let seq = 0;
  const push = (
    from: Label | null,
    room: number,
    portal: number,
    point: Vec3,
    gain: number,
    length: number,
    via: number,
  ): void => {
    const factor = from === null ? 1 : gain === 0 ? from.factor : from.factor * factorOf(gain);
    const key = Math.max(1, length) * factor;
    if (key > limit) return;
    const loss = from === null ? 0 : from.loss - gain;
    heap.push({ room, portal, point, loss, length, via, factor, key, seq: seq++ });
  };

  push(null, roomAt(graph, source), -1, source, 0, 0, -1);
  let routes = 0;
  while (heap.size > 0) {
    const label = heap.pop();
    const key = label.room * stride + label.portal + 1;
    let here = settled.get(key);
    if (here === undefined) {
      here = [];
      settled.set(key, here);
    }
    if (dominated(here, label)) continue;
    here.push(label);
    const inRoom = byRoom.get(label.room);
    if (inRoom === undefined) byRoom.set(label.room, [label]);
    else inRoom.push(label);
    routes++;
    const room = item(rooms, label.room);
    for (const index of room.portals) {
      if (index === label.portal) continue;
      const portal = item(portals, index);
      const [a, b] = portal.rooms;
      push(
        label,
        a === label.room ? b : a,
        index,
        portal.position,
        gainOf(index),
        label.length + distance(label.point, portal.position),
        index,
      );
    }
    const walls = partitionGains(room, tuning);
    room.partitions.forEach((partition, i) => {
      const gain = item(walls, i);
      push(label, partition.to, label.portal, label.point, gain, label.length, label.via);
    });
  }

  const hear = (position: Vec3): HeardNoise | null => {
    let best: Label | null = null;
    let bestKey = Infinity;
    let bestLength = 0;
    for (const label of byRoom.get(roomAt(graph, position)) ?? NO_LABELS) {
      const length = label.length + distance(label.point, position);
      const key = Math.max(1, length) * label.factor;
      if (key > limit || key >= bestKey) continue;
      best = label;
      bestKey = key;
      bestLength = length;
    }
    if (best === null) return null;
    const portal = best.via < 0 ? null : item(portals, best.via);
    return {
      level: loudness - best.loss + distanceGainDb(bestLength),
      perceived: portal === null ? source : portal.position,
      via: portal === null ? null : portal.id,
      occlusion: best.loss,
      distance: bestLength,
    };
  };
  return Object.freeze({ source, loudness, floor, routes, hear });
}
