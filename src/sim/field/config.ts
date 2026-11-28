// Element field configuration and fixed-point units (mw-e03.4). The element field stores every
// quantity as an integer count of 1/FIXED_ONE units, measured as a deviation from the channel's
// ambient value, so an untouched cell is exactly 0 and needs no storage. Integer values keep
// diffusion exactly conserving and bit-identical on every JS engine: fluxes are truncated integers
// computed with + - * / on magnitudes well below 2^53, so no rounding ever happens.
//
// Channels: `temperature` (°C, ambient 20 like the property default), `moisture` (0–1), `charge`
// (sim charge units) and one `gas:<id>` channel per gas type (concentration, 0–1 = fraction of the
// cell's volume). Each has a diffusion rate and an ambient loss (decay) per tick, a clamping range,
// and a sleep epsilon. Gas types share the `gas` spec unless `gases` overrides it per id.

import { PROPERTY_ID_PATTERN } from '../properties/spec';

/** Fixed-point scale: one unit of a channel (1 °C, full wetness, …) is FIXED_ONE counts. */
export const FIXED_ONE = 65_536;
/** Scale of a diffusion or decay rate: 1 per tick is RATE_ONE. */
export const RATE_ONE = 4_096;
/** Scale of a cell's conductivity: open air is CONDUCTIVITY_ONE, a wall is 0. */
export const CONDUCTIVITY_ONE = 256;
/**
 * The largest deviation from ambient a channel may span, in units. Keeps every value below 2^31
 * counts, so a flux product (value difference × rate × conductivity) stays exact below 2^53.
 */
export const MAX_CHANNEL_SPAN = 32_767;
/** The largest diffusion rate per face per tick: six faces then move at most everything once. */
export const MAX_DIFFUSION = 1 / 6;
/** Cells per chunk edge (a chunk is CHUNK_SIZE³ cells). */
export const CHUNK_SIZE = 8;
/** Cells per chunk. */
export const CHUNK_CELLS = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

/** The quantities a cell holds. */
export type BaseChannel = 'temperature' | 'moisture' | 'charge';
/** A field channel: a base channel, or `gas:<id>` for a gas type (lowercase kebab-case id). */
export type FieldChannel = BaseChannel | `gas:${string}`;

/** How one channel behaves. Rates are per tick at the world's tick rate. */
export interface ChannelSpec {
  /** Value of an untouched cell (absolute units, within [min, max]). */
  readonly ambient: number;
  /** Lowest value a cell may hold (absolute units). */
  readonly min: number;
  /** Highest value a cell may hold (absolute units). */
  readonly max: number;
  /** Fraction of the difference exchanged across each open face per tick, in [0, 1/6]. */
  readonly diffusion: number;
  /** Fraction of the deviation from ambient lost per tick (ambient loss), in [0, 1]. */
  readonly decay: number;
  /** A chunk whose every value is within this of ambient counts as calm (units, ≥ 0). */
  readonly epsilon: number;
}

/** The element field's configuration (plain data; part of the snapshot). */
export interface FieldConfig {
  /** Cell edge length, metres. */
  readonly cellSize: number;
  /** Most chunks the field may hold at once; allocation past it is refused (memory bound). */
  readonly maxChunks: number;
  /** Consecutive calm ticks after which a chunk sleeps (settles to ambient, costs nothing). */
  readonly sleepTicks: number;
  readonly temperature: ChannelSpec;
  readonly moisture: ChannelSpec;
  readonly charge: ChannelSpec;
  /** Default spec for every gas type. */
  readonly gas: ChannelSpec;
  /** Per gas id overrides of `gas` (any subset of fields). */
  readonly gases: Readonly<Record<string, Partial<ChannelSpec>>>;
}

/** Overrides accepted by `resolveFieldConfig`: any subset, channel specs merged field by field. */
export interface FieldConfigInput {
  readonly cellSize?: number;
  readonly maxChunks?: number;
  readonly sleepTicks?: number;
  readonly temperature?: Partial<ChannelSpec>;
  readonly moisture?: Partial<ChannelSpec>;
  readonly charge?: Partial<ChannelSpec>;
  readonly gas?: Partial<ChannelSpec>;
  readonly gases?: Readonly<Record<string, Partial<ChannelSpec>>>;
}

/**
 * The defaults: 0.5 m cells, 4,096 chunks (2 M cells), sleep after 60 calm ticks. Heat, smoke and
 * steam have an ambient loss (mw-e03.5: heat soaks into walls and radiates away, soot settles, steam
 * condenses), so a fire in a sealed room still returns the room to ambient. Heat's loss keeps it
 * local, about a metre around a fire, which is what fire spread and the field's cost both want; a
 * temperature within 1 °C of ambient is calm. Each decay is large enough that the truncated per-tick
 * loss keeps acting down to the channel's epsilon (loss stops below 1 / decay counts), so chunks
 * settle and sleep.
 */
export const DEFAULT_FIELD_CONFIG: FieldConfig = Object.freeze({
  cellSize: 0.5,
  maxChunks: 4096,
  sleepTicks: 60,
  temperature: {
    ambient: 20,
    min: -273.15,
    max: 10_000,
    diffusion: 0.1,
    decay: 0.02,
    epsilon: 1,
  },
  moisture: { ambient: 0, min: 0, max: 1, diffusion: 0.02, decay: 0, epsilon: 0.001 },
  charge: { ambient: 0, min: 0, max: 10_000, diffusion: 0.15, decay: 0.05, epsilon: 0.01 },
  gas: { ambient: 0, min: 0, max: 1, diffusion: 0.08, decay: 0, epsilon: 0.0005 },
  gases: {
    smoke: { decay: 0.002, epsilon: 0.01 },
    steam: { decay: 0.01, epsilon: 0.005 },
  },
});

function fail(what: string, problem: string): never {
  throw new RangeError(`field config ${what} ${problem}`);
}

function checkChannel(what: string, spec: ChannelSpec): ChannelSpec {
  const { ambient, min, max, diffusion, decay, epsilon } = spec;
  for (const [name, n] of Object.entries({ ambient, min, max, diffusion, decay, epsilon })) {
    if (typeof n !== 'number' || !Number.isFinite(n)) fail(`${what}.${name}`, 'must be finite');
  }
  if (!(min <= ambient && ambient <= max)) fail(`${what}.ambient`, 'must lie within [min, max]');
  if (max - ambient > MAX_CHANNEL_SPAN || ambient - min > MAX_CHANNEL_SPAN) {
    fail(what, `must stay within ${String(MAX_CHANNEL_SPAN)} units of ambient`);
  }
  if (diffusion < 0 || diffusion > MAX_DIFFUSION) fail(`${what}.diffusion`, 'must be in [0, 1/6]');
  if (decay < 0 || decay > 1) fail(`${what}.decay`, 'must be in [0, 1]');
  if (epsilon < 0) fail(`${what}.epsilon`, 'must be ≥ 0');
  return { ambient, min, max, diffusion, decay, epsilon };
}

/**
 * The field config for a scene whose air is `temperature` °C (mw-e03.62): the temperature channel's
 * ambient, which cells relax toward, calm is measured against and sleeping chunks settle to. With no
 * temperature (an unauthored scene) it is the empty input, so the field is the default 20 °C one.
 */
export function airFieldConfig(temperature?: number): FieldConfigInput {
  return temperature === undefined ? {} : { temperature: { ambient: temperature } };
}

function checkCount(what: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) fail(what, 'must be a positive integer');
  return value;
}

/**
 * The full, validated config for `input` over DEFAULT_FIELD_CONFIG (plain data). Throws a RangeError
 * for a non-positive cell size or count, a non-finite number, an ambient outside its range, a span
 * past MAX_CHANNEL_SPAN, a diffusion outside [0, 1/6], a decay outside [0, 1], a negative epsilon
 * or a gas id that is not lowercase kebab-case.
 */
export function resolveFieldConfig(input: FieldConfigInput = {}): FieldConfig {
  const d = DEFAULT_FIELD_CONFIG;
  const cellSize = input.cellSize ?? d.cellSize;
  if (!Number.isFinite(cellSize) || cellSize <= 0) fail('cellSize', 'must be a finite number > 0');
  const gas = checkChannel('gas', { ...d.gas, ...input.gas });
  const gases: Record<string, Partial<ChannelSpec>> = {};
  const overrides = input.gases ?? {};
  for (const id of [...new Set([...Object.keys(d.gases), ...Object.keys(overrides)])].sort()) {
    if (!PROPERTY_ID_PATTERN.test(id)) fail(`gases["${id}"]`, 'must be a kebab-case gas id');
    // Per id, the input's fields override the default override's (a gas id is merged, not replaced).
    const override = { ...d.gases[id], ...overrides[id] };
    checkChannel(`gases["${id}"]`, { ...gas, ...override });
    gases[id] = override;
  }
  return {
    cellSize,
    maxChunks: checkCount('maxChunks', input.maxChunks ?? d.maxChunks),
    sleepTicks: checkCount('sleepTicks', input.sleepTicks ?? d.sleepTicks),
    temperature: checkChannel('temperature', { ...d.temperature, ...input.temperature }),
    moisture: checkChannel('moisture', { ...d.moisture, ...input.moisture }),
    charge: checkChannel('charge', { ...d.charge, ...input.charge }),
    gas,
    gases,
  };
}

const GAS_PREFIX = 'gas:';

/** The gas id of a `gas:<id>` channel, or undefined for a base channel. */
export function gasOf(channel: FieldChannel): string | undefined {
  return channel.startsWith(GAS_PREFIX) ? channel.slice(GAS_PREFIX.length) : undefined;
}

/** Throws a RangeError unless `channel` is a base channel or `gas:<kebab-case id>`. */
export function checkChannelName(channel: string): FieldChannel {
  if (channel === 'temperature' || channel === 'moisture' || channel === 'charge') return channel;
  const gas = gasOf(channel as FieldChannel);
  if (gas === undefined || !PROPERTY_ID_PATTERN.test(gas)) {
    throw new RangeError(`unknown field channel "${channel}"`);
  }
  return `gas:${gas}`;
}

/** `spec` in fixed-point counts, precomputed for the diffusion kernel. */
export interface FixedChannel {
  readonly spec: ChannelSpec;
  /** Ambient, absolute units. */
  readonly ambient: number;
  /** Clamping range of the stored deviation, counts. */
  readonly low: number;
  readonly high: number;
  /** Diffusion rate, RATE_ONE scale. */
  readonly rate: number;
  /** Decay rate, RATE_ONE scale. */
  readonly decay: number;
  /** Sleep threshold, counts. */
  readonly epsilon: number;
}

/** Units → counts, rounded to the nearest count (IEEE-exact on every engine). */
export const toCounts = (units: number): number => Math.round(units * FIXED_ONE) + 0;
/** Counts → units. */
export const toUnits = (counts: number): number => counts / FIXED_ONE;

/** The fixed-point form of `channel` under `config` (a validated channel name). */
export function fixedChannel(config: FieldConfig, channel: FieldChannel): FixedChannel {
  const gas = gasOf(channel);
  const spec =
    gas === undefined
      ? config[channel as BaseChannel]
      : { ...config.gas, ...(Object.hasOwn(config.gases, gas) ? config.gases[gas] : {}) };
  return {
    spec,
    ambient: spec.ambient,
    low: toCounts(spec.min - spec.ambient),
    high: toCounts(spec.max - spec.ambient),
    rate: Math.round(spec.diffusion * RATE_ONE),
    decay: Math.round(spec.decay * RATE_ONE),
    epsilon: toCounts(spec.epsilon),
  };
}
