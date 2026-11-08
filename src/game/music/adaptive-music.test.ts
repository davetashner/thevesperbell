import { describe, expect, it, vi } from 'vitest';
import {
  AudioEngine,
  SNAPSHOTS,
  SoundRegistry,
  type SoundDefInput,
  type MusicTrack,
  type MusicVoice,
} from '@audio/index';
import { FakeAudioContext, FakeBuffer, type FakeParam, type FakeSource } from '@audio/fake-context';
import { AlertStateChanged, Died, registerWorldProperties, World } from '@sim/index';
import { AdaptiveMusic, type AdaptiveMusicEngine, type StingerSource } from './adaptive-music.ts';
import { DEFAULT_TUNING, musicSetFor, type MusicSet, type MusicTuning } from './music-sets.ts';
import type { MusicStinger, MusicStingerListener } from './stinger-hooks.ts';

const BAR_90 = 4 * (60 / 90); // 2.667 s
const MANIFEST: SoundDefInput[] = [
  { id: 'music-t-explore', variants: ['music-t-explore'], bus: 'music', loop: false },
  { id: 'music-t-tension', variants: ['music-t-tension'], bus: 'music', loop: true },
  { id: 'music-t-stealth', variants: ['music-t-stealth'], bus: 'music', loop: true },
  { id: 'music-t-combat', variants: ['music-t-combat'], bus: 'music', loop: true },
  { id: 'stinger-t-combat', variants: ['stinger-t-combat'], bus: 'music' },
  { id: 'sfx-t-click', variants: ['sfx-t-click'], bus: 'ui' },
];

/** Slice-like: explore plays once and combat loops, 90 BPM in 4/4, separate tracks. */
const SEPARATE: MusicSet = {
  id: 't',
  scene: 't',
  bpm: 90,
  beatsPerBar: 4,
  lockstep: false,
  layers: {
    explore: { cue: 'music-t-explore', loop: false },
    combat: { cue: 'music-t-combat', loop: true },
  },
  stingers: { combat: 'stinger-t-combat', alerted: 'stinger-t-combat' },
};

/** All four stems of one piece, started together. */
const STEMS: MusicSet = {
  id: 's',
  scene: 's',
  bpm: 90,
  beatsPerBar: 4,
  lockstep: true,
  layers: {
    explore: { cue: 'music-t-explore', loop: true },
    stealth: { cue: 'music-t-stealth', loop: true },
    tension: { cue: 'music-t-tension', loop: true },
    combat: { cue: 'music-t-combat', loop: true },
  },
};

interface Setup {
  readonly set?: MusicSet;
  readonly tuning?: MusicTuning;
  readonly fail?: (url: string) => boolean;
  readonly sidecar?: (url: string) => string | undefined;
  readonly state?: AudioContextState;
}

function setup(options: Setup = {}) {
  const world = registerWorldProperties(new World({ seed: 1 }));
  const ctx = new FakeAudioContext({
    state: options.state ?? 'running',
    decode: () => new FakeBuffer(2, 48_000 * 64, 48_000),
  });
  const warn = vi.fn<(message: string) => void>();
  const engine = new AudioEngine({
    registry: new SoundRegistry().register(MANIFEST),
    createContext: () => ctx,
    fetchBytes: (url) => {
      if (options.fail?.(url)) return Promise.reject(new Error('HTTP 404'));
      const sidecar = url.endsWith('.json') ? options.sidecar?.(url) : undefined;
      if (url.endsWith('.json') && sidecar === undefined) return Promise.reject(new Error('404'));
      return Promise.resolve(
        sidecar === undefined ? new ArrayBuffer(1) : new TextEncoder().encode(sidecar).buffer,
      );
    },
    resolveUrl: (id, ext) => `/${id}.${ext}`,
    format: 'ogg',
    now: () => 0,
    warn: () => undefined,
  });
  const listeners = new Set<MusicStingerListener>();
  const stingers: StingerSource = {
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const musicWarn = warn;
  const music = new AdaptiveMusic({
    world,
    engine,
    set: options.set ?? SEPARATE,
    stingers,
    ...(options.tuning ? { tuning: options.tuning } : {}),
    warn: musicWarn,
  });
  const creature = world.spawn();
  const other = world.spawn();
  const alert = (
    entity: number,
    to: 'unaware' | 'suspicious' | 'investigating' | 'alerted' | 'combat',
  ): void => {
    world.events.emit(AlertStateChanged, { tick: 0, entity, from: 'unaware', to, cause: 'test' });
    world.step();
  };
  /** Runs the frame loop to audio-clock time `t` in 50 ms frames. */
  const runTo = async (t: number): Promise<void> => {
    await engine.unlock();
    while (ctx.currentTime < t - 1e-9) {
      ctx.currentTime = Math.min(t, ctx.currentTime + 0.05);
      music.update();
      await Promise.resolve();
    }
  };
  /** Waits for track loads. */
  const loaded = async (): Promise<void> => {
    await engine.unlock();
    music.update();
    for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    music.update();
  };
  const sourceFor = (nth: number): FakeSource => {
    const source = ctx.sources.filter((s) => s.startedAt !== undefined)[nth];
    if (!source) throw new Error(`no source ${String(nth)}`);
    return source;
  };
  return {
    world,
    ctx,
    engine,
    music,
    warn,
    creature,
    other,
    alert,
    runTo,
    loaded,
    sourceFor,
    listeners,
  };
}

/** Gain params of music voices, in start order. */
function musicGains(ctx: FakeAudioContext): FakeParam[] {
  return ctx.sources
    .filter((s) => s.startedAt !== undefined && s.outputs.length > 0)
    .map((s) => (s.outputs[0] as unknown as { gain: FakeParam }).gain);
}

function failParam(): never {
  throw new Error('no gain param');
}

const ramps = (param: FakeParam) => param.events.filter((e) => e.type === 'ramp');

describe('AdaptiveMusic (mw-e28.11)', () => {
  it('starts the explore track once the context runs, at full level', async () => {
    const t = setup();
    await t.loaded();
    expect(t.music.state).toMatchObject({ started: true, layer: 'explore', inCombat: false });
    expect(t.ctx.sources).toHaveLength(1);
    expect(t.sourceFor(0).loop).toBe(false);
    expect(musicGains(t.ctx)[0]?.value).toBe(1);
  });

  it('requests nothing while the context is suspended', async () => {
    const t = setup({ state: 'suspended' });
    t.music.update();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    t.music.update();
    expect(t.music.state.started).toBe(false);
    expect(t.ctx.sources).toHaveLength(0);
  });

  it('AC-1: a mid-bar request at 90 BPM starts the crossfade on the next bar line', async () => {
    const t = setup();
    await t.loaded();
    await t.runTo(1.0);
    const anchor = t.sourceFor(0).startedAt ?? 0;
    t.alert(t.creature, 'combat');
    await t.runTo(1.1);
    const combat = t.sourceFor(1);
    expect(combat.loop).toBe(true);
    const start = combat.startedAt ?? 0;
    expect(start - 1.0).toBeLessThanOrEqual(2.67);
    expect(start).toBeGreaterThan(1.0);
    const bars = (start - anchor) / BAR_90;
    expect(bars).toBeCloseTo(Math.round(bars), 6);
    expect(start).toBeCloseTo(anchor + BAR_90, 6);
    // Both gains start moving only at that bar line.
    const [exploreGain, combatGain] = musicGains(t.ctx);
    for (const param of [exploreGain, combatGain]) {
      expect(ramps(param ?? failParam())[0]?.time).toBeGreaterThan(start);
    }
  });

  it('entering combat is an equal-power crossfade of one bar with no instant gain jump', async () => {
    const t = setup();
    await t.loaded();
    await t.runTo(1.0);
    t.alert(t.creature, 'combat');
    await t.runTo(1.1);
    const [exploreGain, combatGain] = musicGains(t.ctx) as [FakeParam, FakeParam];
    const start = t.sourceFor(1).startedAt ?? 0;
    const out = ramps(exploreGain);
    const into = ramps(combatGain);
    expect(out).toHaveLength(DEFAULT_TUNING.fadeSteps);
    expect(into).toHaveLength(DEFAULT_TUNING.fadeSteps);
    expect(out.at(-1)?.time).toBeCloseTo(start + DEFAULT_TUNING.enterBars * BAR_90, 6);
    out.forEach((step, i) => {
      const other = into[i];
      expect(step.time).toBeCloseTo(other?.time ?? NaN, 9);
      expect(step.value ** 2 + (other?.value ?? NaN) ** 2).toBeCloseTo(1, 6);
    });
    expect(out.at(-1)?.value).toBeCloseTo(0, 9);
    expect(into.at(-1)?.value).toBeCloseTo(1, 9);
    // Nothing is scheduled before the bar line, and no step jumps by more than a sixteenth of the
    // curve's steepest part: the music never snaps.
    const sets = [exploreGain, combatGain].flatMap((p) => p.events.filter((e) => e.type === 'set'));
    expect(sets.filter((e) => e.time > 1.0).every((e) => e.time >= start - 1e-9)).toBe(true);
    let previous = 1;
    for (const step of out) {
      expect(Math.abs(step.value - previous)).toBeLessThan(0.11);
      previous = step.value;
    }
  });

  it('the combat mix snapshot leaves the music bus alone, so it cannot jump ahead of the crossfade', () => {
    expect(SNAPSHOTS.combat.buses.music).toBeUndefined();
    expect(SNAPSHOTS.explore.buses.music).toBeUndefined();
  });

  it('AC-2: the combat layer leaves 8 s after the last creature stops fighting, not if combat resumes at 6 s', async () => {
    const t = setup();
    await t.loaded();
    t.alert(t.creature, 'combat');
    await t.runTo(5);
    expect(t.music.state.layer).toBe('combat');
    t.alert(t.creature, 'unaware');
    await t.runTo(5 + 7.9);
    expect(t.music.state.layer).toBe('combat');
    await t.runTo(5 + 8.1);
    expect(t.music.state.layer).toBe('explore');
    expect(t.music.state.inCombat).toBe(false);

    // Combat resumes 6 s into the next quiet spell: the layer never leaves.
    t.alert(t.other, 'combat');
    await t.runTo(30);
    expect(t.music.state.layer).toBe('combat');
    const sourcesBefore = t.ctx.sources.length;
    t.alert(t.other, 'unaware');
    await t.runTo(36);
    t.alert(t.other, 'combat');
    await t.runTo(48);
    expect(t.music.state.layer).toBe('combat');
    expect(t.ctx.sources).toHaveLength(sourcesBefore);
  });

  it('leaving combat is a two-bar equal-power crossfade back to the explore track on a bar line', async () => {
    const t = setup();
    await t.loaded();
    t.alert(t.creature, 'combat');
    await t.runTo(5);
    t.alert(t.creature, 'unaware');
    await t.runTo(5 + 8.2);
    const [exploreGain, combatGain] = musicGains(t.ctx) as [FakeParam, FakeParam];
    const back = ramps(exploreGain).slice(DEFAULT_TUNING.fadeSteps);
    const away = ramps(combatGain).slice(DEFAULT_TUNING.fadeSteps);
    expect(back).toHaveLength(DEFAULT_TUNING.fadeSteps);
    const start = t.sourceFor(1).startedAt ?? 0;
    const steps = DEFAULT_TUNING.fadeSteps;
    const duration = DEFAULT_TUNING.exitBars * BAR_90;
    const when = (away[0]?.time ?? 0) - duration / steps;
    const bars = (when - start) / BAR_90;
    expect(bars).toBeCloseTo(Math.round(bars), 6);
    expect((away.at(-1)?.time ?? 0) - when).toBeCloseTo(duration, 6);
    back.forEach((step, i) => {
      expect(step.value ** 2 + (away[i]?.value ?? NaN) ** 2).toBeCloseTo(1, 6);
    });
    const combatSource = t.sourceFor(1);
    expect(combatSource.stoppedAt).toBeCloseTo(away.at(-1)?.time ?? NaN, 6);
  });

  it('a new fight starts the combat track again from its top on a bar line', async () => {
    const t = setup();
    await t.loaded();
    t.alert(t.creature, 'combat');
    await t.runTo(3);
    t.alert(t.creature, 'unaware');
    await t.runTo(25);
    t.alert(t.creature, 'combat');
    await t.runTo(30);
    const second = t.ctx.sources.filter((s) => s.startedAt !== undefined && s.loop).at(-1);
    expect(t.ctx.sources.filter((s) => s.loop && s.startedAt !== undefined)).toHaveLength(2);
    expect(second?.startOffset).toBe(0);
    expect(t.music.state.layer).toBe('combat');
  });

  it('the shorter bar of a 1:2 tempo pair sets the grid, counted from the playing track', async () => {
    const t = setup({
      set: {
        ...SEPARATE,
        bpm: 64,
        layers: {
          explore: { cue: 'music-t-explore', loop: false, bpm: 64, beatsPerBar: 6 },
          combat: { cue: 'music-t-combat', loop: true, bpm: 128, beatsPerBar: 6 },
        },
      },
    });
    await t.loaded();
    const anchor = t.sourceFor(0).startedAt ?? 0;
    await t.runTo(0.5);
    t.alert(t.creature, 'combat');
    await t.runTo(0.6);
    const combatBar = (6 * 60) / 128;
    expect((t.sourceFor(1).startedAt ?? 0) - anchor).toBeCloseTo(combatBar, 6);
    const out = ramps(musicGains(t.ctx)[0] ?? failParam());
    expect((out.at(-1)?.time ?? 0) - (t.sourceFor(1).startedAt ?? 0)).toBeCloseTo(combatBar, 6);
  });

  it('reads the tempo from a track sidecar over the set default', async () => {
    const t = setup({
      sidecar: (url) =>
        url.includes('music-t-combat')
          ? JSON.stringify({ bpm: 120, beatsPerBar: 4, loopStartSample: 0, loopEndSample: 96000 })
          : undefined,
    });
    await t.loaded();
    const anchor = t.sourceFor(0).startedAt ?? 0;
    t.alert(t.creature, 'combat');
    await t.runTo(0.2);
    // Min of the explore bar (90 BPM) and the combat bar (120 BPM, 2 s).
    expect((t.sourceFor(1).startedAt ?? 0) - anchor).toBeCloseTo(2, 6);
    expect(t.sourceFor(1).loopEnd).toBeCloseTo(2, 6);
  });

  it('with only explore and combat stems, tension and stealth alerts fall back to the layers it has', async () => {
    const t = setup();
    await t.loaded();
    t.alert(t.creature, 'investigating');
    await t.runTo(2);
    t.alert(t.other, 'suspicious');
    await t.runTo(4);
    expect(t.music.state.layer).toBe('explore');
    expect(t.music.state.wanted).toBe('tension');
    expect(t.ctx.sources).toHaveLength(1);
  });

  it('a track with stems plays them together in sync: drift stays within 10 ms after five minutes', async () => {
    const t = setup({ set: STEMS });
    await t.loaded();
    expect(t.ctx.sources.filter((s) => s.startedAt !== undefined)).toHaveLength(4);
    t.alert(t.creature, 'investigating');
    await t.runTo(100);
    t.alert(t.creature, 'combat');
    await t.runTo(200);
    t.alert(t.creature, 'unaware');
    await t.runTo(300 + 1);
    const started = t.ctx.sources.filter((s) => s.startedAt !== undefined);
    expect(started).toHaveLength(4);
    const starts = started.map((s) => s.startedAt ?? 0);
    expect((Math.max(...starts) - Math.min(...starts)) * 1000).toBeLessThanOrEqual(10);
    // Every stem shares one loop region and starts at the buffer's top: no stem was ever restarted.
    expect(new Set(started.map((s) => `${String(s.loopStart)}-${String(s.loopEnd)}`)).size).toBe(1);
    expect(started.every((s) => s.startOffset === 0 && s.stoppedAt === undefined)).toBe(true);
  });

  it('stems stack: stealth, tension and combat crossfade between one another and relax in order', async () => {
    const t = setup({ set: STEMS });
    await t.loaded();
    expect(t.music.state.layer).toBe('explore');
    t.alert(t.creature, 'suspicious');
    await t.runTo(3);
    expect(t.music.state.layer).toBe('stealth');
    t.alert(t.creature, 'investigating');
    await t.runTo(6);
    expect(t.music.state.layer).toBe('tension');
    t.alert(t.creature, 'unaware');
    await t.runTo(6 + 5.8);
    expect(t.music.state.layer).toBe('tension');
    await t.runTo(6 + 6.2);
    expect(t.music.state.layer).toBe('explore');
    t.alert(t.other, 'alerted');
    await t.runTo(20);
    expect(t.music.state.layer).toBe('tension');
  });

  it('waits for every stem to load before starting a set of stems, and skips a failed one', async () => {
    const t = setup({ set: STEMS, fail: (url) => url.includes('music-t-stealth') });
    await t.loaded();
    expect(t.warn).toHaveBeenCalledTimes(1);
    expect(t.ctx.sources.filter((s) => s.startedAt !== undefined)).toHaveLength(3);
    t.alert(t.creature, 'suspicious');
    await t.runTo(3);
    expect(t.music.state.layer).toBe('explore');
  });

  it('AC-4: a track that fails to load stays silent, logs once and leaves sfx alone', async () => {
    const t = setup({ fail: (url) => url.includes('music-t-') });
    await t.loaded();
    t.alert(t.creature, 'combat');
    await t.runTo(5);
    t.alert(t.creature, 'unaware');
    await t.runTo(20);
    expect(t.ctx.sources).toHaveLength(0);
    expect(t.warn).toHaveBeenCalledTimes(1);
    expect(t.warn.mock.calls[0]?.[0]).toContain('music-t-');
    expect(t.music.state.started).toBe(false);
    const click = t.engine.play('sfx-t-click');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    t.engine.update();
    expect(click?.state).toBe('playing');
    expect(t.ctx.playing).toHaveLength(1);
  });

  it('plays the explore track to its end, then silence between fights, and a fight fades in from silence', async () => {
    const t = setup();
    await t.loaded();
    t.sourceFor(0).end();
    await t.runTo(2);
    expect(t.music.state.layer).toBeUndefined();
    t.alert(t.creature, 'combat');
    await t.runTo(3);
    expect(t.music.state.layer).toBe('combat');
    const combat = t.sourceFor(1);
    expect((combat.startedAt ?? 0) - 2).toBeLessThan(0.2);
    const fadeIn = ramps(musicGains(t.ctx)[0] ?? failParam());
    expect(fadeIn.at(-1)?.time).toBeCloseTo((combat.startedAt ?? 0) + BAR_90, 6);
    t.alert(t.creature, 'unaware');
    await t.runTo(14);
    expect(t.music.state.layer).toBeUndefined();
    expect(combat.stoppedAt).toBeDefined();
  });

  it('stealth relaxes at once, a change of mind before the bar line cancels the pending crossfade, and ended voices are forgotten', async () => {
    const t = setup({ set: STEMS });
    await t.loaded();
    await t.runTo(0.5);
    t.alert(t.creature, 'suspicious');
    await t.runTo(0.6);
    expect(t.music.state.layer).toBe('stealth');
    t.alert(t.creature, 'unaware');
    await t.runTo(0.7);
    expect(t.music.state.layer).toBe('explore');
    const stealthGain = musicGains(t.ctx)[1] ?? failParam();
    const exploreGain = musicGains(t.ctx)[0] ?? failParam();
    // Back to explore before the bar line: the stealth stem never rises and explore never leaves.
    expect(stealthGain.events.filter((e) => e.type === 'ramp').at(-1)?.value).toBeCloseTo(0, 9);
    expect(exploreGain.events.filter((e) => e.type === 'ramp').at(-1)?.value).toBeCloseTo(1, 9);
    // A voice that ended, or one already replaced, is forgotten without ending the layer.
    t.ctx.sources.filter((s) => s.startedAt !== undefined)[3]?.end();
    t.alert(t.creature, 'combat');
    await t.runTo(6);
    expect(t.music.state.layer).toBe('combat');
  });

  it('a fight breaking out mid-way through a relaxing crossfade turns it round from where it is', async () => {
    const t = setup({ set: STEMS });
    await t.loaded();
    t.alert(t.creature, 'investigating');
    await t.runTo(3);
    t.alert(t.creature, 'unaware');
    await t.runTo(9.3);
    expect(t.music.state.layer).toBe('explore');
    const tension = musicGains(t.ctx)[2] ?? failParam();
    // The relaxing crossfade starts on a bar line and runs two bars; fight half a bar into it.
    const fadeStart =
      (ramps(tension)[DEFAULT_TUNING.fadeSteps]?.time ?? 0) -
      (2 * BAR_90) / DEFAULT_TUNING.fadeSteps;
    await t.runTo(fadeStart + BAR_90 / 2);
    t.alert(t.creature, 'combat');
    await t.runTo(fadeStart + 12);
    expect(t.music.state.layer).toBe('combat');
    const resumed = tension.events.filter((e) => e.type === 'set').at(-1);
    expect(resumed?.value).toBeGreaterThan(0);
    expect(resumed?.value).toBeLessThan(1);
    const [out, into] = [tension, musicGains(t.ctx)[3] ?? failParam()].map((p) =>
      ramps(p).slice(-16),
    );
    expect(out?.at(-1)?.value).toBeCloseTo(0, 9);
    expect(into?.at(-1)?.value).toBeCloseTo(1, 9);
  });

  it('a set whose stems all fail to load never starts, with one log', async () => {
    const t = setup({ set: STEMS, fail: (url) => url.includes('music-t-') });
    await t.loaded();
    await t.runTo(5);
    expect(t.music.state.started).toBe(false);
    expect(t.warn).toHaveBeenCalledTimes(1);
  });

  it('forgets a superseded combat voice when it ends late', async () => {
    const t = setup();
    await t.loaded();
    t.alert(t.creature, 'combat');
    await t.runTo(3);
    t.alert(t.creature, 'unaware');
    await t.runTo(25);
    t.alert(t.creature, 'combat');
    await t.runTo(30);
    const loops = t.ctx.sources.filter((s) => s.startedAt !== undefined && s.loop);
    loops[0]?.end();
    loops[1]?.end();
    expect(t.music.state.layer).toBe('combat');
  });

  it('a creature that dies stops counting as in combat', async () => {
    const t = setup();
    await t.loaded();
    t.alert(t.creature, 'combat');
    await t.runTo(4);
    t.world.events.emit(Died, {
      tick: 0,
      target: t.creature,
      killer: null,
      source: null,
      tags: [],
    });
    t.world.step();
    await t.runTo(13);
    expect(t.music.state.layer).toBe('explore');
  });

  it('stingers play on the next beat of the music that is playing, once per beat', async () => {
    const t = setup();
    await t.loaded();
    await t.runTo(1.0);
    const anchor = t.sourceFor(0).startedAt ?? 0;
    const beat = 60 / 90;
    const event: MusicStinger = {
      type: 'MusicStinger',
      entity: t.creature,
      state: 'combat',
      from: 'unaware',
      tick: 1,
    };
    for (const listener of t.listeners) listener(event);
    for (const listener of t.listeners) listener({ ...event, entity: t.other });
    await t.runTo(1.1);
    const stinger = t.ctx.sources.filter((s) => s.startedAt !== undefined && !s.loop).at(-1);
    expect(t.ctx.sources.filter((s) => s.startedAt !== undefined)).toHaveLength(2);
    const beats = ((stinger?.startedAt ?? 0) - anchor) / beat;
    expect(beats).toBeCloseTo(Math.round(beats), 6);
    expect((stinger?.startedAt ?? 0) - 1.0).toBeLessThanOrEqual(beat);
    // A state with no stinger in the set, or before the stinger loads, plays nothing.
    for (const listener of t.listeners) listener({ ...event, state: 'suspicious' });
    expect(t.ctx.sources.filter((s) => s.startedAt !== undefined)).toHaveLength(2);
  });

  it('a stinger with nothing playing starts straight away and one that failed to load is skipped', async () => {
    const t = setup({ fail: (url) => url.includes('music-t-') });
    await t.loaded();
    const event: MusicStinger = {
      type: 'MusicStinger',
      entity: t.creature,
      state: 'combat',
      from: 'unaware',
      tick: 1,
    };
    t.ctx.currentTime = 4;
    for (const listener of t.listeners) listener(event);
    expect(t.sourceFor(0).startedAt).toBeCloseTo(4.05, 6);
    const failing = setup({ fail: (url) => url.includes('stinger-t-') });
    await failing.loaded();
    for (const listener of failing.listeners) listener(event);
    expect(failing.ctx.sources).toHaveLength(1);
  });

  it('a stinger before the context runs is dropped', () => {
    const t = setup({ state: 'suspended' });
    for (const listener of t.listeners) {
      listener({
        type: 'MusicStinger',
        entity: t.creature,
        state: 'combat',
        from: 'unaware',
        tick: 0,
      });
    }
    expect(t.ctx.sources).toHaveLength(0);
  });

  it('dispose fades the music out and stops listening', async () => {
    const t = setup();
    await t.loaded();
    t.music.dispose();
    expect(t.sourceFor(0).stoppedAt).toBeCloseTo(t.ctx.currentTime + 1, 6);
    expect(t.listeners.size).toBe(0);
    t.alert(t.creature, 'combat');
    expect(t.music.state.started).toBe(false);
  });

  it('dispose before the context exists is harmless', () => {
    const t = setup({ state: 'suspended' });
    t.music.dispose();
    expect(t.music.state.started).toBe(false);
  });

  it('a manifest cue the engine will not start is dropped from the set', async () => {
    const world = registerWorldProperties(new World({ seed: 1 }));
    const track: MusicTrack = { buffer: new FakeBuffer(1, 10, 48_000) };
    const engine: AdaptiveMusicEngine = {
      context: { state: 'running', currentTime: 0 },
      loadTrack: () => Promise.resolve(track),
      startTrack: (): MusicVoice | null => null,
    };
    const warn = vi.fn();
    const music = new AdaptiveMusic({ world, engine, set: SEPARATE, warn });
    music.update();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    music.update();
    expect(music.state.started).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('defaults to console.warn and the shared tuning', async () => {
    const world = registerWorldProperties(new World({ seed: 1 }));
    const engine: AdaptiveMusicEngine = {
      context: { state: 'running', currentTime: 0 },
      loadTrack: () => Promise.reject(new Error('nope')),
      startTrack: () => null,
    };
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const music = new AdaptiveMusic({ world, engine, set: SEPARATE });
    music.update();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('music sets', () => {
  it('the slice plays the explore and combat tracks as separate tracks on bar lines', () => {
    const set = musicSetFor('slice');
    expect(set?.lockstep).toBe(false);
    expect(Object.keys(set?.layers ?? {})).toEqual(['explore', 'combat']);
    expect(set?.layers.combat?.bpm).toBe(128);
    expect(musicSetFor('nowhere')).toBeUndefined();
  });

  it('the combat exit delay is the bead 8 s (data, tunable) and tension 6 s', () => {
    expect(DEFAULT_TUNING.combatExitDelayS).toBe(8);
    expect(DEFAULT_TUNING.tensionExitDelayS).toBe(6);
  });
});
