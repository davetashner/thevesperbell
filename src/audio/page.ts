// The page-level half of the audio engine (mw-ju8.47): one AudioContext, one decoded-buffer cache
// and the set of loop assets live as long as the page, like the GL surface (mw-ju8.44). Each area
// session builds an AudioEngine on it and, on dispose, takes down only its own bus graph, voices
// and music; the context keeps running and decoded samples stay cached, so an in-place area swap
// neither restarts audio, re-decodes a sample nor loses the autoplay unlock.
import { BufferCache, DEFAULT_CACHE_BYTES, type LoadedSound } from './buffer-cache.ts';
import type { AudioContextLike } from './web-audio.ts';

export interface AudioPageOptions {
  /** Creates the context; called once, on first use. */
  readonly createContext: () => AudioContextLike;
  readonly cacheBytes?: number | undefined;
}

export class AudioPage {
  readonly #createContext: () => AudioContextLike;
  readonly #cacheBytes: number;
  #ctx: AudioContextLike | undefined;
  #cache: BufferCache | undefined;
  #loader: ((ctx: AudioContextLike, assetId: string) => Promise<LoadedSound>) | undefined;
  /** Assets used by looping cues (their loads also fetch the sidecar), shared by every session. */
  readonly loopAssets = new Set<string>();

  constructor(options: AudioPageOptions) {
    this.#createContext = options.createContext;
    this.#cacheBytes = options.cacheBytes ?? DEFAULT_CACHE_BYTES;
  }

  /** The context, if created yet. */
  get context(): AudioContextLike | undefined {
    return this.#ctx;
  }

  /** The page's context and cache, created on first use. */
  runtime(): { readonly ctx: AudioContextLike; readonly cache: BufferCache } {
    this.#ctx ??= this.#createContext();
    const ctx = this.#ctx;
    this.#cache ??= new BufferCache(this.#cacheBytes, (id) => {
      if (!this.#loader) return Promise.reject(new Error('no audio engine attached'));
      return this.#loader(ctx, id);
    });
    return { ctx, cache: this.#cache };
  }

  /** Points loads at the newest session's fetch/decode (its URLs and format). */
  attach(loader: (ctx: AudioContextLike, assetId: string) => Promise<LoadedSound>): void {
    this.#loader = loader;
  }
}
