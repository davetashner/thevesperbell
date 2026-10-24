// The Forgotten miner on the animation rig (mw-e37.402): the Tripo skeleton skinned onto the grey-box
// humanoid, the same rig the knight uses, so the shipped idle, walk, attack and hit clips pose it with
// no per-model skeleton. The miner's model space (forgotten-model.ts: feet at y = 0, facing +z, any
// height) is scaled to the rig's height and turned to face −z, the rig's forward; the pick is fixed to
// the rig's `sword` bone, which hangs from the right forearm, so it swings with the arm.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright creature e2e (e2e/creatures.spec.ts).

import { Matrix4, Vector3 } from 'three';
import type { Rig } from '../animation/index';
import type { KnightAssets } from '../player/knight-model';
import type { ForgottenAssets } from './forgotten-model';

/** The height the rig's bones are laid out for, metres (the knight's). */
export const RIG_HEIGHT = 1.8;

/** The rig bone the pick is fixed to. */
export const PICK_BONE = 'sword';

/** The rig bone the bow and the shield are fixed to (the left forearm). */
export const OFFHAND_BONE = 'forearm-l';

/** Where `bone` rests in rig space: its offsets summed up its parents. */
export function boneRest(rig: Rig, bone: string): Vector3 {
  const at = new Vector3();
  let i = rig.index.get(bone) ?? -1;
  while (i >= 0) {
    at.x += rig.offsets[i * 3] ?? 0;
    at.y += rig.offsets[i * 3 + 1] ?? 0;
    at.z += rig.offsets[i * 3 + 2] ?? 0;
    i = rig.parents[i] ?? -1;
  }
  return at;
}

/**
 * The miner's body and pick in rig space: scaled to RIG_HEIGHT and turned half a turn (+z to −z); the
 * pick is moved into the pick bone's own space. The sources are left untouched (looks share them).
 */
export function minerRigAssets(rig: Rig, assets: ForgottenAssets): KnightAssets {
  const body = assets.body.geometry.clone();
  body.computeBoundingBox();
  const scale = RIG_HEIGHT / (body.boundingBox?.max.y ?? RIG_HEIGHT);
  const toRig = new Matrix4()
    .makeRotationY(Math.PI)
    .multiply(new Matrix4().makeScale(scale, scale, scale));
  body.applyMatrix4(toRig);
  body.computeBoundingBox();
  body.computeBoundingSphere();
  const props: KnightAssets['props'][number][] = [];
  for (const [held, bone] of [
    [assets.pick, PICK_BONE],
    [assets.offhand, OFFHAND_BONE],
  ] as const) {
    if (held === undefined) continue;
    const geometry = held.geometry.clone();
    geometry.applyMatrix4(toRig);
    const rest = boneRest(rig, bone);
    geometry.translate(-rest.x, -rest.y, -rest.z);
    props.push({ geometry, material: held.material, bone });
  }
  return { body: { geometry: body, material: assets.body.material.clone() }, props };
}
