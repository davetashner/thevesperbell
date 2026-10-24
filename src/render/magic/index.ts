// Placeholder spell visuals (mw-e06.15): a glowing sphere for a spell projectile and a ground marker
// for area spells. No paid assets; final spell art is the asset beads'. The projectile's real light
// comes from the sim's light field (the spell's `light` op), drawn by the light rig.
//
// Render-only (needs a GPU context): excluded from unit coverage, verified by e2e/spell-cast.spec.ts.

import {
  AdditiveBlending,
  Color,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  Group,
  type Object3D,
} from 'three';

const core = new Color(0xffe2a0);
const halo = new Color(0xf08a3c);
let shared:
  { sphere: SphereGeometry; core: MeshBasicMaterial; halo: MeshBasicMaterial } | undefined;

function parts() {
  shared ??= {
    sphere: new SphereGeometry(1, 16, 12),
    core: new MeshBasicMaterial({ color: core }),
    halo: new MeshBasicMaterial({
      color: halo,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  };
  return shared;
}

/** A glowing sphere of `radius` metres (bright core, soft halo twice as wide). */
export function createBolt(radius: number): Object3D {
  const { sphere, core: coreMaterial, halo: haloMaterial } = parts();
  const group = new Group();
  const inner = new Mesh(sphere, coreMaterial);
  inner.scale.setScalar(radius);
  const outer = new Mesh(sphere, haloMaterial);
  outer.scale.setScalar(radius * 2.2);
  group.add(inner, outer);
  return group;
}

/** Takes a bolt out of its scene; geometry and materials are shared and stay. */
export function disposeBolt(object: Object3D): void {
  object.removeFromParent();
}

export interface GroundMarker {
  readonly object: Object3D;
  /** Shows the marker at `point` with `radius`, green when valid and red when not; null hides it. */
  show(point: { x: number; y: number; z: number } | null, radius: number, valid: boolean): void;
}

/** A flat ring lying on the floor, the placeholder for an area spell's preview. */
export function createGroundMarker(): GroundMarker {
  const geometry = new RingGeometry(0.9, 1, 48);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({
    color: 0x8fd16b,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  });
  const ring = new Mesh(geometry, material);
  ring.renderOrder = 10;
  ring.visible = false;
  return {
    object: ring,
    show(point, radius, valid) {
      ring.visible = point !== null;
      if (point === null) return;
      ring.position.set(point.x, point.y + 0.03, point.z);
      ring.scale.setScalar(Math.max(0.25, radius));
      material.color.set(valid ? 0x8fd16b : 0xc8553d);
    },
  };
}
