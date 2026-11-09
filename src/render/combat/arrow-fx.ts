// Three.js drawing of the arrow effects that are not particles (mw-e29.11): the wet decal a water
// arrow leaves, the ring a noise arrow pulses, the ribbon a rope arrow unfurls and the broken shaft a
// shattered arrow leaves behind. The game side (src/game/vfx/arrow-fx.ts) decides what exists, where
// and how strong; this only places pooled objects, so nothing is allocated per frame once warm.
// The rope ribbon is the exception: its vertices are rewritten into one reused buffer per slot.
//
// Colours follow the style bible: water #3F7FA0 (a wet patch is a cool tint that reads on dark
// stone as well as light, it does not glow), hemp #C9A26B, and a warm neutral for the noise ring; the ring is additive but thin and faint, and its
// rate is limited by the game side to the shared 2 Hz pulse ceiling.
//
// Render-only (needs a GPU context), so it is excluded from unit coverage and verified by the
// Playwright arrow effects spec (e2e/arrow-vfx.spec.ts); the rules it draws are unit tested in
// src/game/vfx/arrow-fx.test.ts.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  RGBAFormat,
  RingGeometry,
  UnsignedByteType,
  Vector3,
  type Scene,
} from 'three';
import { at } from '../vfx/trail-ribbon';
import { createBrokenArrowShaft } from './arrow';

/** What the renderer reads each frame (the game side's ArrowFxView satisfies it). */
export interface ArrowFxDrawSource {
  readonly decals: readonly FlatItem[];
  readonly rings: readonly FlatItem[];
  readonly ropes: readonly RopeItem[];
  readonly broken: readonly BrokenItem[];
}

interface FlatItem {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly radius: number;
  readonly opacity: number;
}

interface RopeItem {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly length: number;
  readonly opacity: number;
  readonly age: number;
}

interface BrokenItem {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly opacity: number;
}

export interface ArrowFxRenderer {
  /** Brings every decal, ring, ribbon and broken shaft up to date with this frame. */
  draw(source: ArrowFxDrawSource): void;
  /** Removes the effect objects from the scene and frees their GPU resources. */
  dispose(): void;
}

/** Stations along a rope ribbon. */
const ROPE_STATIONS = 18;
/** Half the ribbon's width, metres. */
const ROPE_HALF_WIDTH = 0.04;
/** How far a decal floats off the surface it sits on, so it never z-fights it. */
const SURFACE_OFFSET = 0.012;
const DECAL_TEXTURE_SIZE = 64;

/** A soft-edged disc, so a wet patch fades into the stone instead of ending in a hard circle. */
function decalTexture(): DataTexture {
  const size = DECAL_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
      // Solid to 55% of the radius, then smoothly out to nothing at the rim.
      const t = Math.min(1, Math.max(0, (1 - d) / 0.45));
      const a = t * t * (3 - 2 * t);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const FORWARD = new Vector3(0, 0, 1);
const scratchNormal = new Vector3();
const scratchQuat = new Quaternion();

/** Turns `object` so its +z faces unit direction (x, y, z). */
function faceAlong(object: Object3D, x: number, y: number, z: number): void {
  scratchNormal.set(x, y, z);
  object.quaternion.copy(scratchQuat.setFromUnitVectors(FORWARD, scratchNormal));
}

interface RopeSlot {
  readonly mesh: Mesh;
  readonly positions: BufferAttribute;
}

function ropeSlot(material: MeshBasicMaterial): RopeSlot {
  const positions = new BufferAttribute(new Float32Array(ROPE_STATIONS * 2 * 3), 3).setUsage(
    DynamicDrawUsage,
  );
  const index = new Uint16Array((ROPE_STATIONS - 1) * 6);
  for (let s = 0; s < ROPE_STATIONS - 1; s++) {
    const a = s * 2;
    index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], s * 6);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', positions);
  geometry.setIndex(new BufferAttribute(index, 1));
  const mesh = new Mesh(geometry, material.clone());
  mesh.name = 'rope-unfurl';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 4;
  return { mesh, positions };
}

/** Writes a ribbon hanging from (x, y, z) down `length` metres, swaying as it settles. */
function writeRope(slot: RopeSlot, rope: RopeItem): void {
  const a = slot.positions.array as Float32Array;
  // The sway dies away as the rope settles: a flick down, then it hangs.
  const settle = Math.max(0, 1 - rope.age / 1.4);
  for (let i = 0; i < ROPE_STATIONS; i++) {
    const t = i / (ROPE_STATIONS - 1);
    const sway = Math.sin(rope.age * 7 - t * 5) * 0.18 * t * settle;
    const cx = rope.x + sway;
    const cy = rope.y - rope.length * t;
    const cz = rope.z + sway * 0.5;
    const o = i * 6;
    a[o] = cx - ROPE_HALF_WIDTH;
    a[o + 1] = cy;
    a[o + 2] = cz;
    a[o + 3] = cx + ROPE_HALF_WIDTH;
    a[o + 4] = cy;
    a[o + 5] = cz;
  }
  slot.positions.needsUpdate = true;
}

/** Creates the arrow effect objects in `scene`, hidden until `draw` shows them. */
export function createArrowFxRenderer(scene: Scene, maxEach = 12): ArrowFxRenderer {
  const texture = decalTexture();
  const decalMaterial = new MeshBasicMaterial({
    map: texture,
    color: new Color('#3F7FA0'),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const ringMaterial = new MeshBasicMaterial({
    color: new Color('#E8E0C8'),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const ropeMaterial = new MeshBasicMaterial({
    color: new Color('#C9A26B'),
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const decalGeometry = new CircleGeometry(1, 40);
  const ringGeometry = new RingGeometry(0.955, 1, 56);
  const decals: Mesh[] = [];
  const rings: Mesh[] = [];
  const ropes: RopeSlot[] = [];
  const pieces: Object3D[] = [];

  /** The pooled object `i` of `pool`, made (hidden, in the scene) the first time it is needed. */
  const slot = <T extends Object3D>(pool: T[], i: number, make: () => T): T => {
    let object = pool[i];
    if (object === undefined) {
      object = make();
      object.visible = false;
      pool[i] = object;
      scene.add(object);
    }
    return object;
  };
  const hideFrom = (pool: readonly Object3D[], from: number): void => {
    for (let i = from; i < pool.length; i++) at(pool, i).visible = false;
  };

  const flat = (pool: Mesh[], items: readonly FlatItem[], make: () => Mesh, lift: number): void => {
    const count = Math.min(items.length, maxEach);
    for (let i = 0; i < count; i++) {
      const item = at(items, i);
      const mesh = slot(pool, i, make);
      mesh.visible = item.opacity > 0;
      mesh.position.set(item.x + item.nx * lift, item.y + item.ny * lift, item.z + item.nz * lift);
      faceAlong(mesh, item.nx, item.ny, item.nz);
      mesh.scale.setScalar(item.radius);
      (mesh.material as MeshBasicMaterial).opacity = item.opacity;
    }
    hideFrom(pool, count);
  };

  return {
    draw({ decals: wet, rings: noise, ropes: lines, broken }) {
      flat(
        decals,
        wet,
        () => {
          const mesh = new Mesh(decalGeometry, decalMaterial.clone());
          mesh.name = 'wet-decal';
          mesh.renderOrder = 2;
          return mesh;
        },
        SURFACE_OFFSET,
      );
      flat(
        rings,
        noise,
        () => {
          const mesh = new Mesh(ringGeometry, ringMaterial.clone());
          mesh.name = 'noise-ring';
          mesh.renderOrder = 3;
          return mesh;
        },
        0.04,
      );
      const ropeCount = Math.min(lines.length, maxEach);
      for (let i = 0; i < ropeCount; i++) {
        const rope = at(lines, i);
        const s = ropes[i] ?? (ropes[i] = ropeSlot(ropeMaterial));
        if (s.mesh.parent === null) scene.add(s.mesh);
        s.mesh.visible = rope.opacity > 0 && rope.length > 0.01;
        if (!s.mesh.visible) continue;
        writeRope(s, rope);
        (s.mesh.material as MeshBasicMaterial).opacity = rope.opacity;
      }
      for (let i = ropeCount; i < ropes.length; i++) at(ropes, i).mesh.visible = false;
      const brokenCount = Math.min(broken.length, maxEach);
      for (let i = 0; i < brokenCount; i++) {
        const item = at(broken, i);
        const piece = slot(pieces, i, createBrokenArrowShaft);
        piece.visible = item.opacity > 0;
        piece.position.set(item.x, item.y, item.z);
        faceAlong(piece, item.dx, item.dy, item.dz);
        // Shrinks away as it fades: the shared materials cannot take a per-shaft opacity.
        piece.scale.setScalar(Math.max(0.001, item.opacity));
      }
      hideFrom(pieces, brokenCount);
    },
    dispose() {
      for (const mesh of [...decals, ...rings]) {
        scene.remove(mesh);
        (mesh.material as MeshBasicMaterial).dispose();
      }
      for (const { mesh } of ropes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
      }
      for (const piece of pieces) scene.remove(piece);
      decalGeometry.dispose();
      ringGeometry.dispose();
      decalMaterial.dispose();
      ringMaterial.dispose();
      ropeMaterial.dispose();
      texture.dispose();
    },
  };
}
