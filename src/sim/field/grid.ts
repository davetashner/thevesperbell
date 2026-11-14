// The element field's sparse chunked storage (mw-e03.4). Fire crossing a floor, gas filling a room
// or water pooling need a medium between objects; the element field is that medium: a voxel grid of
// cells (default 0.5 m) grouped into 8×8×8 chunks. Only chunks something has touched exist, and
// within a chunk only channels that were touched get a layer, so an empty world costs nothing and
// a stimulus 1 km away allocates one far chunk without disturbing the rest. `maxChunks` bounds
// memory: allocation past it is refused (the write is dropped), never an eviction of live state.
//
// Values are integer fixed-point deviations from ambient (see config.ts). Each cell also has a
// conductivity (1 = open air, 0 = a wall) derived by the level/material layer from what occupies it;
// walls block every channel. Coordinates: cell (i, j, k) covers [i·s, (i+1)·s) on each axis for cell
// size s, so cellOf() is a floor and needs no transcendental maths. Canonical order everywhere is
// chunks by (x, y, z), channels by code unit, cells by index — so snapshots are plain, sorted data.

import type { Bounds, Vec3 } from '../stimulus/shapes';
import {
  CHUNK_CELLS,
  CHUNK_SIZE,
  checkChannelName,
  CONDUCTIVITY_ONE,
  fixedChannel,
  resolveFieldConfig,
  toCounts,
  toUnits,
  type FieldChannel,
  type FieldConfig,
  type FieldConfigInput,
  type FixedChannel,
} from './config';

/** Integer cell coordinates. */
export interface CellCoord {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Whether a chunk exists and is being simulated. */
export type ChunkState = 'absent' | 'awake' | 'asleep';

/**
 * One chunk's storage. Internal to the field module (the diffusion kernel reads and writes it);
 * everything else goes through ElementField's methods.
 */
export interface Chunk {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  /** Channel → CHUNK_CELLS deviations from ambient, integer counts. Absent layer = all 0. */
  readonly layers: Map<FieldChannel, Float64Array>;
  /** Per-cell conductivity, CONDUCTIVITY_ONE scale; undefined = all open air. */
  conductivity: Uint16Array | undefined;
  /** Consecutive calm ticks (see FieldConfig.sleepTicks). */
  calm: number;
  /** Asleep chunks hold no layers and are skipped by diffusion until touched. */
  asleep: boolean;
  /**
   * The allocated chunk across each face (+x, -x, +y, -y, +z, -z; face ^ 1 is the opposite one),
   * kept by `allocate` and `release`, so the diffusion kernel finds a neighbour without hashing.
   */
  readonly links: (Chunk | undefined)[];
}

/** Chunk coordinate steps across the six faces, in the order of `Chunk.links`. */
const LINK_STEPS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** `items[index]` for an index known to be in range (noUncheckedIndexedAccess can't see it). */
export function at<T>(items: ArrayLike<T>, index: number): T {
  return items[index] as T;
}

/** Floor that never yields -0 (which the canonical encoding keeps distinct from +0). */
const floor = (n: number): number => Math.floor(n) + 0;

const chunkKey = (cx: number, cy: number, cz: number): string =>
  `${String(cx)},${String(cy)},${String(cz)}`;

/** Canonical chunk order: by x, then y, then z. */
const byPosition = (a: Chunk, b: Chunk): number => a.cx - b.cx || a.cy - b.cy || a.cz - b.cz;

/** The cell index of local coordinates within a chunk. */
export const cellIndex = (lx: number, ly: number, lz: number): number =>
  lx + CHUNK_SIZE * (ly + CHUNK_SIZE * lz);

/** Plain-data form of a chunk: sparse [index, value, index, value, …] lists, sorted. */
export interface ChunkData {
  readonly at: readonly [number, number, number];
  readonly calm: number;
  readonly asleep: boolean;
  /** Cells whose conductivity is not open air: [index, conductivity, …]. */
  readonly conductivity: readonly number[];
  /** [channel, [index, counts, …]] for every non-zero layer, channels sorted. */
  readonly layers: readonly (readonly [string, readonly number[]])[];
}

/** Plain-data form of a field (its snapshot and save form). */
export interface FieldData {
  readonly config: FieldConfig;
  readonly chunks: readonly ChunkData[];
}

/** Why `data` is not a valid field snapshot; thrown by ElementField.deserialize. */
function invalid(problem: string): never {
  throw new RangeError(`invalid element field data: ${problem}`);
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);

/** Reads a sparse [index, value, …] list into `into`, checking each value with `ok`. */
function readSparse(list: unknown, into: Float64Array | Uint16Array, ok: (v: number) => boolean) {
  if (!Array.isArray(list) || list.length % 2 !== 0) invalid('sparse list must pair up');
  let previous = -1;
  for (let i = 0; i < list.length; i += 2) {
    const index: unknown = list[i];
    const value: unknown = list[i + 1];
    if (!isInt(index) || index <= previous || index >= CHUNK_CELLS) invalid('bad cell index');
    if (!isInt(value) || !ok(value)) invalid(`bad cell value at ${String(index)}`);
    into[index] = value;
    previous = index;
  }
}

/** Sparse [index, value, …] list of the cells of `values` that differ from `blank`. */
function writeSparse(values: ArrayLike<number>, blank: number): number[] {
  const list: number[] = [];
  for (let i = 0; i < CHUNK_CELLS; i++) {
    const value = at(values, i);
    if (value !== blank) list.push(i, value);
  }
  return list;
}

/** The sparse chunked element field. Create one with `new ElementField(config)`. */
export class ElementField {
  readonly config: FieldConfig;
  private readonly chunks = new Map<string, Chunk>();
  private sorted: Chunk[] | undefined = [];
  private readonly fixed = new Map<FieldChannel, FixedChannel>();

  /** `config` is validated and completed by `resolveFieldConfig`. */
  constructor(config: FieldConfigInput = {}) {
    this.config = resolveFieldConfig(config);
  }

  /** Chunks currently allocated (awake or asleep). */
  get chunkCount(): number {
    return this.chunks.size;
  }

  /** The cell containing `point` (metres). */
  cellOf(point: Vec3): CellCoord {
    const s = this.config.cellSize;
    return { x: floor(point.x / s), y: floor(point.y / s), z: floor(point.z / s) };
  }

  /** The centre of `cell`, metres. */
  cellCenter(cell: CellCoord): Vec3 {
    const s = this.config.cellSize;
    return { x: (cell.x + 0.5) * s, y: (cell.y + 0.5) * s, z: (cell.z + 0.5) * s };
  }

  /** Whether the chunk holding `cell` is absent, awake or asleep. */
  chunkState(cell: CellCoord): ChunkState {
    const chunk = this.chunkOf(cell);
    return chunk === undefined ? 'absent' : chunk.asleep ? 'asleep' : 'awake';
  }

  /** The fixed-point form of a (validated) channel. Internal to the field module. */
  channel(channel: FieldChannel): FixedChannel {
    let fixed = this.fixed.get(channel);
    if (fixed === undefined) {
      fixed = fixedChannel(this.config, channel);
      this.fixed.set(channel, fixed);
    }
    return fixed;
  }

  /** `channel`'s value at `cell`, absolute units (ambient where nothing is stored). */
  read(channel: FieldChannel, cell: CellCoord): number {
    const fixed = this.channel(checkChannelName(channel));
    const layer = this.chunkOf(cell)?.layers.get(channel);
    return fixed.ambient + (layer === undefined ? 0 : toUnits(at(layer, this.indexOf(cell))));
  }

  /** `channel`'s value in the cell containing `point`, absolute units. */
  readAt(channel: FieldChannel, point: Vec3): number {
    return this.read(channel, this.cellOf(point));
  }

  /** Every channel with a stored (non-ambient) value somewhere, sorted. */
  channels(): FieldChannel[] {
    const found = new Set<FieldChannel>();
    for (const chunk of this.chunks.values())
      for (const name of chunk.layers.keys()) found.add(name);
    return [...found].sort();
  }

  /**
   * The sum over all cells of `channel`'s deviation from ambient (units × cells): what diffusion
   * conserves. Exact up to the fixed-point resolution.
   */
  total(channel: FieldChannel): number {
    checkChannelName(channel);
    let sum = 0;
    for (const chunk of this.chunks.values()) {
      const layer = chunk.layers.get(channel);
      if (layer !== undefined) for (const value of layer) sum += value;
    }
    return toUnits(sum);
  }

  /**
   * Adds `amount` units of `channel` to `cell`, clamped to the channel's range, and wakes its chunk.
   * Returns false, changing nothing, when the cell is a wall (conductivity 0) or its chunk cannot be
   * allocated (the chunk cap is reached).
   */
  add(channel: FieldChannel, cell: CellCoord, amount: number): boolean {
    if (!Number.isFinite(amount)) throw new RangeError('field amount must be finite');
    return this.write(checkChannelName(channel), cell, (old) => old + toCounts(amount));
  }

  /** Like `add`, but sets the cell to `value` (absolute units, clamped). */
  set(channel: FieldChannel, cell: CellCoord, value: number): boolean {
    if (!Number.isFinite(value)) throw new RangeError('field value must be finite');
    const fixed = this.channel(checkChannelName(channel));
    return this.write(channel, cell, () => toCounts(value - fixed.ambient));
  }

  /** `add` at the cell containing `point`. */
  addAt(channel: FieldChannel, point: Vec3, amount: number): boolean {
    return this.add(channel, this.cellOf(point), amount);
  }

  private write(channel: FieldChannel, cell: CellCoord, next: (old: number) => number): boolean {
    const index = this.indexOf(cell);
    const existing = this.chunkOf(cell);
    if (existing?.conductivity !== undefined && at(existing.conductivity, index) === 0) {
      return false;
    }
    const chunk = existing ?? this.allocateAt(cell);
    if (chunk === undefined) return false;
    const { low, high } = this.channel(channel);
    const layer = this.layerOf(chunk, channel);
    layer[index] = Math.min(high, Math.max(low, next(at(layer, index))));
    this.wake(chunk);
    return true;
  }

  /** Conductivity of `cell`: 1 open air, 0 wall. */
  conductivity(cell: CellCoord): number {
    const table = this.chunkOf(cell)?.conductivity;
    return (
      (table === undefined ? CONDUCTIVITY_ONE : at(table, this.indexOf(cell))) / CONDUCTIVITY_ONE
    );
  }

  /**
   * Sets the conductivity of every cell whose centre lies in `bounds` (inclusive) to `value` in
   * [0, 1] (rounded to 1/256): 0 makes walls (static geometry, closed doors), 1 restores open air.
   * Allocates and wakes the chunks involved; returns false when the chunk cap refused any of them.
   */
  setConductivity(bounds: Bounds, value: number): boolean {
    if (!(value >= 0 && value <= 1)) throw new RangeError('conductivity must be in [0, 1]');
    const level = Math.round(value * CONDUCTIVITY_ONE);
    let complete = true;
    this.forCellsIn(bounds, (cell) => {
      const chunk = this.chunkOf(cell) ?? this.allocateAt(cell);
      if (chunk === undefined) {
        complete = false;
        return;
      }
      chunk.conductivity ??= new Uint16Array(CHUNK_CELLS).fill(CONDUCTIVITY_ONE);
      const index = this.indexOf(cell);
      chunk.conductivity[index] = level;
      if (level === 0) for (const layer of chunk.layers.values()) layer[index] = 0;
      this.wake(chunk);
    });
    return complete;
  }

  /**
   * Calls `visit` for every cell whose centre lies inside `bounds` (inclusive), in canonical order
   * (x outermost, then y, then z).
   */
  forCellsIn(bounds: Bounds, visit: (cell: CellCoord) => void): void {
    const s = this.config.cellSize;
    const first = (m: number): number => floor(Math.ceil(m / s - 0.5));
    const last = (m: number): number => floor(m / s - 0.5);
    const { min, max } = bounds;
    for (let x = first(min.x); x <= last(max.x); x++) {
      for (let y = first(min.y); y <= last(max.y); y++) {
        for (let z = first(min.z); z <= last(max.z); z++) visit({ x, y, z });
      }
    }
  }

  /** Awake and asleep chunks in canonical order. Internal to the field module. */
  chunkList(): readonly Chunk[] {
    this.sorted ??= [...this.chunks.values()].sort(byPosition);
    return this.sorted;
  }

  /** The chunk at chunk coordinates, if allocated. Internal to the field module. */
  chunkAtCoords(cx: number, cy: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy, cz));
  }

  /**
   * Allocates an empty awake chunk at chunk coordinates, or returns undefined at the chunk cap.
   * Internal to the field module.
   */
  allocate(cx: number, cy: number, cz: number): Chunk | undefined {
    if (this.chunks.size >= this.config.maxChunks) return undefined;
    const chunk: Chunk = {
      cx,
      cy,
      cz,
      layers: new Map(),
      conductivity: undefined,
      calm: 0,
      asleep: false,
      links: [undefined, undefined, undefined, undefined, undefined, undefined],
    };
    LINK_STEPS.forEach(([dx, dy, dz], face) => {
      const other = this.chunks.get(chunkKey(cx + dx, cy + dy, cz + dz));
      if (other === undefined) return;
      chunk.links[face] = other;
      other.links[face ^ 1] = chunk;
    });
    this.chunks.set(chunkKey(cx, cy, cz), chunk);
    this.sorted = undefined;
    return chunk;
  }

  /** Frees a chunk. Internal to the field module. */
  release(chunk: Chunk): void {
    chunk.links.forEach((other, face) => {
      if (other !== undefined) other.links[face ^ 1] = undefined;
    });
    this.chunks.delete(chunkKey(chunk.cx, chunk.cy, chunk.cz));
    this.sorted = undefined;
  }

  /** `chunk`'s layer for `channel`, created (all ambient) if missing. Internal. */
  layerOf(chunk: Chunk, channel: FieldChannel): Float64Array {
    let layer = chunk.layers.get(channel);
    if (layer === undefined) {
      layer = new Float64Array(CHUNK_CELLS);
      chunk.layers.set(channel, layer);
    }
    return layer;
  }

  /** Marks `chunk` touched: awake, calm count reset. Internal. */
  wake(chunk: Chunk): void {
    chunk.asleep = false;
    chunk.calm = 0;
  }

  private chunkOf(cell: CellCoord): Chunk | undefined {
    return this.chunkAtCoords(...chunkCoords(cell));
  }

  private allocateAt(cell: CellCoord): Chunk | undefined {
    return this.allocate(...chunkCoords(cell));
  }

  private indexOf(cell: CellCoord): number {
    const [cx, cy, cz] = chunkCoords(cell);
    return cellIndex(cell.x - cx * CHUNK_SIZE, cell.y - cy * CHUNK_SIZE, cell.z - cz * CHUNK_SIZE);
  }

  /** Plain, canonically ordered data for snapshots and saves (all-ambient layers are omitted). */
  serialize(): FieldData {
    return {
      config: structuredClone(this.config),
      chunks: this.chunkList().map((chunk): ChunkData => {
        const layers = [...chunk.layers]
          .map(([name, values]) => [name, writeSparse(values, 0)] as const)
          .filter(([, list]) => list.length > 0)
          .sort(([a], [b]) => (a < b ? -1 : 1));
        return {
          at: [chunk.cx, chunk.cy, chunk.cz],
          calm: chunk.calm,
          asleep: chunk.asleep,
          conductivity:
            chunk.conductivity === undefined
              ? []
              : writeSparse(chunk.conductivity, CONDUCTIVITY_ONE),
          layers,
        };
      }),
    };
  }

  /** A field rebuilt from `serialize()` output; throws a RangeError for malformed data. */
  static deserialize(data: unknown): ElementField {
    const { config, chunks } = (data ?? {}) as { config?: unknown; chunks?: unknown };
    if (typeof config !== 'object' || config === null) invalid('config must be an object');
    if (!Array.isArray(chunks)) invalid('chunks must be an array');
    const field = new ElementField(config);
    for (const raw of chunks as unknown[]) field.restoreChunk(raw);
    return field;
  }

  private restoreChunk(raw: unknown): void {
    const {
      at: coords,
      calm,
      asleep,
      conductivity,
      layers,
    } = (raw ?? {}) as Record<string, unknown>;
    if (!Array.isArray(coords) || coords.length !== 3 || !coords.every(isInt)) {
      invalid('chunk.at must be three integers');
    }
    const [cx, cy, cz] = coords as [number, number, number];
    if (this.chunkAtCoords(cx, cy, cz) !== undefined) invalid('duplicate chunk');
    if (!isInt(calm) || calm < 0) invalid('chunk.calm must be a count');
    if (typeof asleep !== 'boolean') invalid('chunk.asleep must be a boolean');
    if (!Array.isArray(layers)) invalid('chunk.layers must be an array');
    const chunk = this.allocate(cx, cy, cz);
    if (chunk === undefined) invalid('more chunks than maxChunks');
    chunk.calm = calm;
    chunk.asleep = asleep;
    const table = new Uint16Array(CHUNK_CELLS).fill(CONDUCTIVITY_ONE);
    readSparse(conductivity, table, (c) => c >= 0 && c <= CONDUCTIVITY_ONE);
    if (table.some((c) => c !== CONDUCTIVITY_ONE)) chunk.conductivity = table;
    for (const entry of layers as unknown[]) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string') invalid('bad layer entry');
      const name = checkChannelName(entry[0]);
      if (chunk.layers.has(name)) invalid(`duplicate layer ${name}`);
      const { low, high } = this.channel(name);
      readSparse(entry[1], this.layerOf(chunk, name), (v) => v >= low && v <= high);
    }
    if (asleep && chunk.layers.size > 0) invalid('an asleep chunk holds no values');
  }
}

/** Chunk coordinates of `cell`. */
function chunkCoords(cell: CellCoord): [number, number, number] {
  return [floor(cell.x / CHUNK_SIZE), floor(cell.y / CHUNK_SIZE), floor(cell.z / CHUNK_SIZE)];
}
