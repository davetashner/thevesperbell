// Hiding spots on screen (mw-e03.23): a grey box per spot (a wardrobe, a barrel, a haystack) sized and
// coloured by its scene data, following the spot's sim pose (src/game/hiding `readHidingSpot`). Every
// box shares one unit geometry and one material per look; a spot that goes (burnt away, broken) only
// has its box taken out of the scene.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright hiding e2e (e2e/hiding.spec.ts).

import { BoxGeometry, Color, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { Vec3 } from '@sim/index';

/** Box colours by look. */
const LOOK_COLOURS: Readonly<Record<'wood' | 'hay', number>> = { wood: 0x6b4a2b, hay: 0xc9a84a };

let box: BoxGeometry | undefined;
const materials = new Map<string, MeshStandardMaterial>();

/** A hiding spot's box of `size` metres, centred on its origin (the pose lifts it onto its base). */
export function createHidingSpotMesh(size: Vec3, look: 'wood' | 'hay'): Object3D {
  box ??= new BoxGeometry(1, 1, 1);
  let material = materials.get(look);
  if (material === undefined) {
    material = new MeshStandardMaterial({ color: new Color(LOOK_COLOURS[look]), roughness: 0.9 });
    materials.set(look, material);
  }
  const mesh = new Mesh(box, material);
  mesh.name = `hiding-spot-${look}`;
  mesh.scale.set(size.x, size.y, size.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Takes a spot's box out of the scene, keeping the shared geometry and materials. */
export function disposeHidingSpotMesh(object: Object3D): void {
  object.removeFromParent();
}
