// Dressing models (render only): approved 3D models drawn over the grey box, such as the Gilded Tern's
// hull over the blocking mass that stands for it (content sceneDressingSchema). Each is turned in its
// own frame (`turn`), then by the scene yaw, fitted into its `size` box (stretched on every axis, or
// scaled evenly to its height) and stood on its base point. Loaded once per model and fit; a model that
// never loads leaves the grey box as it was, since only parts it would hide are skipped, and those are
// skipped only once it has loaded.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage; what it hides is
// unit tested in src/render/greybox/dressing-hides.test.ts and the drawing by the harbour e2e spec.
//
// A dressing marked `fadesNearCamera` (rigging) turns see-through while the camera is inside its bounds:
// the camera's collision sweep only knows physics colliders, and rigging has none, so a camera backed
// into a mast's shrouds would otherwise fill the screen with them.

import { Box3, Matrix4, Mesh } from 'three';
import type { SceneDressing } from '@sim/index';
import { readGlbMesh } from '../models/glb';
import { MODEL_STRIPS, stripTriangles } from './model-strips';

const turnMatrix = (degrees: number): Matrix4 =>
  new Matrix4().makeRotationY((degrees * Math.PI) / 180);

/** A mesh of dressing `d`, fitted and placed in world space. */
export async function loadDressing(d: SceneDressing): Promise<Mesh> {
  const url = `/assets/model/${d.model}.glb`;
  const model = await readGlbMesh(url);
  const strips = MODEL_STRIPS[d.model];
  const geometry = strips === undefined ? model.geometry : stripTriangles(model.geometry, strips);
  const material = model.material;
  geometry.applyMatrix4(turnMatrix(d.turn + d.yaw));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box === null) throw new Error(`${url} has no extent`);
  const w = box.max.x - box.min.x;
  const h = box.max.y - box.min.y;
  const l = box.max.z - box.min.z;
  if (w <= 0 || h <= 0 || l <= 0) throw new Error(`${url} has no extent`);
  const even = d.size.y / h;
  const [sx, sy, sz] =
    d.fit === 'height' ? [even, even, even] : [d.size.x / w, d.size.y / h, d.size.z / l];
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  geometry.scale(sx, sy, sz);
  geometry.translate(d.at.x, d.at.y, d.at.z);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, material);
  mesh.name = `dressing:${d.id}`;
  if (d.fadesNearCamera) fadeNearCamera(mesh);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** How see-through a fading dressing gets while the camera is inside it (1 = solid). */
export const NEAR_CAMERA_OPACITY = 0.25;
/** Opacity change per drawn frame, so the fade takes about a fifth of a second. */
const FADE_STEP = 0.08;

/** Makes `mesh` fade while the camera is inside its bounds (padded by half a metre). */
export function fadeNearCamera(mesh: Mesh): void {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (material === undefined) return;
  material.transparent = true;
  material.needsUpdate = true;
  mesh.geometry.computeBoundingBox();
  const bounds = (mesh.geometry.boundingBox ?? new Box3()).clone().expandByScalar(0.5);
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    const target = bounds.containsPoint(camera.position) ? NEAR_CAMERA_OPACITY : 1;
    const step = Math.sign(target - material.opacity) * FADE_STEP;
    material.opacity =
      Math.abs(target - material.opacity) <= FADE_STEP ? target : material.opacity + step;
    material.depthWrite = material.opacity >= 1;
  };
}
