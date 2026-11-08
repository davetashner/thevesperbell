import { describe, expect, it } from 'vitest';
import { dbToGain, LOWPASS_OPEN_HZ, type MixBusId } from './buses.ts';
import { AudioEngine } from './engine.ts';
import { FakeAudioContext } from './fake-context.ts';
import { MixController, type MixEngine } from './mix.ts';
import { DUCK_ATTACK_MS, DUCKS, SNAPSHOTS, SNAPSHOT_NAMES } from './mix-snapshots.ts';
import { SoundRegistry } from './manifest.ts';

interface Call {
  readonly kind: 'snapshot' | 'duck';
  readonly bus: MixBusId;
  readonly gain: number;
  readonly hz?: number | null;
  readonly ramp: number | undefined;
}

function setup() {
  const calls: Call[] = [];
  const engine: MixEngine = {
    setSnapshot: (bus, gain, hz, ramp) => calls.push({ kind: 'snapshot', bus, gain, hz, ramp }),
    setDuck: (bus, gain, ramp) => calls.push({ kind: 'duck', bus, gain, ramp }),
  };
  const mix = new MixController(engine);
  calls.length = 0;
  return { mix, calls };
}

describe('snapshot data', () => {
  it('ramps every transition within 250–1500 ms', () => {
    for (const name of SNAPSHOT_NAMES) {
      expect(SNAPSHOTS[name].rampMs).toBeGreaterThanOrEqual(250);
      expect(SNAPSHOTS[name].rampMs).toBeLessThanOrEqual(1500);
    }
  });
});

describe('mix snapshots', () => {
  it('starts in explore with every bus neutral and open', () => {
    const calls: Call[] = [];
    const mix = new MixController({
      setSnapshot: (bus, gain, hz, ramp) => calls.push({ kind: 'snapshot', bus, gain, hz, ramp }),
      setDuck: () => undefined,
    });
    expect(mix.snapshot).toBe('explore');
    expect(calls.map((c) => [c.bus, c.gain, c.hz, c.ramp])).toEqual([
      ['music', 1, null, 0],
      ['sfx', 1, null, 0],
      ['ambience', 1, null, 0],
      ['ui', 1, null, 0],
    ]);
  });

  it('AC-1: explore to combat ramps bus gains to the combat values over the configured duration', () => {
    const { mix, calls } = setup();
    mix.setSnapshot('combat');
    expect(mix.snapshot).toBe('combat');
    const combat = SNAPSHOTS.combat;
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.gain).toBeCloseTo(dbToGain(combat.buses[call.bus]?.gainDb ?? 0));
      expect(call.ramp).toBeCloseTo(combat.rampMs / 1000);
    }
    expect(calls.find((c) => c.bus === 'ambience')?.gain).toBeLessThan(1);
    expect(calls.find((c) => c.bus === 'sfx')?.gain).toBeGreaterThan(1);
  });

  it('does nothing when the snapshot is already current', () => {
    const { mix, calls } = setup();
    mix.setSnapshot('explore');
    expect(calls).toEqual([]);
  });

  it('paused low-passes sfx and ambience at 800 Hz and explore opens them again', () => {
    const { mix, calls } = setup();
    mix.setSnapshot('paused');
    const cutoff = (bus: string) => calls.find((c) => c.bus === bus)?.hz;
    expect([cutoff('sfx'), cutoff('ambience'), cutoff('ui')]).toEqual([800, 800, null]);
    calls.length = 0;
    mix.setSnapshot('explore');
    expect(calls.every((c) => c.hz === null)).toBe(true);
  });
});

describe('mix ducks', () => {
  it('AC-2: a parry ducks music and ambience −6 dB for 400 ms, then restores with a 200 ms ramp', () => {
    const { mix, calls } = setup();
    mix.duck('parry', 1000);
    expect(calls.map((c) => [c.bus, c.gain, c.ramp])).toEqual([
      ['music', dbToGain(-6), DUCK_ATTACK_MS / 1000],
      ['ambience', dbToGain(-6), DUCK_ATTACK_MS / 1000],
    ]);
    expect(dbToGain(-6)).toBeCloseTo(0.5012, 3);
    calls.length = 0;
    mix.update(1399);
    expect(calls).toEqual([]);
    mix.update(1400);
    expect(calls.map((c) => [c.bus, c.gain, c.ramp])).toEqual([
      ['music', 1, 0.2],
      ['ambience', 1, 0.2],
    ]);
    expect(DUCKS.parry.holdMs).toBe(400);
    expect(DUCKS.parry.releaseMs).toBe(200);
  });

  it('AC-4: overlapping ducks take the deepest attenuation, not the sum', () => {
    const { mix, calls } = setup();
    mix.duck('parry', 0); // music/ambience −6
    mix.duck('critical', 100); // the same depth: nothing deeper, so nothing new is sent
    expect(calls.filter((c) => c.bus === 'music')).toHaveLength(1);
    expect(mix.duckDb('music')).toBe(-6);
    mix.duck('ui-stinger', 200); // sfx only
    expect(mix.duckDb('sfx')).toBe(-4);
    expect(mix.duckDb('music')).toBe(-6);
    expect(calls.at(-1)).toMatchObject({ bus: 'sfx', gain: dbToGain(-4) });
  });

  it('a shallower duck over a deeper one changes nothing, and the deeper one outlasting keeps the bus ducked', () => {
    const { mix, calls } = setup();
    mix.duck('parry', 0); // −6 until 400
    mix.duck('critical', 300); // −6 until 700
    calls.length = 0;
    mix.update(400); // parry expires, critical still holds the same depth
    expect(calls).toEqual([]);
    mix.update(700);
    expect(calls.map((c) => c.gain)).toEqual([1, 1]);
  });

  it('restores to the remaining duck depth when the deepest expires', () => {
    const { mix, calls } = setup();
    // A deep duck shorter than a shallow one, via the data table's own depth (−6 vs sfx −4 do not
    // overlap), so use the same bus twice with different holds: parry (−6, 400) then ui is separate.
    mix.duck('ui-stinger', 0); // sfx −4 until 600
    mix.duck('parry', 100);
    calls.length = 0;
    mix.update(500); // parry over; ui-stinger still holds sfx
    expect(calls.map((c) => c.bus)).toEqual(['music', 'ambience']);
    expect(mix.duckDb('sfx')).toBe(-4);
    mix.update(600);
    expect(calls.at(-1)).toMatchObject({ bus: 'sfx', gain: 1 });
  });
});

describe('mix stages on the real engine (AC-3 integration)', () => {
  function engineSetup() {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine({
      registry: new SoundRegistry(),
      createContext: () => ctx,
      fetchBytes: () => Promise.resolve(new ArrayBuffer(1)),
      resolveUrl: (id) => id,
      format: 'ogg',
      now: () => 0,
    });
    return { ctx, engine };
  }
  const cutoffs = (ctx: FakeAudioContext) => ctx.biquads.map((f) => f.frequency.value);

  it('AC-3: pausing low-passes sfx and ambience at 800 Hz and resuming restores them', async () => {
    const { ctx, engine } = engineSetup();
    const mix = new MixController(engine);
    await engine.unlock();
    expect(cutoffs(ctx)).toEqual(Array(4).fill(LOWPASS_OPEN_HZ));
    mix.setSnapshot('paused');
    // Build order is music, sfx, ambience, ui.
    expect(cutoffs(ctx)).toEqual([LOWPASS_OPEN_HZ, 800, 800, LOWPASS_OPEN_HZ]);
    mix.setSnapshot('explore');
    expect(cutoffs(ctx)).toEqual(Array(4).fill(LOWPASS_OPEN_HZ));
  });

  it('holds snapshot and duck set before the context exists, and applies them with it', async () => {
    const { ctx, engine } = engineSetup();
    const mix = new MixController(engine);
    mix.setSnapshot('paused');
    mix.duck('parry', 0);
    await engine.unlock();
    expect(cutoffs(ctx)).toEqual([LOWPASS_OPEN_HZ, 800, 800, LOWPASS_OPEN_HZ]);
    const [musicSnap] = ctx.gains.filter((g) => g.gain.value === dbToGain(-6));
    expect(musicSnap).toBeDefined();
  });

  it('layers over the player volume: the bus gain is never written by snapshots or ducks', async () => {
    const { ctx, engine } = engineSetup();
    const mix = new MixController(engine);
    await engine.unlock();
    engine.setBusGain('music', 0.4);
    mix.setSnapshot('combat');
    mix.duck('parry', 0);
    expect(engine.context).toBe(ctx);
    const bus = ctx.gains.find((g) => g.gain.value === 0.4);
    expect(bus).toBeDefined();
    expect(bus?.gain.events.filter((e) => e.type === 'ramp')).toEqual([]);
  });
});

describe('expired ducks', () => {
  it('a new duck first releases ducks that ran out, so they do not count', () => {
    const { mix, calls } = setup();
    mix.duck('ui-stinger', 0); // sfx −4 until 600
    calls.length = 0;
    mix.duck('parry', 1000); // the stinger is long over: sfx is released, music/ambience duck
    expect(calls.map((c) => [c.bus, c.gain])).toEqual([
      ['sfx', 1],
      ['music', dbToGain(-6)],
      ['ambience', dbToGain(-6)],
    ]);
    expect(mix.duckDb('sfx')).toBe(0);
  });
});
