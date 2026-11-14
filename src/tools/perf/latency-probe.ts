// Input-to-motion latency and controller cost probe (mw-e02.8). "Responsive" is a number: the time
// from a move key's keydown event to the end of the first frame in which the player's drawn
// transform has changed, and the CPU cost of one controller tick and one camera placement.
//
// Dev only. The dev server has it, and vite.config.ts defines `__LATENCY_PROBE__` true for builds made
// with VESPER_LATENCY_PROBE=on (the perf suite's build), false for every other build, where
// src/main.ts's `if (__LATENCY_PROBE__)` is dead code and this module is not in the bundle
// (tests/toolchain/latency-probe-stripped.test.ts scans a production build for PROBE_GLOBAL). Even
// then it only runs on a page with `?latency`. The probe publishes nothing per frame: the perf specs
// (e2e/perf/latency.perf.ts) read `window.mwLatencyProbe.report()`.
//
// What it measures, honestly: from the keydown event reaching the page to the end of the frame
// callback that submits the changed frame. The browser's own input queue before the event and the
// compositor and display scan-out after the frame (about one more refresh interval) are outside it.

import { percentiles, type Percentiles } from './percentiles';

/** The window property the probe publishes its report on; the production-bundle scan looks for it. */
export const PROBE_GLOBAL = 'mwLatencyProbe';

/** KeyboardEvent.code values of the default move bindings (src/game/input/bindings.ts). */
export const MOVE_KEY_CODES: ReadonlySet<string> = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowLeft',
  'ArrowDown',
  'ArrowRight',
]);

/** Metres the drawn position must change between two frames to count as motion. */
export const MOTION_EPSILON = 1e-4;

export interface LatencyReport {
  /** Input-to-motion latency of each measured key press, ms, in order. */
  readonly latency: Percentiles & { readonly samples: readonly number[] };
  /** Key presses not measured because the player was still moving when the key went down. */
  readonly discarded: number;
  /** Wall time of each controller system run (one per sim tick), ms. */
  readonly controller: Percentiles;
  /** Wall time of each camera placement (one per drawn frame), ms. */
  readonly camera: Percentiles;
}

export class LatencyProbe {
  #pending: number | undefined;
  #moving = false;
  #previous: readonly [number, number, number] | undefined;
  #discarded = 0;
  readonly #latency: number[] = [];
  readonly #controller: number[] = [];
  readonly #camera: number[] = [];

  /** A move key went down at `timeMs`. Ignored (and counted) while the player is still moving. */
  keyDown(timeMs: number): void {
    if (this.#moving) {
      this.#discarded += 1;
      return;
    }
    this.#pending = timeMs;
  }

  /** A frame was submitted at `timeMs` with the player drawn at (x, y, z). */
  frame(timeMs: number, x: number, y: number, z: number): void {
    const before = this.#previous;
    this.#previous = [x, y, z];
    this.#moving =
      before !== undefined &&
      Math.max(Math.abs(x - before[0]), Math.abs(y - before[1]), Math.abs(z - before[2])) >
        MOTION_EPSILON;
    if (this.#moving && this.#pending !== undefined) {
      this.#latency.push(timeMs - this.#pending);
      this.#pending = undefined;
    }
  }

  /** One controller system run took `ms`. */
  controllerTick(ms: number): void {
    this.#controller.push(ms);
  }

  /** One camera placement took `ms`. */
  cameraFrame(ms: number): void {
    this.#camera.push(ms);
  }

  /** Forgets the cost samples (after a warm-up); latency samples stay. */
  resetCosts(): void {
    this.#controller.length = 0;
    this.#camera.length = 0;
  }

  report(): LatencyReport {
    return {
      latency: { ...percentiles(this.#latency), samples: [...this.#latency] },
      discarded: this.#discarded,
      controller: percentiles(this.#controller),
      camera: percentiles(this.#camera),
    };
  }
}

/** The part of `window` the probe needs. */
export interface LatencyHost {
  addEventListener(type: 'keydown', listener: (event: Event) => void, capture: boolean): void;
}

interface KeyLike {
  readonly code: string;
  readonly repeat: boolean;
  readonly timeStamp: number;
}

/**
 * Starts a probe on `host`: every move key's keydown (capture phase, so nothing can swallow it)
 * arms it, and `host[PROBE_GLOBAL]` gets `report()` and `resetCosts()` for the perf specs.
 */
export function installLatencyProbe(host: LatencyHost & Record<string, unknown>): LatencyProbe {
  const probe = new LatencyProbe();
  host.addEventListener(
    'keydown',
    (event) => {
      const { code, repeat, timeStamp } = event as unknown as KeyLike;
      if (!repeat && MOVE_KEY_CODES.has(code)) probe.keyDown(timeStamp);
    },
    true,
  );
  host[PROBE_GLOBAL] = {
    report: () => probe.report(),
    resetCosts: () => {
      probe.resetCosts();
    },
  };
  return probe;
}
