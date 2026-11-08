// The adaptive music controller (mw-e28.11, audio bible §2.1–2.2). It plays a location's music set,
// a track per layer (explore, stealth, tension, combat; any subset), and moves between layers with
// equal-power crossfades that start on a bar line of the music clock and last 1–2 bars, so a change
// in the fight never lands off the beat. Leaving combat waits a delay with no creature in combat
// (hysteresis), and alert stingers play on the next beat. Presentation only: it reads sim events
// and never writes to the sim. Nothing is requested before the audio context is running (the
// autoplay policy). A track that fails to load is skipped: one log, silence for that layer.
//
// Playback is scheduled on the audio clock (decoded buffers via AudioEngine.startTrack), not media
// elements: elements cannot be started on one shared sample clock, so stems could drift apart by
// tens of milliseconds, which breaks the 10 ms stem-sync budget. Decoded buffers start sample-
// accurately together and never drift; the download budget is protected differently, as music is
// not part of the first-load pack and the cache is LRU-capped (mw-e28.1).
import type { MusicTrack, MusicVoice, StartTrackOptions } from '@audio/index';
import type { AlertState } from '@content/index';
import { AlertStateChanged, Died, type EntityId, type World } from '@sim/index';
import {
  DEFAULT_TUNING,
  MUSIC_LAYERS,
  type LayerSpec,
  type MusicLayer,
  type MusicSet,
  type MusicTuning,
} from './music-sets.ts';
import type { MusicStinger, MusicStingerListener } from './stinger-hooks.ts';

/** The engine as the controller uses it (the AudioEngine satisfies it). */
export interface AdaptiveMusicEngine {
  readonly context: { readonly state: string; readonly currentTime: number } | undefined;
  loadTrack(cueId: string): Promise<MusicTrack>;
  startTrack(cueId: string, track: MusicTrack, options?: StartTrackOptions): MusicVoice | null;
}

/** Where stinger events come from (AlertStingerHooks satisfies it). */
export interface StingerSource {
  on(listener: MusicStingerListener): () => void;
}

export interface AdaptiveMusicOptions {
  readonly world: World<never>;
  readonly engine: AdaptiveMusicEngine;
  readonly set: MusicSet;
  readonly stingers?: StingerSource;
  readonly tuning?: MusicTuning;
  /** Defaults to console.warn. */
  readonly warn?: (message: string) => void;
}

/** What the music is doing, for the e2e probe and debug overlays. */
export interface AdaptiveMusicState {
  readonly started: boolean;
  /** The layer the music is on (or moving to); undefined before it starts or in silence. */
  readonly layer: MusicLayer | undefined;
  /** The music state the alert states ask for, after hysteresis. */
  readonly wanted: MusicLayer;
  readonly inCombat: boolean;
}

const SILENCE = 'silence';
type Target = MusicLayer | typeof SILENCE;

/** Layers an unavailable state falls back through: combat without a combat track plays tension. */
const FALLBACK: Readonly<Record<MusicLayer, readonly MusicLayer[]>> = {
  combat: ['combat', 'tension', 'stealth', 'explore'],
  tension: ['tension', 'stealth', 'explore'],
  stealth: ['stealth', 'explore'],
  explore: ['explore'],
};

const layerRank = (target: Target): number =>
  target === SILENCE ? -1 : MUSIC_LAYERS.indexOf(target);

/** The music state each alert state asks for. */
const LAYER_FOR_ALERT: Readonly<Record<AlertState, MusicLayer>> = {
  unaware: 'explore',
  suspicious: 'stealth',
  investigating: 'tension',
  searching: 'tension',
  alerted: 'tension',
  combat: 'combat',
};

/** An equal-power fade in progress (or finished) on one layer. */
interface Fade {
  readonly t0: number;
  readonly t1: number;
  readonly from: number;
  readonly to: number;
  /** Where on the quarter-sine the fade starts (0 for a full fade; more when it resumes midway). */
  readonly p0: number;
}

/** A layer to start a voice for, with its loaded track. */
interface Start {
  readonly layer: LayerRuntime;
  readonly track: MusicTrack;
}

interface LayerRuntime {
  readonly name: MusicLayer;
  readonly spec: LayerSpec;
  track?: MusicTrack;
  failed: boolean;
  /** A play-once layer that ran out. */
  ended: boolean;
  voice?: MusicVoice | undefined;
  barS: number;
  beatS: number;
  /** Level when no fade is running. */
  rest: number;
  fade?: Fade | undefined;
}

/** Level of an equal-power fade at progress p of its remaining curve. */
function fadeShape(fade: Fade, p: number): number {
  const angle = ((fade.p0 + (1 - fade.p0) * p) * Math.PI) / 2;
  return fade.to > fade.from ? Math.sin(angle) : Math.cos(angle);
}

function levelAt(layer: LayerRuntime, t: number): number {
  const { fade } = layer;
  if (!fade) return layer.rest;
  if (t <= fade.t0) return fade.from;
  if (t >= fade.t1) return fade.to;
  return fadeShape(fade, (t - fade.t0) / (fade.t1 - fade.t0));
}

export class AdaptiveMusic {
  readonly #engine: AdaptiveMusicEngine;
  readonly #set: MusicSet;
  readonly #tuning: MusicTuning;
  readonly #warn: (message: string) => void;
  readonly #layers = new Map<MusicLayer, LayerRuntime>();
  readonly #stingerTracks = new Map<string, MusicTrack>();
  readonly #stingerAt = new Map<string, number>();
  readonly #alerts = new Map<EntityId, AlertState>();
  readonly #offs: (() => void)[] = [];
  #loading = false;
  #warned = false;
  #started = false;
  #target: Target | undefined;
  #wanted: MusicLayer = 'explore';
  #lowerSince: number | undefined;

  constructor(options: AdaptiveMusicOptions) {
    this.#engine = options.engine;
    this.#set = options.set;
    this.#tuning = options.tuning ?? DEFAULT_TUNING;
    this.#warn =
      options.warn ??
      ((message) => {
        console.warn(message);
      });
    for (const name of MUSIC_LAYERS) {
      const spec = this.#set.layers[name];
      if (spec) {
        const bpm = spec.bpm ?? this.#set.bpm;
        const beatsPerBar = spec.beatsPerBar ?? this.#set.beatsPerBar;
        this.#layers.set(name, {
          name,
          spec,
          failed: false,
          ended: false,
          barS: (beatsPerBar * 60) / bpm,
          beatS: 60 / bpm,
          rest: 0,
        });
      }
    }
    const { world } = options;
    this.#offs.push(
      world.events.on(AlertStateChanged, ({ entity, to }) => {
        if (to === 'unaware') this.#alerts.delete(entity);
        else this.#alerts.set(entity, to);
      }),
      world.events.on(Died, ({ target }) => {
        this.#alerts.delete(target);
      }),
    );
    if (options.stingers) {
      this.#offs.push(
        options.stingers.on((event) => {
          this.#stinger(event);
        }),
      );
    }
  }

  get state(): AdaptiveMusicState {
    return {
      started: this.#started,
      layer: this.#target === SILENCE ? undefined : this.#target,
      wanted: this.#wanted,
      inCombat: this.#wanted === 'combat',
    };
  }

  /** Once per frame: loads the tracks once audio can run, and moves between layers. */
  update(): void {
    const ctx = this.#engine.context;
    if (ctx?.state !== 'running') return;
    if (!this.#loading) this.#load();
    const t = ctx.currentTime;
    this.#updateWanted(t);
    this.#drive(t);
  }

  /** Fades everything out and unsubscribes (leaving the scene). */
  dispose(): void {
    for (const off of this.#offs) off();
    this.#offs.length = 0;
    const t = this.#engine.context?.currentTime ?? 0;
    for (const layer of this.#layers.values()) {
      layer.voice?.stop(t + 1);
      layer.voice = undefined;
    }
    this.#alerts.clear();
    this.#started = false;
    this.#target = undefined;
  }

  #load(): void {
    this.#loading = true;
    for (const layer of this.#layers.values()) {
      this.#engine.loadTrack(layer.spec.cue).then(
        (track) => {
          layer.track = track;
          if (track.timing) {
            layer.barS = (track.timing.beatsPerBar * 60) / track.timing.bpm;
            layer.beatS = 60 / track.timing.bpm;
          }
        },
        (error: unknown) => {
          layer.failed = true;
          if (!this.#warned) {
            this.#warned = true;
            this.#warn(`music: track "${layer.spec.cue}" failed to load (${String(error)})`);
          }
        },
      );
    }
    for (const cue of new Set(Object.values(this.#set.stingers ?? {}))) {
      this.#engine.loadTrack(cue).then(
        (track) => {
          this.#stingerTracks.set(cue, track);
        },
        () => undefined,
      );
    }
  }

  /** The music state the alerts ask for, held back while it is dropping (hysteresis). */
  #updateWanted(t: number): void {
    let raw: MusicLayer = 'explore';
    for (const alert of this.#alerts.values()) {
      const layer = LAYER_FOR_ALERT[alert];
      if (layerRank(layer) > layerRank(raw)) raw = layer;
    }
    if (layerRank(raw) >= layerRank(this.#wanted)) {
      this.#wanted = raw;
      this.#lowerSince = undefined;
      return;
    }
    this.#lowerSince ??= t;
    const delay =
      this.#wanted === 'combat'
        ? this.#tuning.combatExitDelayS
        : this.#wanted === 'tension'
          ? this.#tuning.tensionExitDelayS
          : 0;
    if (t - this.#lowerSince >= delay) {
      this.#wanted = raw;
      this.#lowerSince = undefined;
    }
  }

  #usable(layer: LayerRuntime | undefined): layer is LayerRuntime {
    return layer !== undefined && !layer.failed && !layer.ended;
  }

  /** The layer to be on for the wanted state, or silence once nothing is left to play. */
  #resolve(): Target | undefined {
    for (const name of FALLBACK[this.#wanted]) {
      const layer = this.#layers.get(name);
      if (this.#usable(layer)) return name;
    }
    return this.#started ? SILENCE : undefined;
  }

  #drive(t: number): void {
    if (this.#set.lockstep && !this.#started && !this.#startLockstep(t)) return;
    const want = this.#resolve();
    if (want === undefined || want === this.#target) return;
    const incoming = want === SILENCE ? undefined : this.#layers.get(want);
    let start: Start | undefined;
    if (incoming && !incoming.voice) {
      // A set of separate tracks starts the layer on the bar line; it waits for the track to load.
      if (!incoming.track) return;
      start = { layer: incoming, track: incoming.track };
    }
    this.#transition(want, t, incoming, start);
  }

  /** Starts every stem together on one clock, muted but for the wanted layer. */
  #startLockstep(t: number): boolean {
    const stems: [LayerRuntime, MusicTrack][] = [];
    for (const layer of this.#layers.values()) {
      if (layer.failed) continue;
      if (!layer.track) return false;
      stems.push([layer, layer.track]);
    }
    if (stems.length === 0) return false;
    const when = t + this.#tuning.leadS;
    const first = this.#resolve();
    for (const [layer, track] of stems) {
      const level = layer.name === first ? 1 : 0;
      this.#startVoice(layer, track, when, level);
      layer.rest = level;
    }
    this.#started = true;
    this.#target = first;
    return true;
  }

  /** Starts a layer's voice; false when the engine would not (the layer is dropped). */
  #startVoice(layer: LayerRuntime, track: MusicTrack, when: number, level: number): boolean {
    const voice = this.#engine.startTrack(layer.spec.cue, track, {
      when,
      offset: layer.spec.startOffsetS ?? 0,
      loop: layer.spec.loop || this.#set.lockstep,
      volume: level,
      onEnded: () => {
        if (layer.voice !== voice) return;
        layer.voice = undefined;
        if (!layer.spec.loop) layer.ended = true;
      },
    });
    if (voice) layer.voice = voice;
    else layer.failed = true;
    return voice !== null;
  }

  /** Moves to a layer: a crossfade that starts on the next bar line. */
  #transition(
    want: Target,
    t: number,
    incoming: LayerRuntime | undefined,
    start: Start | undefined,
  ): void {
    const { leadS, enterBars, exitBars } = this.#tuning;
    const current =
      this.#target === undefined || this.#target === SILENCE
        ? undefined
        : this.#layers.get(this.#target);
    const outgoing = current?.voice ? current : undefined;
    const first = !this.#started;
    let when = t + leadS;
    let bar = incoming?.barS ?? outgoing?.barS ?? 0;
    if (outgoing?.voice) {
      // The shorter bar of the two tracks, counted from when the playing track started: a 1:2 tempo
      // pair shares its bar lines, and a change never waits out the slower track's long bar.
      bar = Math.min(outgoing.barS, incoming?.barS ?? outgoing.barS);
      const anchor = outgoing.voice.startTime;
      when = anchor + Math.ceil((t + leadS - anchor) / bar - 1e-9) * bar;
    }
    const bars = layerRank(want) > layerRank(this.#target ?? SILENCE) ? enterBars : exitBars;
    const duration = bars * bar;
    if (incoming && start) {
      if (!this.#startVoice(start.layer, start.track, when, first ? 1 : 0)) return;
      incoming.rest = first ? 1 : 0;
      incoming.fade = undefined;
    }
    for (const layer of this.#layers.values()) {
      if (layer === incoming) {
        if (!first && layer.voice) this.#fade(layer, layer.voice, 1, when, duration);
      } else if (layer.voice && (levelAt(layer, when) > 0 || layer.fade?.to)) {
        this.#fade(layer, layer.voice, 0, when, duration);
        if (!this.#set.lockstep && layer.spec.loop) {
          layer.voice.stop(when + duration);
          layer.voice = undefined;
        }
      }
    }
    this.#started = true;
    this.#target = want;
  }

  /** Schedules an equal-power fade of a layer's voice to `to`, starting at `when`. */
  #fade(layer: LayerRuntime, voice: MusicVoice, to: 0 | 1, when: number, duration: number): void {
    const from = levelAt(layer, when);
    const partial = to === 1 ? Math.asin(from) : Math.acos(from);
    const p0 = (2 * partial) / Math.PI;
    const fade: Fade = { t0: when, t1: when + duration * (1 - p0), from, to, p0 };
    const { gain } = voice;
    gain.cancelScheduledValues(when);
    gain.setValueAtTime(from * voice.trim, when);
    const steps = this.#tuning.fadeSteps;
    for (let i = 1; i <= steps; i++) {
      const at = fade.t0 + ((fade.t1 - fade.t0) * i) / steps;
      gain.linearRampToValueAtTime(
        (i === steps ? to : fadeShape(fade, i / steps)) * voice.trim,
        at,
      );
    }
    layer.fade = fade;
    layer.rest = to;
  }

  /** A stinger plays on the next beat of the music that is playing. */
  #stinger(event: MusicStinger): void {
    const cue = this.#set.stingers?.[event.state];
    const ctx = this.#engine.context;
    const track = cue === undefined ? undefined : this.#stingerTracks.get(cue);
    if (cue === undefined || !track || ctx?.state !== 'running') return;
    const t = ctx.currentTime;
    let when = t + this.#tuning.leadS;
    const playing =
      this.#target === undefined || this.#target === SILENCE
        ? undefined
        : this.#layers.get(this.#target);
    if (playing?.voice) {
      const anchor = playing.voice.startTime;
      when = anchor + Math.ceil((when - anchor) / playing.beatS - 1e-9) * playing.beatS;
    }
    // Several creatures changing state on one frame play one stinger.
    if (this.#stingerAt.get(cue) === when) return;
    this.#stingerAt.set(cue, when);
    this.#engine.startTrack(cue, track, { when });
  }
}
