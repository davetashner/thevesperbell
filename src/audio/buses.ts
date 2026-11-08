// Mix bus graph (mw-e28.1): master → music, sfx (→ combat, footsteps, creatures), ambience, ui.
// Assets arrive at fixed file loudness (audio bible §5.1); the mixer balances categories with bus
// gains (mw-e28.5) and a limiter on master keeps true peak under −1 dBTP.
import type { BusId, PlayableBusId } from './manifest.ts';
import type {
  AudioContextLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
} from './web-audio.ts';

/** Each bus's parent; master feeds the limiter. */
export const BUS_PARENT: Readonly<Record<PlayableBusId, BusId>> = {
  music: 'master',
  sfx: 'master',
  combat: 'sfx',
  footsteps: 'sfx',
  creatures: 'sfx',
  ambience: 'master',
  ui: 'master',
};

/** Master limiter settings: brick-wall-ish at −1 dB (audio bible §5.1 master target). */
export const LIMITER = { threshold: -1, knee: 0, ratio: 20, attack: 0.003, release: 0.25 } as const;

/** "Night mode" compressor on master (mw-e28.5): evens out loud moments for quiet listening. */
export const NIGHT_COMPRESSOR = { threshold: -30, knee: 20, ratio: 6, attack: 0.01, release: 0.3 };

/** The same compressor switched off: ratio 1 never reduces gain. */
export const NIGHT_BYPASS = { threshold: 0, ratio: 1 } as const;

/** Buses the mix (snapshots, ducks) shapes; each gets a stage between it and its parent. */
export const MIX_BUS_IDS = ['music', 'sfx', 'ambience', 'ui'] as const;
export type MixBusId = (typeof MIX_BUS_IDS)[number];

/** Low-pass cutoff meaning "open": above the audible band, so the filter does nothing. */
export const LOWPASS_OPEN_HZ = 20_000;

/**
 * The mix stage on a bus (mw-e28.9): bus gain (the player's slider) → snapshot gain → duck gain →
 * low-pass → parent. Separate nodes mean the player's volume, the situation's snapshot and a duck
 * multiply and never overwrite each other.
 */
export interface MixStage {
  readonly snapshot: GainNodeLike;
  readonly duck: GainNodeLike;
  readonly filter: BiquadFilterNodeLike;
}

export interface BusGraph {
  readonly stages: Readonly<Record<MixBusId, MixStage>>;
  readonly buses: Readonly<Record<BusId, GainNodeLike>>;
  /** Night-mode compressor between master and the limiter; transparent until switched on. */
  readonly night: DynamicsCompressorNodeLike;
  readonly limiter: DynamicsCompressorNodeLike;
}

/** Builds the bus graph on a context, all gains at unity. */
export function buildBusGraph(ctx: AudioContextLike): BusGraph {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER.threshold;
  limiter.knee.value = LIMITER.knee;
  limiter.ratio.value = LIMITER.ratio;
  limiter.attack.value = LIMITER.attack;
  limiter.release.value = LIMITER.release;
  limiter.connect(ctx.destination);

  const night = ctx.createDynamicsCompressor();
  night.knee.value = NIGHT_COMPRESSOR.knee;
  night.attack.value = NIGHT_COMPRESSOR.attack;
  night.release.value = NIGHT_COMPRESSOR.release;
  night.threshold.value = NIGHT_BYPASS.threshold;
  night.ratio.value = NIGHT_BYPASS.ratio;
  night.connect(limiter);

  const master = ctx.createGain();
  // Explicit stereo, so mono downmix is a channel-count switch on this node.
  master.channelCountMode = 'explicit';
  master.channelCount = 2;
  master.connect(night);
  const buses = { master } as Record<BusId, GainNodeLike>;
  // BUS_PARENT lists parents before children, so each parent exists when its child connects.
  for (const [bus, parent] of Object.entries(BUS_PARENT) as [PlayableBusId, BusId][]) {
    const node = ctx.createGain();
    buses[bus] = node;
    if (!(MIX_BUS_IDS as readonly string[]).includes(bus)) node.connect(buses[parent]);
  }
  // Mix buses connect through their stage (created after every bus, so bus order is stable).
  const stages = {} as Record<MixBusId, MixStage>;
  for (const bus of MIX_BUS_IDS) {
    const snapshot = ctx.createGain();
    const duck = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = LOWPASS_OPEN_HZ;
    buses[bus].connect(snapshot);
    snapshot.connect(duck);
    duck.connect(filter);
    filter.connect(buses[BUS_PARENT[bus]]);
    stages[bus] = { snapshot, duck, filter };
  }
  return { buses, stages, night, limiter };
}

/** Converts decibels to a linear gain factor. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Ramps a param from its current value to `value` over `seconds` (0 = set now). */
export function rampParam(
  param: AudioParamLike,
  value: number,
  now: number,
  seconds: number,
): void {
  param.cancelScheduledValues(now);
  if (seconds > 0) {
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + seconds);
  } else {
    param.value = value;
  }
}

/** Mono downmix: master mixes to one channel, which the output then plays from both speakers. */
export function applyMono(graph: BusGraph, mono: boolean): void {
  graph.buses.master.channelCount = mono ? 1 : 2;
}

/** Switches the night-mode compressor on or off, ramped. */
export function applyNightMode(
  graph: BusGraph,
  on: boolean,
  now: number,
  rampSeconds: number,
): void {
  const target = on ? NIGHT_COMPRESSOR : NIGHT_BYPASS;
  rampParam(graph.night.threshold, target.threshold, now, rampSeconds);
  rampParam(graph.night.ratio, target.ratio, now, rampSeconds);
}

/** Sets a bus's snapshot stage: gain and low-pass cutoff (`null` = open), ramped. */
export function applySnapshotStage(
  graph: BusGraph,
  bus: MixBusId,
  gain: number,
  lowpassHz: number | null,
  now: number,
  rampSeconds: number,
): void {
  const stage = graph.stages[bus];
  rampParam(stage.snapshot.gain, gain, now, rampSeconds);
  rampParam(stage.filter.frequency, lowpassHz ?? LOWPASS_OPEN_HZ, now, rampSeconds);
}

/** Sets a bus's duck stage gain, ramped. */
export function applyDuckStage(
  graph: BusGraph,
  bus: MixBusId,
  gain: number,
  now: number,
  rampSeconds: number,
): void {
  rampParam(graph.stages[bus].duck.gain, gain, now, rampSeconds);
}
