// Which of the Forgotten miner's four looks a miner wears (mw-e37.402 family, see forgotten-model.ts).
// The choice is visual only, so it lives here and never touches the sim: a random salt is drawn once
// per game session and each miner hashes it with its entity id, so one game's miners can differ from
// each other, a new game looks different, and the same session always draws the same miner the same
// way. `?miner=N` pins a variant (tests, screenshots). The renderer has no Math.random (the project
// bans it), so the salt comes from the browser's crypto source.

import { Vector3 } from 'three';

/** How many looks the miner has. */
export const MINER_VARIANTS = 4;

/** murmur3's 32-bit finalizer: a bijective avalanche mix. */
function mix(value: number): number {
  let x = value >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85eb_ca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2_ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** A variant in [0, count) for `key` under `salt`: stable for the pair, spread evenly over keys. */
export function pickVariant(salt: number, key: number, count: number = MINER_VARIANTS): number {
  return mix((salt >>> 0) ^ Math.imul(mix(key), 0x9e37_79b9)) % count;
}

/** A fresh 32-bit salt from the browser's crypto source (one per game session). */
export function randomSalt(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

/**
 * The variant `?miner=N` pins (1 to count, so `?miner=1` is the first look), or undefined when the query
 * has none or it is not a whole number in range.
 */
export function variantFromSearch(
  search: string,
  count: number = MINER_VARIANTS,
): number | undefined {
  const raw = new URLSearchParams(search).get('miner');
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return n >= 1 && n <= count ? n - 1 : undefined;
}

/**
 * Where a miner's right hand is, in its own space (feet at the origin, facing +z, so its right is −x):
 * the mean of the vertices within `reach` of the most outstretched one on that side, between 35% and
 * 58% of `height` (below the elbow, above the knee). `positions` are x, y, z triples. The point is
 * moved `inset` toward the body so a held haft passes through the palm. Undefined for an empty band.
 */
export function rightHandPoint(
  positions: ArrayLike<number>,
  height: number,
  { reach = 0.08, inset = 0.04 }: { reach?: number; inset?: number } = {},
): Vector3 | undefined {
  const low = 0.35 * height;
  const high = 0.58 * height;
  let outermost = Infinity;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const y = positions[i + 1] ?? 0;
    const x = positions[i] ?? 0;
    if (y >= low && y <= high && x < 0 && x < outermost) outermost = x;
  }
  if (outermost === Infinity) return undefined;
  const sum = new Vector3();
  let count = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    if (y >= low && y <= high && x < 0 && x <= outermost + reach) {
      sum.add(new Vector3(x, y, positions[i + 2] ?? 0));
      count++;
    }
  }
  return sum.divideScalar(count).add(new Vector3(inset, 0, 0));
}

/**
 * Where a miner's left hand is, in its own space: `rightHandPoint` on the mirror image of the mesh
 * (x → −x), mirrored back, so it is the mean of the outermost left-side vertices in the same band.
 */
export function leftHandPoint(
  positions: ArrayLike<number>,
  height: number,
  options?: { reach?: number; inset?: number },
): Vector3 | undefined {
  const mirrored = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i++)
    mirrored[i] = i % 3 === 0 ? -(positions[i] ?? 0) : (positions[i] ?? 0);
  const hand = rightHandPoint(mirrored, height, options);
  return hand === undefined ? undefined : new Vector3(-hand.x, hand.y, hand.z);
}
