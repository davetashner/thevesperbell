// The Forgotten miner's models (mw-2l9, mw-1ja): the four Tripo image-to-3D skeletons of
// creature-forgotten-miner-base-01 and the mining pick, each loaded once and shared by every miner
// wearing it (which look a miner wears: variant.ts). Creatures face +z (see index.ts), the
// mesh arrives facing +x, so the body is turned −90° about y and stood on the ground. The model is
// a static mesh; miner-rig.ts skins it onto the humanoid animation rig so it walks and swings.
// The pick is a separate prop held in the right hand (the creature's −x side). The brute, archer and
// shield-bearer (forgotten-kit.ts, mw-ju8.35) swap the pick for a maul, a bow or a shield and the brute
// for a bigger skeleton.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright creature e2e (e2e/creatures.spec.ts).

import { Vector3 } from 'three';
import {
  placeGeometry,
  readGlbMesh,
  turnAndGround,
  type GlbModel,
  type Placement,
} from '../models/glb';
import {
  BRUTE_BODY_URL,
  bowPlacement,
  forgottenKit,
  maulPlacement,
  pickPlacement,
  PROP_URLS,
  shieldPlacement,
  type ForgottenKit,
} from './forgotten-kit';
import { leftHandPoint, rightHandPoint } from './variant';

/**
 * The miner's four looks, in order (public/assets/model): 01 is flat variant b (the first modelled),
 * 02 to 04 are variants a, c and d of creature-forgotten-miner-base-01.
 */
export const FORGOTTEN_MINER_URLS = [
  '/assets/model/model-creature-forgotten-miner-01.glb',
  '/assets/model/model-creature-forgotten-miner-02.glb',
  '/assets/model/model-creature-forgotten-miner-03.glb',
  '/assets/model/model-creature-forgotten-miner-04.glb',
] as const;

/** Where a Forgotten's right hand is when its model has none to find, in its own space. */
const DEFAULT_HAND = new Vector3(-0.42, 0.83, 0);

/** The body (required), what it holds in its right hand and what it carries on the left (optional). */
export interface ForgottenAssets {
  readonly body: GlbModel;
  /** The right-hand weapon: the miner's pick or the brute's maul. */
  readonly pick: GlbModel | undefined;
  /** The left-hand gear: the archer's bow or the shield-bearer's shield. */
  readonly offhand: GlbModel | undefined;
}

const loading = new Map<string, Promise<ForgottenAssets>>();
const rawProps = new Map<string, Promise<GlbModel | undefined>>();

/** A prop as it comes from its file, read once and copied for each look. */
function loadRawProp(url: string): Promise<GlbModel | undefined> {
  let pending = rawProps.get(url);
  if (pending === undefined) {
    pending = readGlbMesh(url).catch((error: unknown) => {
      console.warn(`${url} did not load; leaving it off.`, error);
      return undefined;
    });
    rawProps.set(url, pending);
  }
  return pending;
}

/** A copy of the raw prop at `url`, placed by `placement`, or undefined if it did not load. */
async function placed(url: string, placement: Placement): Promise<GlbModel | undefined> {
  const raw = await loadRawProp(url);
  if (raw === undefined) return undefined;
  const copy = { geometry: raw.geometry.clone(), material: raw.material };
  placeGeometry(copy.geometry, placement, url);
  return copy;
}

/**
 * Loads the model of Forgotten `id` (absent or unknown: the miner) once; every Forgotten wearing it
 * shares the result. `variant` (0 to 3) picks one of the miner's four skeletons (the brute has one).
 * Each look gets its own copy of its gear, set in that skeleton's own hands. Rejects when the body
 * cannot load (gear that fails is left off), and the next call then tries again.
 */
export function loadForgottenMiner(variant = 0, id?: string): Promise<ForgottenAssets> {
  const kit = forgottenKit(id);
  const index = Math.min(Math.max(Math.trunc(variant), 0), FORGOTTEN_MINER_URLS.length - 1);
  const key = `${kit.body}:${String(kit.body === 'brute' ? 0 : index)}:${kit.right ?? ''}:${kit.left ?? ''}`;
  const cached = loading.get(key);
  if (cached !== undefined) return cached;
  const pending = loadKit(kit, index).catch((error: unknown) => {
    loading.delete(key);
    throw error;
  });
  loading.set(key, pending);
  return pending;
}

async function loadKit(kit: ForgottenKit, index: number): Promise<ForgottenAssets> {
  const url =
    kit.body === 'brute'
      ? BRUTE_BODY_URL
      : (FORGOTTEN_MINER_URLS[index] ?? FORGOTTEN_MINER_URLS[0]);
  const body = await readGlbMesh(url);
  // −90° about y: the mesh's +x (front) becomes +z, the creature's forward.
  turnAndGround(body.geometry, -90);
  body.geometry.computeBoundingBox();
  const height = body.geometry.boundingBox?.max.y ?? 1.8;
  const positions = body.geometry.getAttribute('position').array;
  const right = rightHandPoint(positions, height) ?? DEFAULT_HAND;
  const left = leftHandPoint(positions, height) ?? DEFAULT_HAND.clone().setX(-DEFAULT_HAND.x);
  const [pick, offhand] = await Promise.all([
    kit.right === undefined
      ? undefined
      : placed(
          PROP_URLS[kit.right],
          kit.right === 'maul' ? maulPlacement(right) : pickPlacement(right),
        ),
    kit.left === undefined
      ? undefined
      : placed(
          PROP_URLS[kit.left],
          kit.left === 'bow' ? bowPlacement(left) : shieldPlacement(left),
        ),
  ]);
  return { body, pick, offhand };
}
