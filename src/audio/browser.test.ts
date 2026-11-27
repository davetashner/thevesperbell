import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIO_BASE_URL,
  browserFormat,
  createBrowserAudioEngine,
  createBrowserAudioPage,
  fetchBytes,
  GESTURE_EVENTS,
  installGestureUnlock,
} from './browser.ts';
import { FakeAudioContext } from './fake-context.ts';
import { OPUS_MIME, SoundRegistry } from './manifest.ts';

/** Stubs the browser globals browser.ts reads, with a scriptable `canPlayType`. */
function stubBrowser(canPlay: string) {
  const contexts: { ctx: FakeAudioContext; options: unknown }[] = [];
  vi.stubGlobal(
    'AudioContext',
    vi.fn(function (this: unknown, options: unknown) {
      const ctx = new FakeAudioContext({ state: 'suspended' });
      contexts.push({ ctx, options });
      return ctx;
    }),
  );
  const probes: string[] = [];
  vi.stubGlobal('document', {
    createElement: (tag: string) => ({
      tag,
      canPlayType: (mime: string) => (probes.push(mime), canPlay),
    }),
  });
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      return Promise.resolve(new Response(new Uint8Array([1, 2]), { status: 200 }));
    }),
  );
  return { contexts, probes, urls };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const registry = () =>
  new SoundRegistry().register([{ id: 'sfx-ui-click', variants: ['sfx-ui-click-01'], bus: 'ui' }]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser wiring', () => {
  it('probes Opus support with an <audio> element', () => {
    const { probes } = stubBrowser('probably');
    expect(browserFormat()).toBe('ogg');
    expect(probes).toEqual([OPUS_MIME]);
    stubBrowser('');
    expect(browserFormat()).toBe('m4a');
  });

  it('fetchBytes returns the body and rejects HTTP errors', async () => {
    stubBrowser('');
    expect((await fetchBytes('/x.ogg')).byteLength).toBe(2);
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 404 })));
    await expect(fetchBytes('/missing.ogg')).rejects.toThrow('HTTP 404 for /missing.ogg');
  });

  it('builds an engine on the real globals: lazy interactive context, §6 URLs, chosen format', async () => {
    const { contexts, urls } = stubBrowser('');
    const engine = createBrowserAudioEngine({ registry: registry() });
    expect(contexts).toHaveLength(0);
    const handle = engine.play('sfx-ui-click');
    expect(contexts[0]?.options).toEqual({ latencyHint: 'interactive' });
    await settle();
    expect(urls).toEqual([`${AUDIO_BASE_URL}/sfx/sfx-ui-click-01.m4a`]);
    await engine.unlock();
    expect(handle?.state).toBe('playing');
  });

  it('mw-ju8.47: a page-level context is created lazily and shared by engines built on it', () => {
    const { contexts } = stubBrowser('');
    const page = createBrowserAudioPage(1024);
    expect(contexts).toHaveLength(0);
    const first = createBrowserAudioEngine({ registry: registry(), page });
    const second = createBrowserAudioEngine({ registry: registry(), page });
    first.play('sfx-ui-click');
    second.play('sfx-ui-click');
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.options).toEqual({ latencyHint: 'interactive' });
    expect(page.context).toBe(contexts[0]?.ctx);
  });

  it('fetches placeholder assets as WAVs from the placeholder pack (mw-e28.2)', async () => {
    const { urls } = stubBrowser('probably');
    const engine = createBrowserAudioEngine({
      registry: new SoundRegistry().register([
        { id: 'sfx-ui-hover', variants: ['sfx-ui-hover-01'], bus: 'ui', placeholder: true },
      ]),
    });
    engine.preload(['sfx-ui-hover']);
    await settle();
    expect(urls).toEqual([`${AUDIO_BASE_URL}/sfx/sfx-ui-hover-01.wav`]);
  });

  it('accepts a custom URL resolver (testbeds with generated audio)', async () => {
    const { urls } = stubBrowser('probably');
    const engine = createBrowserAudioEngine({
      registry: registry(),
      resolveUrl: (id, ext) => `blob:${id}.${ext}`,
    });
    engine.preload(['sfx-ui-click']);
    await settle();
    expect(urls).toEqual(['blob:sfx-ui-click-01.ogg']);
  });
});

describe('installGestureUnlock', () => {
  it('unlocks on the first gesture and then removes its listeners', async () => {
    stubBrowser('');
    const engine = createBrowserAudioEngine({ registry: registry() });
    const target = new EventTarget();
    const unlock = vi.spyOn(engine, 'unlock');
    installGestureUnlock(target, engine);
    target.dispatchEvent(new Event('keydown'));
    await settle();
    expect(engine.context?.state).toBe('running');
    for (const type of GESTURE_EVENTS) target.dispatchEvent(new Event(type));
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it('keeps listening while the context is not running, and after a refused resume', async () => {
    const target = new EventTarget();
    let state: AudioContextState = 'suspended';
    const engine = {
      unlock: vi.fn(() =>
        state === 'closed' ? Promise.reject(new Error('no')) : Promise.resolve(),
      ),
      get context() {
        return { state } as FakeAudioContext;
      },
    };
    const remove = installGestureUnlock(target, engine);
    target.dispatchEvent(new Event('pointerdown'));
    state = 'closed';
    await settle();
    target.dispatchEvent(new Event('touchend'));
    await settle();
    expect(engine.unlock).toHaveBeenCalledTimes(2);
    remove();
    target.dispatchEvent(new Event('pointerdown'));
    expect(engine.unlock).toHaveBeenCalledTimes(2);
  });
});
