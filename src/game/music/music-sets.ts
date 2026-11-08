// Music sets (mw-e28.11): the data the adaptive controller plays. A set is one location's track
// family (audio bible §2.2): a track per music layer (explore, tension, stealth, combat), any subset,
// with the tempo the music clock counts bars in, plus the tuning that shapes the transitions. Pure
// data: tune the delays and crossfade lengths here, never in the controller.
import type { StingerAlertState } from './stinger-hooks.ts';

/** The layers a set can have, quietest first; a higher layer outranks a lower one. */
export const MUSIC_LAYERS = ['explore', 'stealth', 'tension', 'combat'] as const;
export type MusicLayer = (typeof MUSIC_LAYERS)[number];

/** One layer's track: a cue in the sound manifest. */
export interface LayerSpec {
  readonly cue: string;
  /** Repeats until the layer fades out; false plays once (the explore bed: audio bible §2.1). */
  readonly loop: boolean;
  /** Tempo of this track when its loop sidecar has none; defaults to the set's. */
  readonly bpm?: number;
  readonly beatsPerBar?: number;
}

export interface MusicSet {
  readonly id: string;
  /** Scene that plays this set. */
  readonly scene: string;
  /** Default tempo of the set's tracks (a sidecar's `bpm` and `beatsPerBar` win). */
  readonly bpm: number;
  readonly beatsPerBar: number;
  /**
   * True for real stems of one piece: every layer starts together on one clock and keeps playing
   * muted, so a layer always joins in phase. False for separate tracks (the slice's): a layer
   * starts from its top on the bar line it fades in on.
   */
  readonly lockstep: boolean;
  readonly layers: Readonly<Partial<Record<MusicLayer, LayerSpec>>>;
  /** One-shot per alert state, played on the next beat. */
  readonly stingers?: Readonly<Partial<Record<StingerAlertState, string>>>;
}

/** Timing of the transitions, in seconds and bars. */
export interface MusicTuning {
  /** How long no creature may be in combat before the combat layer leaves (bead mw-e28.11 AC-2). */
  readonly combatExitDelayS: number;
  /** How long no creature may be investigating or searching before the tension layer leaves. */
  readonly tensionExitDelayS: number;
  /** Crossfade length, in bars, when a more intense layer comes in. */
  readonly enterBars: number;
  /** Crossfade length, in bars, when the music relaxes. */
  readonly exitBars: number;
  /** Segments an equal-power fade is scheduled in on the audio clock. */
  readonly fadeSteps: number;
  /** Scheduling lead: the earliest a transition may start after it is requested, seconds. */
  readonly leadS: number;
}

/**
 * Audio bible §2.1 asks 4 s to leave combat and 6 s to leave tension; the bead's AC-2 asks 8 s for
 * combat. The bead wins (a fight with a brief lull keeps its score), and it is data so it can be
 * tuned. Crossfades are 1 bar going in and 2 bars coming out (bible §2.2: 1–2 bars).
 */
export const DEFAULT_TUNING: MusicTuning = {
  combatExitDelayS: 8,
  tensionExitDelayS: 6,
  enterBars: 1,
  exitBars: 2,
  fadeSteps: 16,
  leadS: 0.05,
};

/** Cue ids of the slice's two tracks in the sound manifest. */
export const SLICE_MUSIC_CUES = {
  explore: 'music-slice-explore',
  combat: 'music-slice-combat',
} as const;

/**
 * The slice: the open-world explore track (64 bpm, 6/8) and the skeleton arena combat loop (128 bpm,
 * 6/8, 1:2 with the explore tempo), crossfading on bar lines. Tempos are the briefs' intent; the
 * combat sidecar carries 128/6 and the explore take has no sidecar (neither verified with an
 * analyser yet).
 */
export const MUSIC_SETS: readonly MusicSet[] = [
  {
    id: 'slice',
    scene: 'slice',
    bpm: 64,
    beatsPerBar: 6,
    lockstep: false,
    layers: {
      explore: { cue: SLICE_MUSIC_CUES.explore, loop: false, bpm: 64, beatsPerBar: 6 },
      combat: { cue: SLICE_MUSIC_CUES.combat, loop: true, bpm: 128, beatsPerBar: 6 },
    },
  },
];

/** The set a scene plays, if it has one. */
export function musicSetFor(
  scene: string,
  sets: readonly MusicSet[] = MUSIC_SETS,
): MusicSet | undefined {
  return sets.find((set) => set.scene === scene);
}
