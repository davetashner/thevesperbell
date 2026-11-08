import { describe, expect, it, vi } from 'vitest';
import {
  AudioEngine,
  makeBeep,
  MAX_REQUEST_AGE_MS,
  STEAL_FADE_S,
  type PlayOptions,
} from './engine.ts';
import { FakeAudioContext, type FakeContextOptions, type FakeGain } from './fake-context.ts';
import { SoundRegistry, type SoundDefInput } from './manifest.ts';
import type { Vec3 } from './spatial.ts';
import type { AudioBufferLike } from './web-audio.ts';

const DEFS: SoundDefInput[] = [
  { id: 'sfx-ui-click', variants: ['sfx-ui-click-01'], bus: 'ui' },
  {
    id: 'sfx-foot-stone-walk',
    variants: ['sfx-foot-stone-walk-01', 'sfx-foot-stone-walk-02', 'sfx-foot-stone-walk-03'],
    bus: 'footsteps',
    spatial: true,
    priority: 40,
  },
  { id: 'sfx-knight-parry', variants: ['sfx-knight-parry-metal-01'], bus: 'combat', spatial: true },
  {
    id: 'sfx-creature-horn-bellow',
    variants: ['sfx-creature-horn-bellow-01'],
    bus: 'creatures',
    spatial: true,
    priority: 80,
    gainDb: -6,
  },
  { id: 'sfx-torch-loop', variants: ['sfx-torch-loop-01'], bus: 'sfx', spatial: true, loop: true },
  { id: 'amb-deepworks-drips', variants: ['amb-deepworks-drips-01'], bus: 'ambience', loop: true },
];

interface SetupOptions extends FakeContextOptions {
  readonly dev?: boolean;
  readonly quality?: 'high' | 'low';
  readonly fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  readonly entityPosition?: (entity: number) => Vec3 | undefined;
  readonly cacheBytes?: number;
}

function setup(options: SetupOptions = {}) {
  let now = 1000;
  const ctx = new FakeAudioContext(options);
  const createContext = vi.fn(() => ctx);
  const warn = vi.fn<(message: string) => void>();
  const fetched: string[] = [];
  const engine = new AudioEngine({
    registry: new SoundRegistry().register(DEFS),
    createContext,
    fetchBytes:
      options.fetchBytes ??
      ((url) => {
        fetched.push(url);
        return url.endsWith('.json')
          ? Promise.reject(new Error('404'))
          : Promise.resolve(new ArrayBuffer(1));
      }),
    resolveUrl: (id, ext) => `/a/${id}.${ext}`,
    format: 'ogg',
    now: () => now,
    warn,
    ...(options.dev === undefined ? {} : { dev: options.dev }),
    ...(options.quality ? { quality: options.quality } : {}),
    ...(options.entityPosition ? { entityPosition: options.entityPosition } : {}),
    ...(options.cacheBytes ? { cacheBytes: options.cacheBytes } : {}),
  });
  return {
    engine,
    ctx,
    createContext,
    warn,
    fetched,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** Lets every pending fetch/decode promise chain settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The gain node a source feeds. */
function gainOf(source: { outputs: unknown[] }): FakeGain {
  return source.outputs[0] as FakeGain;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('AudioEngine lifecycle', () => {
  it('creates the AudioContext lazily, on first use', () => {
    const { engine, createContext } = setup();
    expect(engine.context).toBeUndefined();
    expect(engine.stats()).toEqual({ state: 'uncreated', voices: 0, pending: 0, cachedBytes: 0 });
    engine.update();
    expect(createContext).not.toHaveBeenCalled();
    engine.play('sfx-ui-click');
    engine.play('sfx-ui-click');
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it('AC-1: queues requests while suspended; on resume plays those younger than 2 s and drops older ones', async () => {
    const { engine, ctx, advance } = setup({ state: 'suspended' });
    const old = engine.play('sfx-ui-click');
    advance(1500);
    const young = engine.play('sfx-ui-click');
    await settle(); // decoded, but the context is still suspended
    expect(old?.state).toBe('pending');
    expect(young?.state).toBe('pending');
    expect(ctx.sources).toHaveLength(0);
    expect(engine.stats().pending).toBe(2);

    advance(MAX_REQUEST_AGE_MS - 1000); // old: 2.5 s, young: 1 s
    await engine.unlock();

    expect(ctx.resumeCalls).toBe(1);
    expect(old?.state).toBe('stopped');
    expect(young?.state).toBe('playing');
    expect(ctx.playing).toHaveLength(1);
    expect(engine.stats()).toMatchObject({ state: 'running', voices: 1, pending: 0 });
  });

  it('does not resume a context that is already running', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    expect(ctx.resumeCalls).toBe(0);
    expect(engine.stats().state).toBe('running');
  });

  it('keeps looping cues queued past 2 s: they are state, not events', async () => {
    const { engine, advance } = setup({ state: 'suspended' });
    const bed = engine.play('amb-deepworks-drips');
    await settle();
    advance(10_000);
    await engine.unlock();
    expect(bed?.state).toBe('playing');
  });

  it('drops a one-shot whose buffer takes longer than 2 s to arrive', async () => {
    const slow = deferred<ArrayBuffer>();
    const { engine, ctx, advance } = setup({ fetchBytes: () => slow.promise });
    const handle = engine.play('sfx-ui-click');
    advance(MAX_REQUEST_AGE_MS + 1);
    slow.resolve(new ArrayBuffer(1));
    await settle();
    expect(handle?.state).toBe('stopped');
    expect(ctx.sources).toHaveLength(0);
  });

  it('starts queued sounds from update() once the context is running by other means', async () => {
    const { engine, ctx } = setup({ state: 'suspended' });
    const handle = engine.play('sfx-ui-click');
    await settle();
    ctx.state = 'running';
    engine.update();
    expect(handle?.state).toBe('playing');
  });

  it('preload fetches every variant once and later plays hit the cache', async () => {
    const { engine, fetched } = setup();
    engine.preload(['sfx-foot-stone-walk', 'sfx-ui-click']);
    await settle();
    expect(fetched).toEqual([
      '/a/sfx-foot-stone-walk-01.ogg',
      '/a/sfx-foot-stone-walk-02.ogg',
      '/a/sfx-foot-stone-walk-03.ogg',
      '/a/sfx-ui-click-01.ogg',
    ]);
    expect(engine.stats().cachedBytes).toBe(4 * 1000 * 4);
    engine.play('sfx-ui-click');
    await settle();
    expect(fetched).toHaveLength(4);
  });
});

describe('AudioEngine unknown and broken cues', () => {
  it('warns through console.warn by default', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new AudioEngine({
      registry: new SoundRegistry(),
      createContext: () => new FakeAudioContext(),
      fetchBytes: () => Promise.resolve(new ArrayBuffer(1)),
      resolveUrl: (id) => id,
      format: 'ogg',
      now: () => 0,
    });
    engine.play('sfx-nope');
    expect(spy).toHaveBeenCalledWith('audio: unknown cue id "sfx-nope"');
    spy.mockRestore();
  });

  it('AC-4: an unknown cue returns null, warns once per id and never throws', () => {
    const { engine, warn } = setup();
    expect(engine.play('sfx-nope')).toBeNull();
    expect(engine.play('sfx-nope')).toBeNull();
    engine.preload(['sfx-nope']);
    expect(engine.play('sfx-other')).toBeNull();
    expect(warn.mock.calls).toEqual([
      ['audio: unknown cue id "sfx-nope"'],
      ['audio: unknown cue id "sfx-other"'],
    ]);
    expect(engine.cueStatus('sfx-nope')).toBe('unknown');
  });

  it('AC-5: a corrupt file marks the id failed and production stays silent', async () => {
    const { engine, ctx, warn } = setup({
      dev: false,
      decode: () => {
        throw new Error('EncodingError');
      },
    });
    const handle = engine.play('sfx-ui-click');
    await settle();
    expect(engine.cueStatus('sfx-ui-click')).toBe('failed');
    expect(handle?.state).toBe('stopped');
    expect(ctx.sources).toHaveLength(0);
    expect(engine.play('sfx-ui-click')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/cue "sfx-ui-click" failed to load.*EncodingError/);
  });

  it('AC-5: dev builds substitute a placeholder beep for a failed cue', async () => {
    const { engine, ctx } = setup({
      dev: true,
      decode: () => {
        throw new Error('EncodingError');
      },
    });
    const first = engine.play('sfx-ui-click');
    await settle();
    const second = engine.play('sfx-ui-click');
    await settle();
    expect(engine.cueStatus('sfx-ui-click')).toBe('failed');
    expect(first?.state).toBe('playing');
    expect(second?.state).toBe('playing');
    const [a, b] = ctx.sources;
    expect(a?.buffer?.length).toBe(Math.round(0.12 * 48_000));
    expect(b?.buffer).toBe(a?.buffer); // one beep buffer, reused
  });

  it('treats a failed fetch like a corrupt file', async () => {
    const { engine } = setup({ fetchBytes: () => Promise.reject(new Error('HTTP 404')) });
    engine.preload(['sfx-ui-click']);
    await settle();
    expect(engine.cueStatus('sfx-ui-click')).toBe('failed');
    expect(engine.cueStatus('sfx-knight-parry')).toBe('ok');
  });

  it('makeBeep renders a short 880 Hz tone at the context rate', () => {
    const beep: AudioBufferLike = makeBeep(new FakeAudioContext({ sampleRate: 44_100 }));
    expect(beep.sampleRate).toBe(44_100);
    const peak = Math.max(...beep.getChannelData(0).map(Math.abs));
    expect(peak).toBeCloseTo(0.25, 2);
  });
});

describe('AudioEngine voices', () => {
  /** Fills the pool with `count` looping voices at the given distances from the origin. */
  async function fill(
    engine: AudioEngine,
    voices: readonly { cue: string; x: number }[],
  ): Promise<void> {
    for (const { cue, x } of voices) engine.play(cue, { position: { x, y: 0, z: 0 } });
    await settle();
  }

  it('AC-2: with 48 voices, a higher-priority request steals the lowest-priority, farthest voice', async () => {
    const { engine, ctx } = setup();
    const background = Array.from({ length: 45 }, (_, i) => ({
      cue: 'sfx-knight-parry',
      x: i % 30,
    }));
    // Three footsteps at priority 40 (the lowest): the one at 25 m is the farthest of them.
    await fill(engine, [
      ...background,
      { cue: 'sfx-foot-stone-walk', x: 5 },
      { cue: 'sfx-foot-stone-walk', x: 25 },
      { cue: 'sfx-foot-stone-walk', x: 10 },
    ]);
    expect(engine.stats().voices).toBe(48);
    const victim = ctx.sources[46];
    ctx.currentTime = 3;

    const bellow = engine.play('sfx-creature-horn-bellow', { position: { x: 39, y: 0, z: 0 } });
    await settle();

    expect(bellow?.state).toBe('playing');
    expect(engine.stats().voices).toBe(48);
    expect(victim?.stoppedAt).toBe(3 + STEAL_FADE_S);
    expect(ctx.sources.filter((s) => s.stoppedAt !== undefined)).toEqual([victim]);
  });

  it('AC-2: with 48 voices, a lower-priority request is rejected', async () => {
    const { engine, ctx } = setup();
    await fill(
      engine,
      Array.from({ length: 48 }, () => ({ cue: 'sfx-knight-parry', x: 30 })),
    );
    const step = engine.play('sfx-foot-stone-walk', { position: { x: 1, y: 0, z: 0 } });
    await settle();
    expect(step?.state).toBe('stopped');
    expect(ctx.sources).toHaveLength(48);
    expect(ctx.playing).toHaveLength(48);
  });

  it('a per-play priority overrides the cue’s, both for stealing and for being stolen', async () => {
    const { engine, ctx } = setup();
    // 47 parries at the default 50, one footstep raised to 90 by its caller (a cue sheet rule).
    await fill(
      engine,
      Array.from({ length: 47 }, () => ({ cue: 'sfx-knight-parry', x: 5 })),
    );
    engine.play('sfx-foot-stone-walk', { position: { x: 30, y: 0, z: 0 }, priority: 90 });
    await settle();
    expect(engine.stats().voices).toBe(48);
    // The raised footstep is the farthest voice but outranks the bellow (80), so a parry is stolen.
    const bellow = engine.play('sfx-creature-horn-bellow', {
      position: { x: 1, y: 0, z: 0 },
      priority: 80,
    });
    await settle();
    expect(bellow?.state).toBe('playing');
    expect(ctx.sources[47]?.stoppedAt).toBeUndefined();
    // Lowered below everything playing, even the closest request is rejected.
    const quiet = engine.play('sfx-foot-stone-walk', {
      position: { x: 0, y: 0, z: 0 },
      priority: 10,
    });
    await settle();
    expect(quiet?.state).toBe('stopped');
  });

  it('at equal priority a strictly closer request steals the farthest voice; a farther one is rejected', async () => {
    const { engine, ctx } = setup();
    await fill(engine, [
      ...Array.from({ length: 47 }, () => ({ cue: 'sfx-knight-parry', x: 10 })),
      { cue: 'sfx-knight-parry', x: 20 },
    ]);
    const far = engine.play('sfx-knight-parry', { position: { x: 30, y: 0, z: 0 } });
    await settle();
    expect(far?.state).toBe('stopped');
    const near = engine.play('sfx-knight-parry', { position: { x: 1, y: 0, z: 0 } });
    await settle();
    expect(near?.state).toBe('playing');
    expect(ctx.sources[47]?.stoppedAt).toBeDefined();
  });

  it('the Low tier caps voices at 24 and pans equal-power; High uses HRTF', async () => {
    const low = setup({ quality: 'low' });
    expect(low.engine.maxVoices).toBe(24);
    await fill(
      low.engine,
      Array.from({ length: 25 }, () => ({ cue: 'sfx-knight-parry', x: 1 })),
    );
    expect(low.engine.stats().voices).toBe(24);
    expect(low.ctx.panners[0]?.panningModel).toBe('equalpower');

    const high = setup();
    expect(high.engine.maxVoices).toBe(48);
    await fill(high.engine, [{ cue: 'sfx-knight-parry', x: 1 }]);
    expect(high.ctx.panners[0]).toMatchObject({
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 2,
      maxDistance: 40,
    });
  });

  it('frees the slot and disconnects the nodes when a sound ends', async () => {
    const { engine, ctx } = setup();
    const handle = engine.play('sfx-knight-parry', { position: { x: 1, y: 0, z: 0 } });
    await settle();
    const [source] = ctx.sources;
    source?.end();
    expect(handle?.state).toBe('stopped');
    expect(engine.stats().voices).toBe(0);
    expect(source?.disconnected).toBe(true);
    expect(ctx.panners[0]?.disconnected).toBe(true);

    engine.play('sfx-ui-click');
    await settle();
    const click = ctx.sources[1];
    const clickGain = click && gainOf(click);
    click?.end();
    expect(clickGain?.disconnected).toBe(true);
  });

  it('culls one-shots beyond 40 m but keeps loops (their source may come closer)', async () => {
    const { engine } = setup();
    const shot = engine.play('sfx-knight-parry', { position: { x: 41, y: 0, z: 0 } });
    const torch = engine.play('sfx-torch-loop', { position: { x: 41, y: 0, z: 0 } });
    await settle();
    expect(shot?.state).toBe('stopped');
    expect(torch?.state).toBe('playing');
  });
});

describe('AudioEngine routing and parameters', () => {
  it('routes 2D cues gain → bus and positional cues gain → panner → bus', async () => {
    const { engine, ctx } = setup();
    engine.play('sfx-ui-click', { volume: 0.5, pitch: 1.1 });
    engine.play('sfx-creature-horn-bellow', { position: { x: 3, y: 0, z: 4 } });
    // A positional cue given no position plays 2D.
    engine.play('sfx-knight-parry');
    await settle();
    const [click, bellow, parry] = ctx.sources;
    const [master, music, sfx, combat, footsteps, creatures, ambience, ui] = ctx.gains;
    // Mix buses reach their parent through the snapshot → duck → low-pass stage (mw-e28.9).
    const through = (node: { outputs: unknown[] } | undefined): unknown => {
      let at: { outputs: unknown[] } | undefined = node;
      for (let hops = 0; hops < 4; hops++) at = at?.outputs[0] as typeof at;
      return at;
    };
    expect(through(music)).toBe(master);
    expect(footsteps?.outputs).toEqual([sfx]);
    expect(through(ambience)).toBe(master);

    expect(click?.playbackRate.value).toBe(1.1);
    expect(click && gainOf(click).gain.value).toBe(0.5);
    expect(click && gainOf(click).outputs).toEqual([ui]);

    const panner = ctx.panners[0];
    expect(bellow && gainOf(bellow).gain.value).toBeCloseTo(0.501, 3); // −6 dB trim
    expect(bellow && gainOf(bellow).outputs).toEqual([panner]);
    expect(panner?.outputs).toEqual([creatures]);
    expect([panner?.positionX.value, panner?.positionY.value, panner?.positionZ.value]).toEqual([
      3, 0, 4,
    ]);

    expect(parry && gainOf(parry).outputs).toEqual([combat]);
    expect(ctx.panners).toHaveLength(1);
  });

  it('cycles variants round-robin, or plays an explicit (wrapped) variant', async () => {
    const { engine, fetched } = setup();
    const at: PlayOptions = { position: { x: 1, y: 0, z: 0 } };
    for (let i = 0; i < 4; i++) engine.play('sfx-foot-stone-walk', at);
    engine.play('sfx-foot-stone-walk', { ...at, variant: -1 });
    await settle();
    expect(fetched).toEqual([
      '/a/sfx-foot-stone-walk-01.ogg',
      '/a/sfx-foot-stone-walk-02.ogg',
      '/a/sfx-foot-stone-walk-03.ogg',
    ]);
  });

  it('applies loop points from the §5.3 sidecar, and loops the whole buffer without one', async () => {
    const sidecar = { bpm: 88, beatsPerBar: 6, loopStartSample: 4800, loopEndSample: 96_000 };
    const fetchBytes = (url: string): Promise<ArrayBuffer> => {
      if (url === '/a/amb-deepworks-drips-01.json') {
        return Promise.resolve(new TextEncoder().encode(JSON.stringify(sidecar)).buffer);
      }
      if (url.endsWith('.json')) return Promise.reject(new Error('404'));
      return Promise.resolve(new ArrayBuffer(1));
    };
    const { engine, ctx } = setup({ fetchBytes });
    engine.play('amb-deepworks-drips');
    engine.play('sfx-torch-loop', { position: { x: 1, y: 0, z: 0 } });
    await settle();
    const [bed, torch] = ctx.sources;
    expect(bed).toMatchObject({ loop: true, loopStart: 0.1, loopEnd: 2 });
    expect(torch).toMatchObject({ loop: true, loopStart: 0, loopEnd: 0 });
  });

  it('ignores an invalid sidecar with a warning', async () => {
    const { engine, ctx, warn } = setup({
      fetchBytes: (url) =>
        Promise.resolve(
          url.endsWith('.json') ? new TextEncoder().encode('{"bpm":0}').buffer : new ArrayBuffer(1),
        ),
    });
    engine.play('amb-deepworks-drips');
    await settle();
    expect(ctx.sources[0]).toMatchObject({ loop: true, loopEnd: 0 });
    expect(warn.mock.calls[0]?.[0]).toMatch(
      /invalid loop sidecar \/a\/amb-deepworks-drips-01\.json/,
    );
  });

  it('only fetches sidecars for looping cues', async () => {
    const { engine, fetched } = setup();
    engine.play('sfx-ui-click');
    engine.play('amb-deepworks-drips');
    await settle();
    expect(fetched).toEqual([
      '/a/sfx-ui-click-01.ogg',
      '/a/amb-deepworks-drips-01.ogg',
      '/a/amb-deepworks-drips-01.json',
    ]);
  });

  it('sets bus gains immediately or with a ramp', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    engine.setBusGain('music', 0.5);
    ctx.currentTime = 2;
    engine.setBusGain('sfx', 0.25, 0.05);
    const [, music, sfx] = ctx.gains;
    expect(music?.gain.value).toBe(0.5);
    expect(sfx?.gain.events).toEqual([
      { type: 'cancel', time: 2 },
      { type: 'set', value: 1, time: 2 },
      { type: 'ramp', value: 0.25, time: 2.05 },
    ]);
  });
});

describe('AudioEngine mixer state (mw-e28.5)', () => {
  it('holds bus gains, mono and night mode set before the context exists, then applies them on creation', () => {
    const { engine, ctx, createContext } = setup();
    engine.setBusGain('sfx', 0.25);
    engine.setMono(true);
    engine.setNightMode(true, 0.05);
    expect(createContext).not.toHaveBeenCalled();
    engine.play('sfx-ui-click');
    const [master, , sfx] = ctx.gains;
    expect(sfx?.gain.value).toBe(0.25);
    expect(master?.channelCount).toBe(1);
    expect(ctx.compressors[1]?.ratio.value).toBe(6);
  });

  it('switches mono and night mode live, with the compressor ramped', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    engine.setMono(true);
    engine.setMono(false);
    expect(ctx.gains[0]?.channelCount).toBe(2);
    engine.setNightMode(true, 0.05);
    expect(ctx.compressors[1]?.ratio.events).toContainEqual({ type: 'ramp', value: 6, time: 0.05 });
  });
});

describe('AudioEngine handles', () => {
  it('stop() silences at once; stop(fade) ramps to zero first; both are idempotent', async () => {
    const { engine, ctx } = setup();
    const a = engine.play('sfx-ui-click');
    const b = engine.play('sfx-ui-click');
    await settle();
    ctx.currentTime = 1;
    a?.stop();
    b?.stop(0.5);
    a?.stop();
    b?.stop(0.5);
    const [sa, sb] = ctx.sources;
    expect(sa?.stoppedAt).toBe(0);
    expect(sb?.stoppedAt).toBe(1.5);
    expect(sb && gainOf(sb).gain.events.at(-1)).toEqual({ type: 'ramp', value: 0, time: 1.5 });
    expect([a?.state, b?.state]).toEqual(['stopped', 'stopped']);
    expect(engine.stats().voices).toBe(0);
    sb?.end(); // the faded voice finishing later changes nothing
    expect(b?.state).toBe('stopped');
  });

  it('a handle stopped while pending never plays', async () => {
    const { engine, ctx } = setup({ state: 'suspended' });
    const handle = engine.play('sfx-ui-click');
    handle?.stop();
    await engine.unlock();
    expect(ctx.sources).toHaveLength(0);
    expect(engine.stats().pending).toBe(0);
  });

  it('fade() ramps a playing voice (with its trim) and sets the start volume of a pending one', async () => {
    const { engine, ctx } = setup({ state: 'suspended' });
    const pending = engine.play('sfx-ui-click');
    pending?.fade(0.3, 1);
    await engine.unlock();
    await settle();
    const [source] = ctx.sources;
    expect(source && gainOf(source).gain.value).toBe(0.3);

    const bellow = engine.play('sfx-creature-horn-bellow', { position: { x: 1, y: 0, z: 0 } });
    await settle();
    bellow?.fade(1, 0);
    const bellowGain = ctx.sources[1] && gainOf(ctx.sources[1]);
    expect(bellowGain?.gain.value).toBeCloseTo(0.501, 3);
    bellow?.stop();
    bellow?.fade(1, 1); // no effect once stopped
    expect(bellowGain?.gain.events).toEqual([{ type: 'cancel', time: 0 }]);
  });
});

describe('AudioEngine positional updates', () => {
  it('AC-3: a sound attached to a moving entity has its panner moved in the same frame', async () => {
    const positions = new Map<number, Vec3>([[7, { x: 1, y: 0, z: 0 }]]);
    const { engine, ctx } = setup({ entityPosition: (e) => positions.get(e) });
    engine.play('sfx-torch-loop', { entity: 7 });
    engine.play('sfx-ui-click'); // 2D voices are skipped by the per-frame update
    await settle();
    engine.play('sfx-knight-parry', { position: { x: 5, y: 0, z: 5 } });
    await settle();
    const [torch, fixed] = ctx.panners;
    expect(torch?.positionX.value).toBe(1);

    positions.set(7, { x: 4, y: 2, z: -3 });
    engine.update();
    expect([torch?.positionX.value, torch?.positionY.value, torch?.positionZ.value]).toEqual([
      4, 2, -3,
    ]);
    expect(fixed?.positionX.value).toBe(5);

    positions.delete(7); // entity despawned: the sound stays where it last was
    engine.update();
    expect(torch?.positionX.value).toBe(4);
  });

  it('moves the listener with the camera (AudioParams, or the setters on Firefox)', () => {
    const pose = {
      position: { x: 1, y: 2, z: 3 },
      forward: { x: 0, y: 0, z: 1 },
      up: { x: 0, y: 1, z: 0 },
    };
    const modern = setup();
    modern.engine.play('sfx-ui-click');
    modern.engine.update(pose);
    expect(modern.ctx.listener.positionZ?.value).toBe(3);
    expect(modern.ctx.listener.forwardZ?.value).toBe(1);

    const legacy = setup({ legacyListener: true });
    legacy.engine.play('sfx-ui-click');
    legacy.engine.update(pose);
    expect(legacy.ctx.listener.calls).toEqual([
      { method: 'setPosition', args: [1, 2, 3] },
      { method: 'setOrientation', args: [0, 0, 1, 0, 1, 0] },
    ]);
  });

  it('ranks voices by distance from the moved listener when stealing', async () => {
    const { engine, ctx } = setup();
    for (let i = 0; i < 48; i++) {
      engine.play('sfx-knight-parry', { position: { x: i === 0 ? 0 : 15, y: 0, z: 0 } });
    }
    await settle();
    // Listener walks from the origin to x = 15: the first voice is now the farthest (15 m) and the
    // new request (1 m) outranks it. Ranked from the origin it would have been rejected.
    engine.update({
      position: { x: 15, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
    });
    const near = engine.play('sfx-knight-parry', { position: { x: 16, y: 0, z: 0 } });
    await settle();
    expect(near?.state).toBe('playing');
    expect(ctx.sources[0]?.stoppedAt).toBeDefined();
  });

  it('starts an entity sound at the entity, else at the given position', async () => {
    const withLocator = setup({
      entityPosition: (e) => (e === 1 ? { x: 9, y: 0, z: 0 } : undefined),
    });
    withLocator.engine.play('sfx-knight-parry', { entity: 1, position: { x: 2, y: 0, z: 0 } });
    withLocator.engine.play('sfx-knight-parry', { entity: 2, position: { x: 3, y: 0, z: 0 } });
    await settle();
    expect(withLocator.ctx.panners.map((p) => p.positionX.value)).toEqual([9, 3]);

    const without = setup();
    without.engine.play('sfx-torch-loop', { entity: 1, position: { x: 2, y: 0, z: 0 } });
    await settle();
    without.engine.update();
    expect(without.ctx.panners[0]?.positionX.value).toBe(2);
  });
});
