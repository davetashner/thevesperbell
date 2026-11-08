// Decoded-buffer cache (mw-e28.1): decoding is expensive and decoded PCM is large (48 kHz stereo
// float32 ≈ 384 KB/s), so buffers are kept in a least-recently-used cache capped by decoded bytes
// (64 MB by default) and concurrent requests for the same asset share one fetch + decode.
import type { AudioBufferLike } from './web-audio.ts';

/** Default decoded-audio cap (bead mw-e28.1). */
export const DEFAULT_CACHE_BYTES = 64 * 1024 * 1024;

/** A decoded asset plus its loop region in seconds and its tempo, when its sidecar provided them. */
export interface LoadedSound {
  readonly buffer: AudioBufferLike;
  readonly loop?: { readonly start: number; readonly end: number };
  /** Tempo from the sidecar (audio bible §5.3), for the music clock. */
  readonly timing?: { readonly bpm: number; readonly beatsPerBar: number };
}

export type AssetStatus = 'absent' | 'loading' | 'ready' | 'failed';

/** Decoded size of a buffer: float32 samples × channels. */
export function decodedBytes(buffer: AudioBufferLike): number {
  return buffer.length * buffer.numberOfChannels * 4;
}

/** LRU cache of decoded sounds keyed by asset id. */
export class BufferCache {
  readonly #capBytes: number;
  readonly #load: (assetId: string) => Promise<LoadedSound>;
  /** Map iteration order is the LRU order: oldest first. */
  readonly #ready = new Map<string, LoadedSound>();
  readonly #loading = new Map<string, Promise<LoadedSound>>();
  readonly #failed = new Set<string>();
  #bytes = 0;

  constructor(capBytes: number, load: (assetId: string) => Promise<LoadedSound>) {
    this.#capBytes = capBytes;
    this.#load = load;
  }

  /** Decoded bytes currently held. */
  get bytes(): number {
    return this.#bytes;
  }

  status(assetId: string): AssetStatus {
    if (this.#ready.has(assetId)) return 'ready';
    if (this.#loading.has(assetId)) return 'loading';
    return this.#failed.has(assetId) ? 'failed' : 'absent';
  }

  /** The decoded sound if cached, marking it most recently used. */
  get(assetId: string): LoadedSound | undefined {
    const sound = this.#ready.get(assetId);
    if (sound) {
      this.#ready.delete(assetId);
      this.#ready.set(assetId, sound);
    }
    return sound;
  }

  /**
   * Loads (or joins the in-flight load of) an asset. A failure marks the asset failed and is not
   * retried; the returned promise rejects.
   */
  request(assetId: string): Promise<LoadedSound> {
    const cached = this.get(assetId);
    if (cached) return Promise.resolve(cached);
    const inflight = this.#loading.get(assetId);
    if (inflight) return inflight;
    if (this.#failed.has(assetId)) {
      return Promise.reject(new Error(`audio asset "${assetId}" failed to load`));
    }
    const promise = this.#load(assetId).then(
      (sound) => {
        this.#loading.delete(assetId);
        this.#insert(assetId, sound);
        return sound;
      },
      (error: unknown) => {
        this.#loading.delete(assetId);
        this.#failed.add(assetId);
        throw error;
      },
    );
    this.#loading.set(assetId, promise);
    return promise;
  }

  #insert(assetId: string, sound: LoadedSound): void {
    const size = decodedBytes(sound.buffer);
    // Bigger than the whole cache: play it, but don't flush everything else to hold it.
    if (size > this.#capBytes) return;
    this.#ready.set(assetId, sound);
    this.#bytes += size;
    for (const [id, old] of this.#ready) {
      if (this.#bytes <= this.#capBytes) break;
      this.#ready.delete(id);
      this.#bytes -= decodedBytes(old.buffer);
    }
  }
}
