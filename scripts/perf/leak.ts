// Leak detector for repeated area swaps (mw-e32.12). Pure arithmetic over samples the e2e spec
// (e2e/leak.spec.ts) takes after each cycle; kept apart so a test can feed it a leaking fixture and
// prove it fails (AC-3).

/** Heap growth allowed from the early cycles to the last ones (AC-1: 5%). */
export const HEAP_GROWTH_LIMIT = 0.05;
/** GPU resources (geometries or textures) allowed over the baseline cycle (AC-2: ±2). */
export const GPU_COUNT_TOLERANCE = 2;

export interface LeakVerdict {
  ok: boolean;
  /** One line for the failure message. */
  detail: string;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const high = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? high : (high + (sorted[mid - 1] ?? 0)) / 2;
}

/** Cycles that warm the page up (shader compiles, JIT code, lazy chunks) before the heap settles. */
export const HEAP_WARMUP_CYCLES = 4;

/**
 * Heap growth after warm-up. Measured with heap snapshots (mw-e32.12), the heap still grows about
 * 10% between cycle 2 and cycle 8 and the growth is V8 compiled code and DevTools resource records,
 * not objects: from cycle 8 to cycle 20 the snapshot gains under 1 MB of code and no object count
 * moves. So the start is the median of the three cycles after `HEAP_WARMUP_CYCLES`, and the end the
 * median of the last three (cycle 20 is the final sample). Medians because a single post-GC sample
 * moves by a percent or two with the machine's load. A real leak grows every cycle: the one this
 * check found (a listener on #app keeping each area's world alive) grew 4.6 MB a cycle, 120% over
 * 20 cycles, and a leak of 0.2 MB a cycle already clears 5%.
 */
export function heapGrowth(
  heapBytes: readonly number[],
  limit: number = HEAP_GROWTH_LIMIT,
): LeakVerdict {
  if (heapBytes.length < HEAP_WARMUP_CYCLES + 6) {
    throw new Error(`heapGrowth needs at least ${String(HEAP_WARMUP_CYCLES + 6)} cycles`);
  }
  const start = median(heapBytes.slice(HEAP_WARMUP_CYCLES, HEAP_WARMUP_CYCLES + 3));
  const end = median(heapBytes.slice(-3));
  const growth = (end - start) / start;
  return {
    ok: growth <= limit,
    detail: `heap ${(start / 1e6).toFixed(2)} MB -> ${(end / 1e6).toFixed(2)} MB (${(growth * 100).toFixed(1)}%, limit ${(limit * 100).toFixed(0)}%)`,
  };
}

/**
 * A GPU resource count (geometries or textures) after each cycle stays at its steady state within
 * `tolerance`. The renderer uploads a mesh or texture the first time a frame draws it, and the
 * area's props near the arrival point are drawn a few frames after the swap, so a count read at
 * "ready" can sit 3 geometries and 5 textures under the settled one (a slow runner reads the settled
 * value, a fast one the early one: mw-e06.12 saw 44 -> 47 on main's own code). The spec therefore
 * waits for each sample to settle, and the first cycles are warm-up (the page's first swaps still
 * carry load-time content, 55 geometries against the settled 47). Like the heap check, the start is
 * the median of the three cycles after `HEAP_WARMUP_CYCLES` and the end the median of the last
 * three. A leak grows every cycle, so it clears the tolerance whatever the warm-up.
 */
export function countsReturn(
  name: string,
  counts: readonly number[],
  tolerance: number = GPU_COUNT_TOLERANCE,
): LeakVerdict {
  if (counts.length < HEAP_WARMUP_CYCLES + 6) {
    throw new Error(`countsReturn needs at least ${String(HEAP_WARMUP_CYCLES + 6)} cycles`);
  }
  const baseline = median(counts.slice(HEAP_WARMUP_CYCLES, HEAP_WARMUP_CYCLES + 3));
  const last = median(counts.slice(-3));
  return {
    ok: Math.abs(last - baseline) <= tolerance,
    detail: `${name} ${String(baseline)} -> ${String(last)} (tolerance ±${String(tolerance)})`,
  };
}
