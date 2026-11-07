// The throw arc preview (mw-e02.17): the line a charged throw would fly, drawn while the carrier holds
// the throw button. A UI hint only: the sim computes the points (`CarryController.preview`), this
// draws them.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage.

import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial } from 'three';
import type { Vec3 } from '@sim/index';

/** Most points the line draws (the sim's arc is at most this long). */
const MAX_POINTS = 64;

/** A line object to add to the scene, and the call that points it at an arc (or hides it). */
export interface ThrowArc {
  readonly object: Line;
  update(points: readonly Vec3[] | undefined): void;
  dispose(): void;
}

export function createThrowArc(): ThrowArc {
  const positions = new Float32Array(MAX_POINTS * 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({ color: 0xf0e6c8, transparent: true, opacity: 0.8 });
  const object = new Line(geometry, material);
  object.name = 'throw-arc';
  object.frustumCulled = false;
  object.visible = false;
  return {
    object,
    update(points) {
      object.visible = points !== undefined && points.length > 1;
      if (points === undefined) return;
      const count = Math.min(points.length, MAX_POINTS);
      points.slice(0, count).forEach((p, i) => {
        positions.set([p.x, p.y, p.z], i * 3);
      });
      geometry.setDrawRange(0, count);
      (geometry.attributes['position'] as BufferAttribute).needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
