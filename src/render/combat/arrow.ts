// An arrow's placeholder shaft (mw-e05.21): a pale wooden shaft with a dark head and light fletching,
// tip at the origin, pointing along +z (the shaft trails back along −z), 0.75 m long. Final arrow
// art and trails are mw-e29.11's.
//
// Cheap by design: every arrow shares one geometry and one material per part, casts no shadow, and
// is a handful of triangles, so a quiver's worth stuck about a room costs next to nothing. Because
// the resources are shared, a despawned arrow's shaft is only taken out of the scene
// (`disposeArrowShaft`), never freed.
//
// A shaft that cannot be picked up again is swapped for the broken one (mw-e29.11): a snapped stub
// with a splintered end and a bent head. `breakArrowShaft` swaps a bound shaft in place and
// `createBrokenArrowShaft` makes a loose one (the stub left where an arrow shattered). There is no
// broken-arrow art yet (arrow models are an asset bead), so this is the grey-box one.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright bow e2e (e2e/bow.spec.ts).

import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three';

/** Shaft length, metres. */
export const ARROW_LENGTH = 0.75;

const HEAD_LENGTH = 0.05;

/** Length of what is left of a broken shaft behind its head, metres. */
const STUB_LENGTH = 0.18;

let parts:
  | {
      readonly shaft: CylinderGeometry;
      readonly head: ConeGeometry;
      readonly fletch: BoxGeometry;
      readonly stub: CylinderGeometry;
      readonly splinter: BoxGeometry;
      readonly wood: MeshStandardMaterial;
      readonly iron: MeshStandardMaterial;
      readonly feather: MeshStandardMaterial;
    }
  | undefined;

function shared() {
  if (parts !== undefined) return parts;
  // Cylinders and cones stand along +y; turn them to lie along +z.
  const shaft = new CylinderGeometry(0.008, 0.008, ARROW_LENGTH - HEAD_LENGTH, 5);
  shaft.rotateX(Math.PI / 2);
  shaft.translate(0, 0, -(HEAD_LENGTH + (ARROW_LENGTH - HEAD_LENGTH) / 2));
  const head = new ConeGeometry(0.018, HEAD_LENGTH, 5);
  head.rotateX(Math.PI / 2);
  head.translate(0, 0, -HEAD_LENGTH / 2);
  const fletch = new BoxGeometry(0.002, 0.04, 0.12);
  fletch.translate(0, 0, -ARROW_LENGTH + 0.08);
  // The broken one: a stub about a third of the shaft, snapped off short, with a splinter.
  const stub = new CylinderGeometry(0.008, 0.008, STUB_LENGTH, 5);
  stub.rotateX(Math.PI / 2);
  stub.translate(0, 0, -(HEAD_LENGTH + STUB_LENGTH / 2));
  const splinter = new BoxGeometry(0.004, 0.006, 0.05);
  splinter.rotateX(0.5);
  splinter.translate(0.006, 0.004, -(HEAD_LENGTH + STUB_LENGTH + 0.015));
  parts = {
    shaft,
    head,
    fletch,
    stub,
    splinter,
    wood: new MeshStandardMaterial({ color: new Color(0xb8925a), roughness: 0.9 }),
    iron: new MeshStandardMaterial({ color: new Color(0x3a3a40), roughness: 0.5, metalness: 0.6 }),
    feather: new MeshStandardMaterial({ color: new Color(0xe8e0d0), roughness: 1 }),
  };
  return parts;
}

function intactParts(): Group {
  const { shaft, head, fletch, wood, iron, feather } = shared();
  const group = new Group();
  group.name = 'arrow-intact';
  const vane = new Mesh(fletch, feather);
  const crossed = new Mesh(fletch, feather);
  crossed.rotation.z = Math.PI / 2;
  group.add(new Mesh(shaft, wood), new Mesh(head, iron), vane, crossed);
  return group;
}

function brokenParts(): Group {
  const { head, stub, splinter, wood, iron } = shared();
  const group = new Group();
  group.name = 'arrow-broken';
  group.add(new Mesh(stub, wood), new Mesh(head, iron), new Mesh(splinter, wood));
  return group;
}

/** A new arrow shaft (see the file header). */
export function createArrowShaft(): Object3D {
  const group = new Group();
  group.name = 'arrow';
  const broken = brokenParts();
  broken.visible = false;
  group.add(intactParts(), broken);
  return group;
}

/** A loose broken shaft: what is left where an arrow shattered, tip at the origin along +z. */
export function createBrokenArrowShaft(): Object3D {
  const group = new Group();
  group.name = 'arrow-broken-loose';
  group.add(brokenParts());
  return group;
}

/** Swaps a bound shaft for the broken one, in place; a no-op on anything else. */
export function breakArrowShaft(object: Object3D): void {
  const intact = object.getObjectByName('arrow-intact');
  const broken = object.getObjectByName('arrow-broken');
  if (intact === undefined || broken === undefined) return;
  intact.visible = false;
  broken.visible = true;
}

/** Takes a shaft out of the scene, keeping the shared geometry and materials. */
export function disposeArrowShaft(object: Object3D): void {
  object.removeFromParent();
}
