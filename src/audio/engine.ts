// The Web Audio engine (mw-e28.1): lazily creates the AudioContext, queues sounds until the first
// user gesture resumes it (browser autoplay policy), loads and caches decoded buffers, routes voices
// through the bus graph and PannerNodes, keeps the listener on the camera and enforces the voice
// budget. Presentation only: it reacts to calls from src/game and never writes sim state. Every host
// dependency (context, fetch, clock, logger) is injected so the logic runs in Node against the fake
// in fake-context.ts; browser.ts wires the real ones.
import { BufferCache, DEFAULT_CACHE_BYTES, type LoadedSound } from './buffer-cache.ts';
import {
  applyDuckStage,
  applyMono,
  applyNightMode,
  applySnapshotStage,
  buildBusGraph,
  dbToGain,
  rampParam,
  type BusGraph,
  type MixBusId,
} from './buses.ts';
import {
  loopSeconds,
  loopSidecarSchema,
  type AudioFormat,
  type BusId,
  type SoundDef,
  type SoundRegistry,
} from './manifest.ts';
import {
  applyListener,
  configurePanner,
  DEFAULT_LISTENER,
  distance,
  MAX_DISTANCE,
  setPannerPosition,
  type AudioQuality,
  type ListenerPose,
  type Vec3,
} from './spatial.ts';
import { MAX_VOICES, pickVictim } from './voice-pool.ts';
import { sineTone } from './wav.ts';
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  GainNodeLike,
  PannerNodeLike,
} from './web-audio.ts';

/** Requests older than this when they could finally start are dropped (bead mw-e28.1 AC-1). */
export const MAX_REQUEST_AGE_MS = 2000;

/** Fade used when a voice is stolen, to avoid a click. */
export const STEAL_FADE_S = 0.015;

/** Where and how to play a cue. */
export interface PlayOptions {
  /** Fixed world position (positional cues only). */
  readonly position?: Vec3;
  /** Entity to follow each frame (positional cues only); falls back to `position` if unknown. */
  readonly entity?: number;
  /** Linear volume multiplier, default 1. */
  readonly volume?: number;
  /** Playback-rate multiplier, default 1 (pitch jitter comes from cue sheets, mw-e28.3). */
  readonly pitch?: number;
  /** Explicit variant index; default is round-robin per cue. */
  readonly variant?: number;
  /** Voice priority (0–100) for this play, overriding the cue's; cue sheets set it per rule. */
  readonly priority?: number;
}

export type SoundHandleState = 'pending' | 'playing' | 'stopped';

/** Control over one playing (or queued) sound. */
export interface SoundHandle {
  readonly cueId: string;
  readonly state: SoundHandleState;
  /** Stops now, or after a linear fade of `fadeSeconds`. Idempotent. */
  stop(fadeSeconds?: number): void;
  /** Ramps volume (linear) over `seconds`. */
  fade(volume: number, seconds: number): void;
}

/** Load / playback state of a cue id. */
export type CueStatus = 'unknown' | 'ok' | 'failed';

export interface AudioEngineOptions {
  readonly registry: SoundRegistry;
  /** Creates the context; called once, on first use (not at construction). */
  readonly createContext: () => AudioContextLike;
  /** Fetches a file's bytes; rejects on HTTP or network failure. */
  readonly fetchBytes: (url: string) => Promise<ArrayBuffer>;
  /** URL of an asset file for this session's format (or its `.json` loop sidecar). */
  readonly resolveUrl: (assetId: string, ext: AudioFormat | 'json') => string;
  /** Format chosen for this browser (`pickFormat`). */
  readonly format: AudioFormat;
  /** Wall-clock milliseconds, for request age while the context is suspended or loading. */
  readonly now: () => number;
  /** World position of an entity this frame (render-interpolated), if it still exists. */
  readonly entityPosition?: (entity: number) => Vec3 | undefined;
  readonly quality?: AudioQuality;
  /** Dev builds replace failed sounds with a beep so broken assets are noticed. */
  readonly dev?: boolean;
  readonly warn?: (message: string) => void;
  readonly cacheBytes?: number;
}

/** Snapshot of engine state for debug overlays and tests. */
export interface AudioEngineStats {
  readonly state: AudioContextState | 'uncreated';
  readonly voices: number;
  readonly pending: number;
  readonly cachedBytes: number;
}

interface Request {
  readonly handle: Handle;
  readonly def: SoundDef;
  readonly assetId: string;
  readonly options: PlayOptions;
  readonly requestedAt: number;
  sound?: LoadedSound;
  failed?: boolean;
}

/** Everything that exists once the context does. */
interface Runtime {
  readonly ctx: AudioContextLike;
  readonly graph: BusGraph;
  readonly cache: BufferCache;
}

interface Voice {
  readonly ctx: AudioContextLike;
  readonly handle: Handle;
  readonly source: AudioBufferSourceNodeLike;
  readonly gain: GainNodeLike;
  readonly panner: PannerNodeLike | undefined;
  readonly entity: number | undefined;
  readonly priority: number;
  readonly seq: number;
  readonly trim: number;
  position: Vec3;
  distance: number;
}

class Handle implements SoundHandle {
  state: SoundHandleState = 'pending';
  /** Linear volume requested by the caller (before the cue's gainDb trim). */
  volume: number;
  voice: Voice | undefined;

  constructor(
    readonly cueId: string,
    volume: number,
    private readonly engine: AudioEngine,
  ) {
    this.volume = volume;
  }

  stop(fadeSeconds = 0): void {
    this.engine.stopHandle(this, fadeSeconds);
  }

  fade(volume: number, seconds: number): void {
    this.engine.fadeHandle(this, volume, seconds);
  }
}

/** The audio engine. One per page. */
export class AudioEngine {
  readonly #opts: AudioEngineOptions;
  readonly #quality: AudioQuality;
  readonly #maxVoices: number;
  readonly #warn: (message: string) => void;
  readonly #warned = new Set<string>();
  readonly #failedCues = new Set<string>();
  readonly #roundRobin = new Map<string, number>();
  readonly #voices = new Set<Voice>();
  /** Assets used by looping cues: their loaders also fetch the loop sidecar. */
  readonly #loopAssets = new Set<string>();
  #pending: Request[] = [];
  #rt: Runtime | undefined;
  #beep: AudioBufferLike | undefined;
  #listener: ListenerPose = DEFAULT_LISTENER;
  #seq = 0;
  readonly #busGains = new Map<BusId, number>();
  readonly #snapshots = new Map<MixBusId, { gain: number; lowpassHz: number | null }>();
  readonly #ducks = new Map<MixBusId, number>();
  #mono = false;
  #night = false;

  constructor(options: AudioEngineOptions) {
    this.#opts = options;
    this.#quality = options.quality ?? 'high';
    this.#maxVoices = MAX_VOICES[this.#quality];
    this.#warn =
      options.warn ??
      ((message) => {
        console.warn(message);
      });
  }

  /** The context, if created yet. */
  get context(): AudioContextLike | undefined {
    return this.#rt?.ctx;
  }

  /** Voice budget for the quality tier. */
  get maxVoices(): number {
    return this.#maxVoices;
  }

  /**
   * Call from a user-gesture handler (see `installGestureUnlock`): creates the context if needed
   * and resumes it; queued sounds younger than 2 s then play.
   */
  async unlock(): Promise<void> {
    const rt = this.#runtime();
    if (rt.ctx.state !== 'running') await rt.ctx.resume();
    this.#pump(rt);
  }

  /** Starts loading every variant of the given cues (unknown ids warn once, as with `play`). */
  preload(cueIds: readonly string[]): void {
    for (const id of cueIds) {
      const def = this.#lookup(id);
      if (def) for (const asset of def.variants) this.#load(asset, def).catch(() => undefined);
    }
  }

  /**
   * Plays a cue. Returns `null` for an unknown id (warned once per id) or a cue whose asset failed
   * in production; otherwise a handle that is `pending` until the context is running and the buffer
   * is decoded, then `playing`.
   */
  play(cueId: string, options: PlayOptions = {}): SoundHandle | null {
    const def = this.#lookup(cueId);
    if (!def) return null;
    if (this.#failedCues.has(cueId) && !this.#opts.dev) return null;
    const handle = new Handle(cueId, options.volume ?? 1, this);
    const request: Request = {
      handle,
      def,
      assetId: this.#variant(def, options.variant),
      options,
      requestedAt: this.#opts.now(),
    };
    this.#pending.push(request);
    const rt = this.#runtime();
    this.#load(request.assetId, def).then(
      (sound) => {
        request.sound = sound;
        this.#pump(rt);
      },
      () => {
        request.failed = true;
        this.#pump(rt);
      },
    );
    return handle;
  }

  /**
   * Once per render frame: moves the listener to the camera and every entity-attached voice to its
   * entity's current position, then starts any queued sounds that became playable.
   */
  update(listener?: ListenerPose): void {
    const rt = this.#rt;
    if (!rt) return;
    if (listener) {
      this.#listener = listener;
      applyListener(rt.ctx.listener, listener);
    }
    const here = this.#listener.position;
    const locate = this.#opts.entityPosition;
    for (const voice of this.#voices) {
      if (!voice.panner) continue;
      if (voice.entity !== undefined && locate) {
        const p = locate(voice.entity);
        if (p) {
          voice.position = p;
          setPannerPosition(voice.panner, p);
        }
      }
      voice.distance = distance(voice.position, here);
    }
    if (this.#pending.length > 0) this.#pump(rt);
  }

  /**
   * Sets a bus gain (linear), ramped over `rampSeconds` to avoid zipper noise. Before the context
   * exists the value is remembered and applied the moment it is created, ahead of any sound.
   */
  setBusGain(bus: BusId, gain: number, rampSeconds = 0): void {
    this.#busGains.set(bus, gain);
    const rt = this.#rt;
    if (rt) rampParam(rt.graph.buses[bus].gain, gain, rt.ctx.currentTime, rampSeconds);
  }

  /**
   * Sets a bus's snapshot stage (mw-e28.9): linear gain and low-pass cutoff in Hz (`null` = open),
   * ramped. Layered over the player's bus gain; remembered until the context exists.
   */
  setSnapshot(bus: MixBusId, gain: number, lowpassHz: number | null, rampSeconds = 0): void {
    this.#snapshots.set(bus, { gain, lowpassHz });
    const rt = this.#rt;
    if (rt) applySnapshotStage(rt.graph, bus, gain, lowpassHz, rt.ctx.currentTime, rampSeconds);
  }

  /** Sets a bus's duck stage gain (linear), ramped; layered over the snapshot and player gain. */
  setDuck(bus: MixBusId, gain: number, rampSeconds = 0): void {
    this.#ducks.set(bus, gain);
    const rt = this.#rt;
    if (rt) applyDuckStage(rt.graph, bus, gain, rt.ctx.currentTime, rampSeconds);
  }

  /** Mono downmix on or off (mw-e28.5); remembered until the context exists. */
  setMono(mono: boolean): void {
    this.#mono = mono;
    if (this.#rt) applyMono(this.#rt.graph, mono);
  }

  /** "Night mode" dynamic range compression on or off, ramped (mw-e28.5). */
  setNightMode(on: boolean, rampSeconds = 0): void {
    this.#night = on;
    const rt = this.#rt;
    if (rt) applyNightMode(rt.graph, on, rt.ctx.currentTime, rampSeconds);
  }

  /** Whether a cue is known and whether its asset failed to load. */
  cueStatus(cueId: string): CueStatus {
    if (!this.#opts.registry.get(cueId)) return 'unknown';
    return this.#failedCues.has(cueId) ? 'failed' : 'ok';
  }

  stats(): AudioEngineStats {
    return {
      state: this.#rt ? this.#rt.ctx.state : 'uncreated',
      voices: this.#voices.size,
      pending: this.#pending.length,
      cachedBytes: this.#rt ? this.#rt.cache.bytes : 0,
    };
  }

  /** @internal Called by handles. */
  stopHandle(handle: Handle, fadeSeconds: number): void {
    if (handle.state === 'stopped') return;
    handle.state = 'stopped';
    const voice = handle.voice;
    if (voice) this.#stopVoice(voice.ctx, voice, fadeSeconds);
  }

  /** @internal Called by handles. */
  fadeHandle(handle: Handle, volume: number, seconds: number): void {
    if (handle.state === 'stopped') return;
    handle.volume = volume;
    const voice = handle.voice;
    if (voice) rampParam(voice.gain.gain, volume * voice.trim, voice.ctx.currentTime, seconds);
  }

  #runtime(): Runtime {
    if (!this.#rt) {
      const ctx = this.#opts.createContext();
      const cache = new BufferCache(this.#opts.cacheBytes ?? DEFAULT_CACHE_BYTES, (id) =>
        this.#fetchAndDecode(ctx, id),
      );
      const graph = buildBusGraph(ctx);
      // Mixer settings given before the first sound apply here, before anything can play.
      for (const [bus, gain] of this.#busGains) graph.buses[bus].gain.value = gain;
      for (const [bus, { gain, lowpassHz }] of this.#snapshots) {
        applySnapshotStage(graph, bus, gain, lowpassHz, ctx.currentTime, 0);
      }
      for (const [bus, gain] of this.#ducks) applyDuckStage(graph, bus, gain, ctx.currentTime, 0);
      applyMono(graph, this.#mono);
      applyNightMode(graph, this.#night, ctx.currentTime, 0);
      this.#rt = { ctx, graph, cache };
    }
    return this.#rt;
  }

  #lookup(cueId: string): SoundDef | undefined {
    const def = this.#opts.registry.get(cueId);
    if (!def) this.#warnOnce(`unknown-cue:${cueId}`, `audio: unknown cue id "${cueId}"`);
    return def;
  }

  #warnOnce(key: string, message: string): void {
    if (this.#warned.has(key)) return;
    this.#warned.add(key);
    this.#warn(message);
  }

  #variant(def: SoundDef, index: number | undefined): string {
    const variants = def.variants;
    const n = variants.length;
    let i: number;
    if (index === undefined) {
      i = this.#roundRobin.get(def.id) ?? 0;
      this.#roundRobin.set(def.id, (i + 1) % n);
    } else {
      i = ((index % n) + n) % n;
    }
    return variants.reduce((chosen, asset, k) => (k === i ? asset : chosen), variants[0]);
  }

  #load(assetId: string, def: SoundDef): Promise<LoadedSound> {
    const { cache } = this.#runtime();
    if (def.loop) this.#loopAssets.add(assetId);
    return cache.request(assetId).catch((error: unknown) => {
      this.#failedCues.add(def.id);
      this.#warnOnce(
        `failed-cue:${def.id}`,
        `audio: cue "${def.id}" failed to load (${String(error)})`,
      );
      throw error;
    });
  }

  async #fetchAndDecode(ctx: AudioContextLike, assetId: string): Promise<LoadedSound> {
    const { fetchBytes, resolveUrl, format } = this.#opts;
    const [bytes, sidecar] = await Promise.all([
      fetchBytes(resolveUrl(assetId, format)),
      this.#loopAssets.has(assetId) ? this.#loadSidecar(resolveUrl(assetId, 'json')) : undefined,
    ]);
    const buffer = await ctx.decodeAudioData(bytes);
    return sidecar ? { buffer, loop: sidecar } : { buffer };
  }

  /** Loop points from the §5.3 sidecar; without one a loop repeats the whole buffer. */
  async #loadSidecar(url: string): Promise<{ start: number; end: number } | undefined> {
    let bytes: ArrayBuffer;
    try {
      bytes = await this.#opts.fetchBytes(url);
    } catch {
      return undefined;
    }
    try {
      return loopSeconds(loopSidecarSchema.parse(JSON.parse(new TextDecoder().decode(bytes))));
    } catch (error) {
      this.#warn(`audio: ignoring invalid loop sidecar ${url} (${String(error)})`);
      return undefined;
    }
  }

  /** Starts, drops or keeps each queued request. */
  #pump(rt: Runtime): void {
    const { ctx } = rt;
    const now = this.#opts.now();
    const running = ctx.state === 'running';
    const keep: Request[] = [];
    for (const request of this.#pending) {
      const { handle, def } = request;
      if (handle.state === 'stopped') continue;
      // Loops are state (a bed, a burning torch), not events: they start late rather than never.
      if (!def.loop && now - request.requestedAt > MAX_REQUEST_AGE_MS) {
        handle.state = 'stopped';
        continue;
      }
      const ready = request.sound ?? (request.failed ? this.#fallback(ctx) : undefined);
      if (request.failed && !ready) {
        handle.state = 'stopped';
        continue;
      }
      if (!running || !ready) {
        keep.push(request);
        continue;
      }
      this.#start(rt, request, ready);
    }
    this.#pending = keep;
  }

  /** Dev builds hear a beep for a broken sound; production stays silent. */
  #fallback(ctx: AudioContextLike): LoadedSound | undefined {
    if (!this.#opts.dev) return undefined;
    this.#beep ??= makeBeep(ctx);
    return { buffer: this.#beep };
  }

  #start(rt: Runtime, request: Request, sound: LoadedSound): void {
    const { ctx, graph } = rt;
    const { handle, def, options } = request;
    const position = def.spatial ? this.#initialPosition(options) : undefined;
    const priority = options.priority ?? def.priority;
    const dist = position ? distance(position, this.#listener.position) : 0;
    // One-shots beyond the audible range are culled; loops keep playing (the source may approach).
    if (position && !def.loop && dist > MAX_DISTANCE) {
      handle.state = 'stopped';
      return;
    }
    if (this.#voices.size >= this.#maxVoices) {
      const victim = pickVictim(this.#voices, { priority, distance: dist });
      if (!victim) {
        handle.state = 'stopped';
        return;
      }
      victim.handle.state = 'stopped';
      this.#stopVoice(ctx, victim, STEAL_FADE_S);
    }

    const source = ctx.createBufferSource();
    source.buffer = sound.buffer;
    source.playbackRate.value = options.pitch ?? 1;
    if (def.loop) {
      source.loop = true;
      if (sound.loop) {
        source.loopStart = sound.loop.start;
        source.loopEnd = sound.loop.end;
      }
    }
    const trim = dbToGain(def.gainDb);
    const gain = ctx.createGain();
    gain.gain.value = handle.volume * trim;
    source.connect(gain);
    let panner: PannerNodeLike | undefined;
    if (position) {
      panner = ctx.createPanner();
      configurePanner(panner, this.#quality);
      setPannerPosition(panner, position);
      gain.connect(panner);
      panner.connect(graph.buses[def.bus]);
    } else {
      gain.connect(graph.buses[def.bus]);
    }
    const voice: Voice = {
      ctx,
      handle,
      source,
      gain,
      panner,
      entity: position ? options.entity : undefined,
      priority,
      seq: this.#seq++,
      trim,
      position: position ?? this.#listener.position,
      distance: dist,
    };
    source.onended = () => {
      this.#voices.delete(voice);
      handle.state = 'stopped';
      source.disconnect();
      gain.disconnect();
      panner?.disconnect();
    };
    this.#voices.add(voice);
    handle.voice = voice;
    handle.state = 'playing';
    source.start();
  }

  #initialPosition(options: PlayOptions): Vec3 | undefined {
    const { entity, position } = options;
    const locate = this.#opts.entityPosition;
    const tracked = entity !== undefined && locate ? locate(entity) : undefined;
    return tracked ?? position;
  }

  /** Frees the voice slot now and silences it (after a fade). */
  #stopVoice(ctx: AudioContextLike, voice: Voice, fadeSeconds: number): void {
    this.#voices.delete(voice);
    const t = ctx.currentTime;
    if (fadeSeconds > 0) {
      rampParam(voice.gain.gain, 0, t, fadeSeconds);
      voice.source.stop(t + fadeSeconds);
    } else {
      voice.source.stop();
    }
  }
}

/** Placeholder beep for dev builds: 120 ms of 880 Hz at the context rate. */
export function makeBeep(ctx: AudioContextLike): AudioBufferLike {
  const samples = sineTone(880, 0.12, ctx.sampleRate);
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}
