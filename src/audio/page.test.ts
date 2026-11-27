import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from './engine.ts';
import { FakeAudioContext, type FakeNode } from './fake-context.ts';
import { SoundRegistry } from './manifest.ts';
import { AudioPage } from './page.ts';

const REGISTRY = new SoundRegistry().register([
  { id: 'sfx-ui-click', variants: ['sfx-ui-click-01'], bus: 'ui' },
  { id: 'sfx-torch-loop', variants: ['sfx-torch-loop-01'], bus: 'sfx', spatial: true, loop: true },
  { id: 'mus-bed', variants: ['mus-bed-01'], bus: 'music', loop: true },
]);

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  const ctx = new FakeAudioContext();
  const createContext = vi.fn(() => ctx);
  const page = new AudioPage({ createContext });
  const fetched: string[] = [];
  const session = () =>
    new AudioEngine({
      registry: REGISTRY,
      createContext,
      page,
      fetchBytes: (url) => {
        fetched.push(url);
        return url.endsWith('.json')
          ? Promise.reject(new Error('404'))
          : Promise.resolve(new ArrayBuffer(1));
      },
      resolveUrl: (id, ext) => `/a/${id}.${ext}`,
      format: 'ogg',
      now: () => 1000,
      warn: () => undefined,
    });
  return { ctx, createContext, page, fetched, session };
}

/** Nodes of the context still wired to something other than a node that was disconnected. */
function liveNodes(ctx: FakeAudioContext): FakeNode[] {
  return [...ctx.gains, ...ctx.panners, ...ctx.compressors, ...ctx.biquads, ...ctx.sources].filter(
    (node) => !node.disconnected,
  );
}

describe('AudioPage across area sessions (mw-ju8.47)', () => {
  it('AC-1: two sessions share one context, which is never closed, and leave no live nodes', async () => {
    const { ctx, createContext, session } = setup();
    for (let i = 0; i < 3; i++) {
      const engine = session();
      await engine.unlock();
      engine.play('sfx-ui-click');
      engine.play('sfx-torch-loop', { position: { x: 1, y: 0, z: 0 } });
      const track = await engine.loadTrack('mus-bed');
      engine.startTrack('mus-bed', track, { loop: true });
      await settle();
      expect(engine.stats().voices).toBe(2);
      expect(engine.context).toBe(ctx);
      engine.dispose();
      expect(engine.stats().voices).toBe(0);
      // Everything this session made is disconnected; only the (unconnected) context remains.
      expect(liveNodes(ctx)).toEqual([]);
    }
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(ctx.closeCalls).toBe(0);
    expect(ctx.state).toBe('running');
  });

  it('AC-1: node count grows only by what each session builds, not by what earlier ones left', async () => {
    const { ctx, session } = setup();
    const first = session();
    await first.unlock();
    first.dispose();
    const perSession = ctx.gains.length;
    for (let i = 0; i < 4; i++) {
      const engine = session();
      await engine.unlock();
      engine.dispose();
    }
    expect(ctx.gains.length).toBe(perSession * 5);
    expect(liveNodes(ctx)).toEqual([]);
  });

  it('AC-1: a disposed session ignores late loads, plays and gestures', async () => {
    const { session } = setup();
    const engine = session();
    engine.play('sfx-ui-click');
    engine.dispose();
    await settle();
    expect(engine.play('sfx-ui-click')).toBeNull();
    expect(engine.startTrack('mus-bed', { buffer: { duration: 1 } as never })).toBeNull();
    await expect(engine.loadTrack('mus-bed')).rejects.toThrow();
    await engine.unlock();
    expect(engine.stats().voices).toBe(0);
  });

  it('AC-2: a second session serves an already-decoded sample without refetching it', async () => {
    const { fetched, session } = setup();
    const first = session();
    first.play('sfx-ui-click');
    await settle();
    first.dispose();
    const before = fetched.length;
    expect(before).toBeGreaterThan(0);
    const second = session();
    second.play('sfx-ui-click');
    await settle();
    expect(fetched.length).toBe(before);
    expect(second.stats().cachedBytes).toBeGreaterThan(0);
    expect(second.stats().voices).toBe(1);
  });

  it('an engine without a page keeps its own context and closes it on dispose', async () => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine({
      registry: REGISTRY,
      createContext: () => ctx,
      fetchBytes: () => Promise.resolve(new ArrayBuffer(1)),
      resolveUrl: (id, ext) => `/a/${id}.${ext}`,
      format: 'ogg',
      now: () => 0,
    });
    await engine.unlock();
    engine.dispose();
    expect(ctx.closeCalls).toBe(1);
  });

  it('a load with no engine attached rejects', async () => {
    const page = new AudioPage({ createContext: () => new FakeAudioContext(), cacheBytes: 10 });
    expect(page.context).toBeUndefined();
    await expect(page.runtime().cache.request('x')).rejects.toThrow(/no audio engine/);
    expect(page.context).toBeDefined();
  });

  it('disposing before the context exists, and a failed load after dispose, are harmless', async () => {
    const { createContext, session } = setup();
    session().dispose();
    expect(createContext).not.toHaveBeenCalled();
    const failing = new AudioEngine({
      registry: REGISTRY,
      createContext: () => new FakeAudioContext(),
      fetchBytes: () => Promise.reject(new Error('404')),
      resolveUrl: (id, ext) => `/a/${id}.${ext}`,
      format: 'ogg',
      now: () => 0,
      warn: () => undefined,
    });
    failing.play('sfx-ui-click');
    failing.dispose();
    await settle();
    expect(failing.stats().voices).toBe(0);
  });
});
