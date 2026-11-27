// Draws the ground decals of element states (mw-e03.53): the puddle and drip ring under a wet thing.
// Pooled flat meshes, one per decal, grown on demand and hidden when unused; nothing is allocated per
// frame once warm. The decal rests on the lowest point of the entity's rendered mesh (or, with no
// mesh, the bottom of its bounding sphere). Textures load by asset id from the VFX texture manifest
// (a generated placeholder until approved art lands) and a missing file leaves the mesh transparent.
//
// Render-only (needs a GPU context): verified by e2e/element-states.spec.ts; the decals it draws come
// from the bridge's `grounds()` (src/game/vfx/element-feedback.ts, unit tested).

import {
  Box3,
  CircleGeometry,
  DataTexture,
  DoubleSide,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  RGBAFormat,
  SRGBColorSpace,
  TextureLoader,
  UnsignedByteType,
  type Object3D,
  type Scene,
  type Texture,
} from 'three';

/** One decal to draw (the bridge's GroundDecal satisfies it). */
export interface GroundDrawItem {
  readonly entity: number;
  readonly texture: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly opacity: number;
  readonly rippleHz: number;
}

export interface ElementGroundOptions {
  readonly textureUrl?: (textureId: string) => string | undefined;
  /** The rendered object of an entity, if it has one. */
  readonly objectOf: (entity: number) => Object3D | undefined;
}

/** How far a decal floats off the surface so it never z-fights it, metres. */
const SURFACE_OFFSET = 0.06;
/** A ripple swells the decal by this fraction of its radius. */
const RIPPLE_DEPTH = 0.12;
/** The drip ring: a thin bright ring that grows from the middle of the patch to its rim. */
const RING_SIZE = 64;

function ringTexture(): DataTexture {
  const data = new Uint8Array(RING_SIZE * RING_SIZE * 4);
  const half = RING_SIZE / 2;
  for (let y = 0; y < RING_SIZE; y++) {
    for (let x = 0; x < RING_SIZE; x++) {
      const d = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
      const a = Math.max(0, 1 - Math.abs(d - 0.85) / 0.1);
      const i = (y * RING_SIZE + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a);
    }
  }
  const texture = new DataTexture(data, RING_SIZE, RING_SIZE, RGBAFormat, UnsignedByteType);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class ElementGrounds {
  readonly #scene: Scene;
  readonly #o: ElementGroundOptions;
  readonly #pool: Mesh<CircleGeometry, MeshBasicMaterial>[] = [];
  readonly #textures = new Map<string, Texture>();
  readonly #loader = new TextureLoader();
  readonly #geometry = new CircleGeometry(1, 24);
  readonly #box = new Box3();
  readonly #ringMap = ringTexture();

  constructor(scene: Scene, options: ElementGroundOptions) {
    this.#scene = scene;
    this.#o = options;
    this.#geometry.rotateX(-Math.PI / 2); // lie flat, facing up
  }

  /** Decals shown this frame. */
  get shown(): number {
    return this.#pool.filter((mesh) => mesh.visible).length;
  }

  draw(items: readonly GroundDrawItem[], seconds: number): void {
    items.forEach((item, i) => {
      const mesh = this.#meshAt(i);
      const object = this.#o.objectOf(item.entity);
      let floor = item.y - item.radius;
      if (object !== undefined && !this.#box.setFromObject(object).isEmpty()) {
        floor = this.#box.min.y;
      }
      const swell =
        item.rippleHz > 0 ? RIPPLE_DEPTH * Math.sin(2 * Math.PI * item.rippleHz * seconds) : 0;
      mesh.position.set(item.x, floor + SURFACE_OFFSET, item.z);
      mesh.scale.setScalar(item.radius * (1 + swell));
      const map = this.#textureOf(item.texture);
      if (mesh.material.map !== map) {
        mesh.material.map = map;
        mesh.material.needsUpdate = true;
      }
      mesh.material.opacity = item.opacity;
      mesh.visible = true;
    });
    for (let i = items.length; i < this.#pool.length; i++) {
      const mesh = this.#pool[i];
      if (mesh !== undefined) mesh.visible = false;
    }
  }

  dispose(): void {
    for (const mesh of this.#pool) {
      this.#scene.remove(mesh);
      mesh.material.dispose();
      (mesh.children[0] as Mesh<CircleGeometry, MeshBasicMaterial>).material.dispose();
    }
    this.#ringMap.dispose();
    this.#pool.length = 0;
    for (const texture of this.#textures.values()) texture.dispose();
    this.#textures.clear();
    this.#geometry.dispose();
  }

  #meshAt(index: number): Mesh<CircleGeometry, MeshBasicMaterial> {
    let mesh = this.#pool[index];
    if (mesh === undefined) {
      const material = new MeshBasicMaterial({
        color: 0xffffff, // the texture carries the wet-patch colour
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      mesh = new Mesh(this.#geometry, material);
      mesh.renderOrder = 1;
      const ring = new Mesh(
        this.#geometry,
        new MeshBasicMaterial({
          map: this.#ringMap,
          color: 0xbfe6ff, // pale water, bright enough to read on lit stone
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -3,
        }),
      );
      ring.position.y = 0.005;
      ring.renderOrder = 2;
      mesh.add(ring);
      mesh.frustumCulled = false;
      mesh.name = 'element-ground';
      this.#pool.push(mesh);
      this.#scene.add(mesh);
    }
    return mesh;
  }

  #textureOf(id: string): Texture | null {
    let texture = this.#textures.get(id);
    if (texture === undefined) {
      const url = this.#o.textureUrl?.(id);
      if (url === undefined) return null;
      texture = this.#loader.load(url);
      texture.colorSpace = SRGBColorSpace;
      texture.magFilter = LinearFilter;
      this.#textures.set(id, texture);
    }
    return texture;
  }
}
