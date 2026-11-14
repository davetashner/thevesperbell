// Player mixer (mw-e28.5): the audio settings' volume sliders, mute-when-hidden, mono and night
// mode drive the engine. Pure logic over structural interfaces so Node tests cover it; the browser
// glue is `documentVisibility` in browser.ts and one `bindMixer` call in main.ts.
import type { BusId } from './manifest.ts';

/**
 * Perceptual slider curve (mw-e31.9): linear gain = slider ^ SLIDER_EXPONENT. A 10 dB drop sounds
 * about half as loud, so 50% lands at -10 dB (0.5 ^ 5/3 = 0.315) and 100% is unity. Low positions
 * fall away quickly (10% is about -33 dB) and 0 is exact mute.
 */
export const SLIDER_EXPONENT = 5 / 3;

/** Seconds every mixer change ramps over, so nothing clicks. */
export const MIXER_RAMP_S = 0.05;

/** The sliders and the buses each drives (settings store 0–1, shown as 0–100%). */
export const MIXER_BUSES = {
  'audio.master': 'master',
  'audio.music': 'music',
  'audio.sfx': 'sfx',
  'audio.ambience': 'ambience',
  'audio.ui': 'ui',
} as const satisfies Record<string, BusId>;

export type MixerVolumeKey = keyof typeof MIXER_BUSES;

export interface MixerValues {
  readonly 'audio.master': number;
  readonly 'audio.music': number;
  readonly 'audio.sfx': number;
  readonly 'audio.ambience': number;
  readonly 'audio.ui': number;
  readonly 'audio.muteHidden': boolean;
  readonly 'audio.mono': boolean;
  readonly 'audio.nightMode': boolean;
}
export type MixerKey = keyof MixerValues;

const KEYS: readonly MixerKey[] = [
  'audio.master',
  'audio.music',
  'audio.sfx',
  'audio.ambience',
  'audio.ui',
  'audio.muteHidden',
  'audio.mono',
  'audio.nightMode',
];

/** Slider position 0–1 to linear gain on the perceptual curve; 0 and bad input are exact mute. */
export function sliderToGain(slider: number): number {
  if (!(slider > 0)) return 0;
  return Math.min(1, slider) ** SLIDER_EXPONENT;
}

export interface MixerEngine {
  setBusGain(bus: BusId, gain: number, rampSeconds?: number): void;
  setMono(mono: boolean): void;
  setNightMode(on: boolean, rampSeconds?: number): void;
}

export interface MixerSettings {
  get<K extends MixerKey>(key: K): MixerValues[K];
  on<K extends MixerKey>(key: K, listener: (value: MixerValues[K]) => void): () => void;
}

/** Page visibility, as the mixer sees it. */
export interface Visibility {
  hidden(): boolean;
  /** Calls `listener` on every change; returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export interface MixerBinding {
  dispose(): void;
}

/**
 * Applies the saved mix at once (no ramp: the engine holds it until its context exists, so it is in
 * place before the first sound), then follows every change with a 50 ms ramp. While the tab is
 * hidden and mute-when-hidden is on, master is 0; showing the tab ramps it back to the slider value.
 */
export function bindMixer(
  engine: MixerEngine,
  settings: MixerSettings,
  visibility: Visibility,
): MixerBinding {
  const masterGain = (): number =>
    settings.get('audio.muteHidden') && visibility.hidden()
      ? 0
      : sliderToGain(settings.get('audio.master'));
  const apply = (ramp: number): void => {
    for (const [key, bus] of Object.entries(MIXER_BUSES) as [MixerVolumeKey, BusId][]) {
      engine.setBusGain(
        bus,
        key === 'audio.master' ? masterGain() : sliderToGain(settings.get(key)),
        ramp,
      );
    }
  };
  apply(0);
  engine.setMono(settings.get('audio.mono'));
  engine.setNightMode(settings.get('audio.nightMode'), 0);

  const offs = KEYS.map((key) =>
    settings.on(key, () => {
      if (key === 'audio.mono') engine.setMono(settings.get('audio.mono'));
      else if (key === 'audio.nightMode') {
        engine.setNightMode(settings.get('audio.nightMode'), MIXER_RAMP_S);
      } else if (key === 'audio.master' || key === 'audio.muteHidden') {
        engine.setBusGain('master', masterGain(), MIXER_RAMP_S);
      } else engine.setBusGain(MIXER_BUSES[key], sliderToGain(settings.get(key)), MIXER_RAMP_S);
    }),
  );
  offs.push(
    visibility.subscribe(() => {
      engine.setBusGain('master', masterGain(), MIXER_RAMP_S);
    }),
  );
  return {
    dispose() {
      for (const off of offs) off();
    },
  };
}
