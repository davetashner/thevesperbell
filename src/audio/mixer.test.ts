import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from './engine.ts';
import { FakeAudioContext, type FakeGain } from './fake-context.ts';
import { SoundRegistry } from './manifest.ts';
import {
  MIN_DB,
  MIXER_RAMP_S,
  bindMixer,
  sliderToGain,
  type MixerKey,
  type MixerValues,
  type Visibility,
} from './mixer.ts';
import { dbToGain } from './buses.ts';
import { documentVisibility } from './browser.ts';

const DEFAULTS: { -readonly [K in MixerKey]: MixerValues[K] } = {
  'audio.master': 0.8,
  'audio.music': 1,
  'audio.sfx': 1,
  'audio.ambience': 1,
  'audio.ui': 1,
  'audio.muteHidden': true,
  'audio.mono': false,
  'audio.nightMode': false,
};

/** A settings store double with `set`, and a visibility double driven by `show`/`hide`. */
function rig(saved: Partial<typeof DEFAULTS> = {}) {
  const values = { ...DEFAULTS, ...saved };
  const listeners = new Map<MixerKey, Set<(value: never) => void>>();
  const settings = {
    get: <K extends MixerKey>(key: K): MixerValues[K] => values[key],
    on: <K extends MixerKey>(key: K, listener: (value: MixerValues[K]) => void) => {
      const set = listeners.get(key) ?? new Set();
      listeners.set(key, set);
      set.add(listener);
      return () => set.delete(listener);
    },
    set<K extends MixerKey>(key: K, value: MixerValues[K]) {
      (values as Record<MixerKey, unknown>)[key] = value;
      for (const l of listeners.get(key) ?? []) l(value as never);
    },
  };
  let hidden = false;
  const visListeners = new Set<() => void>();
  const visibility: Visibility = {
    hidden: () => hidden,
    subscribe: (l) => {
      visListeners.add(l);
      return () => visListeners.delete(l);
    },
  };
  const setHidden = (value: boolean) => {
    hidden = value;
    for (const l of visListeners) l();
  };
  return { settings, visibility, setHidden, visListeners, listeners };
}

function engineRig(state: AudioContextState = 'suspended') {
  const ctx = new FakeAudioContext({ state });
  const createContext = vi.fn(() => ctx);
  const engine = new AudioEngine({
    registry: new SoundRegistry(),
    createContext,
    fetchBytes: () => Promise.reject(new Error('none')),
    resolveUrl: (id: string, ext: string) => `/a/${id}.${ext}`,
    format: 'ogg',
    now: () => 0,
  } as never);
  return { ctx, engine, createContext };
}

function gainAt(ctx: FakeAudioContext, index: number): FakeGain {
  const gain = ctx.gains[index];
  if (!gain) throw new Error(`no gain ${String(index)}`);
  return gain;
}

describe('slider curve (mw-e28.5)', () => {
  it('AC-1: maps 0–1 onto −60..0 dB, so 50% is −30 dB and 100% is unity', () => {
    expect(sliderToGain(0.5)).toBeCloseTo(dbToGain(MIN_DB / 2));
    expect(sliderToGain(1)).toBe(1);
    expect(sliderToGain(2)).toBe(1);
    expect(sliderToGain(0.05)).toBeCloseTo(dbToGain(-57));
  });

  it('AC-2: 0 is exactly 0, and bad input is mute rather than NaN', () => {
    expect(sliderToGain(0)).toBe(0);
    expect(sliderToGain(-1)).toBe(0);
    expect(sliderToGain(Number.NaN)).toBe(0);
  });
});

describe('bindMixer', () => {
  it('AC-1: a slider change sets that bus to the curve value and ramps over 50 ms', async () => {
    const { ctx, engine } = engineRig('running');
    const r = rig();
    bindMixer(engine, r.settings, r.visibility);
    await engine.unlock();
    ctx.currentTime = 3;
    r.settings.set('audio.sfx', 0.5);
    const sfx = gainAt(ctx, 2);
    expect(sfx.gain.value).toBeCloseTo(sliderToGain(0.5));
    expect(sfx.gain.events).toEqual([
      { type: 'cancel', time: 3 },
      { type: 'set', value: 1, time: 3 },
      { type: 'ramp', value: sliderToGain(0.5), time: 3 + MIXER_RAMP_S },
    ]);
    expect(MIXER_RAMP_S).toBe(0.05);
  });

  it('AC-2: slider 0 puts the bus gain at exactly 0 for every bus slider', async () => {
    const { ctx, engine } = engineRig('running');
    const r = rig();
    bindMixer(engine, r.settings, r.visibility);
    await engine.unlock();
    for (const key of [
      'audio.master',
      'audio.music',
      'audio.sfx',
      'audio.ambience',
      'audio.ui',
    ] as const) {
      r.settings.set(key, 0);
    }
    // buses build in order: master, music, sfx, combat, footsteps, creatures, ambience, ui
    const [master, music, sfx, , , , ambience, ui] = ctx.gains;
    for (const bus of [master, music, sfx, ambience, ui]) expect(bus?.gain.value).toBe(0);
  });

  it('AC-3: hidden ramps master to 0 and visible restores the slider value', async () => {
    const { ctx, engine } = engineRig('running');
    const r = rig();
    bindMixer(engine, r.settings, r.visibility);
    await engine.unlock();
    const master = gainAt(ctx, 0);
    const level = sliderToGain(0.8);
    expect(master.gain.value).toBeCloseTo(level);
    ctx.currentTime = 1;
    r.setHidden(true);
    expect(master.gain.events.at(-1)).toEqual({ type: 'ramp', value: 0, time: 1 + MIXER_RAMP_S });
    r.settings.set('audio.master', 0.6); // moved while hidden: still silent, restored value is new
    expect(master.gain.value).toBe(0);
    r.setHidden(false);
    expect(master.gain.value).toBeCloseTo(sliderToGain(0.6));
  });

  it('AC-3: with mute-when-hidden off, hiding the tab keeps the sound; toggling it applies at once', async () => {
    const { ctx, engine } = engineRig('running');
    const r = rig({ 'audio.muteHidden': false });
    bindMixer(engine, r.settings, r.visibility);
    await engine.unlock();
    const master = gainAt(ctx, 0);
    r.setHidden(true);
    expect(master.gain.value).toBeCloseTo(sliderToGain(0.8));
    r.settings.set('audio.muteHidden', true);
    expect(master.gain.value).toBe(0);
  });

  it('AC-4: saved volumes are on the buses when the context is created, before any sound', () => {
    const { ctx, engine, createContext } = engineRig();
    const r = rig({
      'audio.master': 0.5,
      'audio.sfx': 0.25,
      'audio.mono': true,
      'audio.nightMode': true,
    });
    bindMixer(engine, r.settings, r.visibility);
    expect(createContext).not.toHaveBeenCalled(); // binding never creates the context early
    void engine.unlock();
    expect(createContext).toHaveBeenCalledTimes(1);
    const [master, , sfx] = ctx.gains;
    expect(master?.gain.value).toBeCloseTo(sliderToGain(0.5));
    expect(sfx?.gain.value).toBeCloseTo(sliderToGain(0.25));
    expect(master?.channelCount).toBe(1);
    expect(ctx.compressors[1]?.ratio.value).toBeGreaterThan(1);
    expect(master?.gain.events).toEqual([]); // set directly, not ramped up from unity
  });

  it('AC-4: a tab already hidden at boot starts muted', () => {
    const { ctx, engine } = engineRig();
    const r = rig();
    r.setHidden(true);
    bindMixer(engine, r.settings, r.visibility);
    void engine.unlock();
    expect(ctx.gains[0]?.gain.value).toBe(0);
  });

  it('AC-5: mono downmixes a hard-left source to equal channels; off passes it through', async () => {
    const { ctx, engine } = engineRig('running');
    const r = rig();
    bindMixer(engine, r.settings, r.visibility);
    await engine.unlock();
    const master = gainAt(ctx, 0);
    expect(master.mix([1, 0])).toEqual([1, 0]);
    r.settings.set('audio.mono', true);
    const [left, right] = master.mix([1, 0]);
    expect(left).toBe(right);
    expect(left).toBeGreaterThan(0);
    r.settings.set('audio.mono', false);
    expect(master.mix([1, 0])).toEqual([1, 0]);
  });

  it('night mode ramps the compressor in and out', async () => {
    const { ctx, engine } = engineRig('running');
    const r = rig();
    bindMixer(engine, r.settings, r.visibility);
    await engine.unlock();
    const night = ctx.compressors[1];
    expect(night?.ratio.value).toBe(1);
    r.settings.set('audio.nightMode', true);
    expect(night?.ratio.value).toBeGreaterThan(1);
    expect(night?.ratio.events.at(-1)).toMatchObject({ type: 'ramp', time: MIXER_RAMP_S });
    r.settings.set('audio.nightMode', false);
    expect(night?.ratio.value).toBe(1);
  });

  it('dispose unsubscribes from settings and visibility', () => {
    const { engine } = engineRig();
    const r = rig();
    const binding = bindMixer(engine, r.settings, r.visibility);
    binding.dispose();
    expect(r.visListeners.size).toBe(0);
    for (const set of r.listeners.values()) expect(set.size).toBe(0);
  });
});

describe('documentVisibility', () => {
  it('reads visibilityState and follows visibilitychange until unsubscribed', () => {
    const target = new EventTarget();
    const state: { visibilityState: DocumentVisibilityState } = { visibilityState: 'visible' };
    const doc = Object.assign(target, state);
    const visibility = documentVisibility(doc);
    const listener = vi.fn();
    const off = visibility.subscribe(listener);
    expect(visibility.hidden()).toBe(false);
    doc.visibilityState = 'hidden';
    target.dispatchEvent(new Event('visibilitychange'));
    expect(visibility.hidden()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    target.dispatchEvent(new Event('visibilitychange'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
