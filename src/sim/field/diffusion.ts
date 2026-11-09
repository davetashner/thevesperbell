// One element-field tick (mw-e03.4): diffusion, ambient loss and sleep. Each open face between two
// cells moves trunc((a − b) × rate × conductivity) counts from the higher to the lower, where the
// face's conductivity is the smaller of its two cells' (a wall on either side blocks it). Every
// flux is computed from the values at the start of the tick into a separate delta buffer, and all
// values are integers far below 2^53, so the result is exact, conserving (every count leaving one
// cell arrives in the other) and independent of iteration order.
//
// Only awake chunks are simulated. A chunk that has a layer for a channel at the start of the tick
// "participates" in it; each face is counted exactly once: from both-participating pairs by the cell
// on the negative side, otherwise by the participating side. A non-participating neighbour holds
// ambient (0) for that channel, so pairs with no participant carry nothing. Only cells beyond the
// channel's sleep epsilon spill into a chunk that does not hold the channel (which bounds how far
// negligible tails spread); such flux wakes or allocates the chunk, and when the chunk cap refuses,
// that face acts as a wall.
//
// After applying deltas, each channel loses `decay` of its deviation (ambient loss). A chunk whose
// every value is within epsilon of ambient for `sleepTicks` ticks in a row settles to exact ambient
// and sleeps: it costs nothing until a write or a neighbour's flux touches it. Sleeping chunks with
// no walls are freed. What decay and settling remove is reported, so totals can be audited.

import * as config from './config';
import type { FieldChannel } from './config';
import type { Chunk, ElementField } from './grid';

// Local copies: hot loops should not reach through module bindings.
const { CHUNK_CELLS, CHUNK_SIZE, CONDUCTIVITY_ONE, RATE_ONE } = config;

/** What one tick of the field did. */
export interface FieldStepReport {
  /** Chunks simulated this tick (awake at its start). */
  readonly activeChunks: number;
  /** Cell-channel updates performed by the diffusion kernel. */
  readonly cellsUpdated: number;
  /** Per channel: deviation removed by ambient loss and settling this tick (units × cells). */
  readonly lost: Readonly<Record<string, number>>;
}

/** Axis steps of the six faces, positive direction first on each axis. */
const FACES: readonly (readonly [number, number, number, boolean])[] = [
  [1, 0, 0, true],
  [-1, 0, 0, false],
  [0, 1, 0, true],
  [0, -1, 0, false],
  [0, 0, 1, true],
  [0, 0, -1, false],
];
const SCALE = RATE_ONE * CONDUCTIVITY_ONE;
const LAST = CHUNK_SIZE - 1;

interface Buffer {
  readonly chunk: Chunk;
  readonly channel: FieldChannel;
  readonly values: Float64Array;
  readonly delta: Float64Array;
  readonly participating: boolean;
}

/** Monomorphic element reads for the kernel's hot loops (one per array type keeps them fast). */
const value = <T>(items: ArrayLike<T>, index: number): T => items[index] as T;
const level = <T>(items: ArrayLike<T>, index: number): T => items[index] as T;

/**
 * Delta buffers returned by finished ticks, all zero, so a tick over thousands of chunks does not
 * allocate and collect megabytes every tick. Bounded; nothing about them is observable.
 */
const SPARE_LIMIT = 4096;
const spare: Float64Array[] = [];

/** Per-tick working state: every buffer, participating or receiving, by its values array. */
class Tick {
  readonly buffers = new Map<Float64Array, Buffer>();

  constructor(readonly field: ElementField) {}

  buffer(chunk: Chunk, channel: FieldChannel, values: Float64Array, participating: boolean) {
    const delta = spare.pop() ?? new Float64Array(CHUNK_CELLS);
    const buffer = { chunk, channel, values, delta, participating };
    this.buffers.set(values, buffer);
    return buffer;
  }

  /** Chunk coordinates across face `face` of `chunk`. */
  across(chunk: Chunk, face: number): [number, number, number] {
    const [dx, dy, dz] = value(FACES, face);
    return [chunk.cx + dx, chunk.cy + dy, chunk.cz + dz];
  }
}

function conductivityAt(chunk: Chunk | undefined, index: number): number {
  const table = chunk?.conductivity;
  return table === undefined ? CONDUCTIVITY_ONE : level(table, index);
}

/** What lies across one face of a chunk for one channel, resolved once per source per tick. */
interface Side {
  other: Chunk | undefined;
  values: Float64Array | undefined;
  target: Buffer | undefined;
}

function side(tick: Tick, chunk: Chunk, face: number, channel: FieldChannel): Side {
  const other = chunk.links[face];
  const values = other?.layers.get(channel);
  return { other, values, target: values === undefined ? undefined : tick.buffers.get(values) };
}

/** A buffer for a non-participating neighbour receiving flux, allocating and waking as needed. */
function receive(
  tick: Tick,
  chunk: Chunk,
  face: number,
  s: Side,
  channel: FieldChannel,
): Buffer | undefined {
  const other = s.other ?? tick.field.allocate(...tick.across(chunk, face));
  if (other === undefined) return undefined;
  tick.field.wake(other);
  const values = tick.field.layerOf(other, channel);
  s.other = other;
  s.values = values;
  s.target = tick.buffer(other, channel, values, false);
  return s.target;
}

/** The truncated flux from a cell holding `a` to one holding `b` across `conductivity`. */
const fluxOf = (a: number, b: number, rate: number, conductivity: number): number =>
  Math.trunc(((a - b) * rate * conductivity) / SCALE);

/** Cell index strides of the x, y and z axes. */
const STRIDES = [1, CHUNK_SIZE, CHUNK_SIZE * CHUNK_SIZE] as const;

/** Moves the flux across face `face` of the source chunk, for the 64 cell pairs on it. */
function boundary(tick: Tick, source: Buffer, face: number, rate: number, epsilon: number): void {
  const { chunk, channel, values, delta } = source;
  const positive = value(FACES, face)[3];
  const axis = face >> 1;
  const stride = value(STRIDES, axis);
  const s1 = value(STRIDES, (axis + 1) % 3);
  const s2 = value(STRIDES, (axis + 2) % 3);
  const ownBase = positive ? LAST * stride : 0;
  const otherBase = positive ? 0 : LAST * stride;
  const s = side(tick, chunk, face, channel);
  const shared = s.target?.participating === true;
  if (shared && !positive) return; // counted from the other side
  const ownTable = chunk.conductivity;
  // Without walls on either side every pair has conductivity one, so the rate is the only factor.
  const gain = ownTable === undefined && s.other?.conductivity === undefined ? rate : undefined;
  for (let u = 0; u < CHUNK_SIZE; u++) {
    for (let v = 0; v < CHUNK_SIZE; v++) {
      const offset = u * s1 + v * s2;
      const index = ownBase + offset;
      const a = value(values, index);
      // Calm cells never spill into a chunk that doesn't hold the channel.
      if (!shared && a <= epsilon && a >= -epsilon) continue;
      const nIndex = otherBase + offset;
      const b = s.values === undefined ? 0 : value(s.values, nIndex);
      if (a === b) continue;
      const flux =
        gain === undefined
          ? fluxOf(
              a,
              b,
              rate,
              Math.min(conductivityAt(chunk, index), conductivityAt(s.other, nIndex)),
            )
          : Math.trunc(((a - b) * gain * CONDUCTIVITY_ONE) / SCALE);
      if (flux === 0) continue;
      const target = s.target ?? receive(tick, chunk, face, s, channel);
      if (target === undefined) return; // the chunk cap refused the neighbour: a wall
      delta[index] = value(delta, index) - flux;
      target.delta[nIndex] = value(target.delta, nIndex) + flux;
    }
  }
}

/**
 * The interior faces of a chunk with no walls: every cell open, so each face's conductivity is
 * CONDUCTIVITY_ONE and the rate × conductivity product is one constant. Each of a cell's +x, +y and
 * +z faces inside the chunk is counted once, here.
 */
function interiorOpen(values: Float64Array, delta: Float64Array, rate: number): void {
  const gain = (rate * CONDUCTIVITY_ONE) / SCALE; // exact: SCALE is a power of two
  const plane = CHUNK_SIZE * CHUNK_SIZE;
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let y = 0; y < CHUNK_SIZE; y++) {
      const row = (z * CHUNK_SIZE + y) * CHUNK_SIZE;
      let fromLeft = 0; // what the -x face brought into the cell
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const index = row + x;
        const a = value(values, index);
        let out = 0; // what the +x, +y and +z faces take out of the cell
        let toRight = 0;
        if (x < LAST) {
          toRight = Math.trunc((a - value(values, index + 1)) * gain);
          out += toRight;
        }
        if (y < LAST) {
          const flux = Math.trunc((a - value(values, index + CHUNK_SIZE)) * gain);
          delta[index + CHUNK_SIZE] = value(delta, index + CHUNK_SIZE) + flux;
          out += flux;
        }
        if (z < LAST) {
          const flux = Math.trunc((a - value(values, index + plane)) * gain);
          delta[index + plane] = value(delta, index + plane) + flux;
          out += flux;
        }
        delta[index] = value(delta, index) + fromLeft - out;
        fromLeft = toRight;
      }
    }
  }
}

/** The interior faces of a chunk with a conductivity table; returns the cells that are not walls. */
function interiorWalled(
  values: Float64Array,
  delta: Float64Array,
  table: Uint16Array,
  rate: number,
): number {
  let updated = 0;
  for (let index = 0; index < CHUNK_CELLS; index++) {
    const own = level(table, index);
    if (own === 0) continue;
    updated++;
    const a = value(values, index);
    // The +x, +y and +z neighbours inside the chunk; each interior face is counted once, here.
    for (let axis = 0; axis < 3; axis++) {
      const shift = axis * 3;
      if (((index >> shift) & LAST) === LAST) continue;
      const next = index + (1 << shift);
      const b = value(values, next);
      if (a === b) continue;
      const flux = fluxOf(a, b, rate, Math.min(own, level(table, next)));
      delta[index] = value(delta, index) - flux;
      delta[next] = value(delta, next) + flux;
    }
  }
  return updated;
}

/** Computes every face flux of `source`'s cells into the tick's delta buffers. */
function diffuse(tick: Tick, source: Buffer, rate: number, epsilon: number): number {
  const { values, delta } = source;
  const table = source.chunk.conductivity;
  let updated = CHUNK_CELLS;
  if (table === undefined) interiorOpen(values, delta, rate);
  else updated = interiorWalled(values, delta, table, rate);
  for (let face = 0; face < FACES.length; face++) boundary(tick, source, face, rate, epsilon);
  return updated;
}

/** Adds `amount` counts to `lost[channel]`. */
function account(lost: Map<string, number>, channel: FieldChannel, amount: number): void {
  lost.set(channel, (lost.get(channel) ?? 0) + amount);
}

/**
 * Applies deltas and ambient loss to every buffer, zeroing each delta and handing it back to the
 * spare pool for the next tick.
 */
function apply(tick: Tick, lost: Map<string, number>): void {
  for (const { channel, values, delta } of tick.buffers.values()) {
    const { decay } = tick.field.channel(channel);
    const keep = decay / RATE_ONE; // exact: RATE_ONE is a power of two
    let removed = 0;
    if (decay === 0) {
      for (let i = 0; i < CHUNK_CELLS; i++) {
        values[i] = value(values, i) + value(delta, i);
        delta[i] = 0;
      }
    } else {
      for (let i = 0; i < CHUNK_CELLS; i++) {
        const next = value(values, i) + value(delta, i);
        delta[i] = 0;
        if (next === 0) {
          values[i] = 0;
          continue;
        }
        const loss = Math.trunc(next * keep);
        values[i] = next - loss;
        removed += loss;
      }
    }
    if (spare.length < SPARE_LIMIT) spare.push(delta);
    if (removed !== 0) account(lost, channel, removed);
  }
}

/** Updates calm counts of awake chunks; settles and sleeps (or frees) the ones calm long enough. */
function settle(field: ElementField, lost: Map<string, number>): void {
  const { sleepTicks } = field.config;
  for (const chunk of [...field.chunkList()]) {
    if (chunk.asleep) continue;
    let calm = true;
    for (const [channel, values] of chunk.layers) {
      const { epsilon } = field.channel(channel);
      let empty = true;
      for (let i = 0; i < CHUNK_CELLS; i++) {
        const v = value(values, i);
        if (v !== 0) empty = false;
        if (v > epsilon || v < -epsilon) {
          calm = false;
          break; // not empty either: nothing more to learn from this layer
        }
      }
      if (empty) chunk.layers.delete(channel);
    }
    chunk.calm = calm ? chunk.calm + 1 : 0;
    if (chunk.calm < sleepTicks) continue;
    for (const [channel, values] of chunk.layers) {
      let residue = 0;
      for (let i = 0; i < CHUNK_CELLS; i++) residue += value(values, i);
      if (residue !== 0) account(lost, channel, residue);
    }
    chunk.layers.clear();
    chunk.asleep = true;
    if (chunk.conductivity === undefined) field.release(chunk);
  }
}

/**
 * Advances `field` one tick: diffusion, ambient loss, then sleep (see the file header). Returns what
 * it did; `lost` lets callers check conservation (initial total = final total + Σ lost).
 */
export function stepField(field: ElementField): FieldStepReport {
  const tick = new Tick(field);
  const active = field.chunkList().filter((chunk) => !chunk.asleep);
  for (const chunk of active) {
    for (const [channel, values] of chunk.layers) tick.buffer(chunk, channel, values, true);
  }
  let cellsUpdated = 0;
  for (const source of [...tick.buffers.values()]) {
    const { rate, epsilon } = field.channel(source.channel);
    if (rate > 0) cellsUpdated += diffuse(tick, source, rate, epsilon);
  }
  const lost = new Map<string, number>();
  apply(tick, lost);
  settle(field, lost);
  const units = Object.fromEntries(
    [...lost].map(([channel, counts]) => [channel, config.toUnits(counts)]),
  );
  return { activeChunks: active.length, cellsUpdated, lost: units };
}
