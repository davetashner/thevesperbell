// Browser wiring for the audio engine (mw-e28.1): the real AudioContext, fetch, wall clock and
// format probe, plus the first-gesture unlock the autoplay policy requires. Kept thin; it is unit
// tested with stubbed globals and exercised for real by e2e/audio.spec.ts in Chromium, Firefox and
// WebKit.
import { AudioEngine, type AudioEngineOptions } from './engine.ts';
import type { Visibility } from './mixer.ts';
import { pickFormat, registryAssetUrl, type AudioFormat } from './manifest.ts';

/** Where runtime audio lives (audio bible §6: `public/assets/audio/<category>/<asset-id>.<ext>`). */
export const AUDIO_BASE_URL = '/assets/audio';

/** Events that count as a user gesture for autoplay unlocking. */
export const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

export type BrowserAudioOptions = Pick<
  AudioEngineOptions,
  'registry' | 'entityPosition' | 'quality' | 'dev' | 'warn' | 'cacheBytes'
> & {
  /**
   * Override URL resolution (testbeds serving generated audio); default is the §6 layout, with
   * placeholder assets served as the pack's WAVs.
   */
  readonly resolveUrl?: AudioEngineOptions['resolveUrl'];
};

/** Probes the browser for Opus-in-Ogg support (audio bible §5.2). */
export function browserFormat(): AudioFormat {
  const probe = document.createElement('audio');
  return pickFormat((mime) => probe.canPlayType(mime));
}

/** Fetches bytes, failing on non-2xx responses so a 404 marks the cue failed. */
export async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} for ${url}`);
  return response.arrayBuffer();
}

/** An engine wired to the page's Web Audio. The context is created on first use, not here. */
export function createBrowserAudioEngine(options: BrowserAudioOptions): AudioEngine {
  const format = browserFormat();
  return new AudioEngine({
    ...options,
    createContext: () => new AudioContext({ latencyHint: 'interactive' }),
    fetchBytes,
    resolveUrl: options.resolveUrl ?? registryAssetUrl(options.registry, AUDIO_BASE_URL),
    format,
    now: () => performance.now(),
  });
}

/**
 * Unlocks audio on the first user gesture on `target` (usually `document`). Listeners are removed
 * once the context is running. Returns a function that removes them early.
 */
export function installGestureUnlock(
  target: EventTarget,
  engine: Pick<AudioEngine, 'unlock' | 'context'>,
): () => void {
  // Removal via an AbortSignal: simpler than matching capture flags on removeEventListener.
  const listening = new AbortController();
  const remove = (): void => {
    listening.abort();
  };
  const onGesture = (): void => {
    engine.unlock().then(
      () => {
        if (engine.context?.state === 'running') remove();
      },
      // A refused resume leaves the listeners in place for the next gesture.
      () => undefined,
    );
  };
  for (const type of GESTURE_EVENTS) {
    target.addEventListener(type, onGesture, { capture: true, signal: listening.signal });
  }
  return remove;
}

/** The page's visibility for the mixer's mute-when-hidden (mw-e28.5). */
export function documentVisibility(
  doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>,
): Visibility {
  return {
    hidden: () => doc.visibilityState === 'hidden',
    subscribe(listener) {
      doc.addEventListener('visibilitychange', listener);
      return () => {
        doc.removeEventListener('visibilitychange', listener);
      };
    },
  };
}
