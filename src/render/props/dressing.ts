// Dressing models (render only): approved 3D models drawn over the grey box, such as the Gilded Tern's
// hull over the blocking mass that stands for it (content sceneDressingSchema). Each is turned in its
// own frame (`turn`), then by the scene yaw, fitted into its `size` box (stretched on every axis, or
// scaled evenly to its height) and stood on its base point. Loaded once per model and fit; a model that
// never loads leaves the grey box as it was, since only parts it would hide are skipped, and those are
// skipped only once it has loaded.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage; what it hides is
// unit tested in src/render/greybox/dressing-hides.test.ts and the drawing by the harbour e2e spec.

import { Matrix4, Mesh } from 'three';
import type { SceneDressing } from '@sim/index';
import { readGlbMesh } from '../models/glb';

const turnMatrix = (degrees: number): Matrix4 =>
  new Matrix4().makeRotationY((degrees * Math.PI) / 180);

/** A mesh of dressing `d`, fitted and placed in world space. */
export async function loadDressing(d: SceneDressing): Promise<Mesh> {
  const url = `/assets/model/${d.model}.glb`;
  const { geometry, material } = await readGlbMesh(url);
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
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
