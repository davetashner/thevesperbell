// Three.js drawing of weapon trails and the charge glow (mw-e29.6). The game side (src/game/vfx
// trail-controller) decides what exists and where: a trail's smoothed ribbon is written straight
// into a preallocated, reused vertex buffer (one mesh per trail slot, TRAIL_MAX of them), and each
// glow is a camera-facing additive sprite. Nothing is allocated per frame.
//
// Render-only (needs a GPU context), so it is excluded from unit coverage and verified by the
// Playwright VFX smoke and the unit tests of the geometry it uploads (src/game/vfx/trail-ribbon).

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  RGBAFormat,
  Sprite,
  SpriteMaterial,
  UnsignedByteType,
  type Scene,
} from 'three';
import { at, TRAIL_MAX, TRAIL_MAX_STATIONS, writeRibbon, type Trail } from './trail-ribbon';

/** What the renderer reads each frame: the live trails and the glows. */
export interface TrailDrawSource {
  readonly set: { readonly trails: readonly Trail[] };
  readonly glows: readonly {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly size: number;
    readonly opacity: number;
  }[];
}

export interface TrailRenderer {
  /** Brings every trail ribbon and glow sprite up to date with this frame. */
  draw(source: TrailDrawSource): void;
  /** Removes the trail objects from the scene and frees their GPU resources. */
  dispose(): void;
}

const GLOW_TEXTURE_SIZE = 32;

/** A soft white disc, so a glow tinted by the sprite colour fades to nothing at its edge. */
function glowTexture(): DataTexture {
  const data = new Uint8Array(GLOW_TEXTURE_SIZE * GLOW_TEXTURE_SIZE * 4);
  const half = GLOW_TEXTURE_SIZE / 2;
  for (let y = 0; y < GLOW_TEXTURE_SIZE; y++) {
    for (let x = 0; x < GLOW_TEXTURE_SIZE; x++) {
      const d = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
      const a = Math.max(0, 1 - d);
      const i = (y * GLOW_TEXTURE_SIZE + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a * a);
    }
  }
  const texture = new DataTexture(
    data,
    GLOW_TEXTURE_SIZE,
    GLOW_TEXTURE_SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

interface RibbonMesh {
  readonly mesh: Mesh;
  readonly positions: BufferAttribute;
  readonly colours: BufferAttribute;
}

function ribbonMesh(material: MeshBasicMaterial): RibbonMesh {
  const vertices = TRAIL_MAX_STATIONS * 2;
  const positions = new BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(
    DynamicDrawUsage,
  );
  const colours = new BufferAttribute(new Float32Array(vertices * 4), 4).setUsage(DynamicDrawUsage);
  const index = new Uint16Array((TRAIL_MAX_STATIONS - 1) * 6);
  for (let s = 0; s < TRAIL_MAX_STATIONS - 1; s++) {
    const a = s * 2;
    index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], s * 6);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', positions);
  geometry.setAttribute('color', colours);
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'swing-trail';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 5;
  return { mesh, positions, colours };
}

/** Creates the trail and glow objects in `scene`, hidden until `draw` shows them. */
export function createTrailRenderer(scene: Scene): TrailRenderer {
  const material = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const ribbons = Array.from({ length: TRAIL_MAX }, () => ribbonMesh(material));
  for (const { mesh } of ribbons) scene.add(mesh);
  const texture = glowTexture();
  const sprites: Sprite[] = [];

  const spriteAt = (i: number): Sprite => {
    let sprite = sprites[i];
    if (sprite === undefined) {
      sprite = new Sprite(
        new SpriteMaterial({
          map: texture,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      sprite.name = 'charge-glow';
      sprite.renderOrder = 6;
      sprites[i] = sprite;
      scene.add(sprite);
    }
    return sprite;
  };

  return {
    draw({ set, glows }) {
      for (let i = 0; i < TRAIL_MAX; i++) {
        const ribbon = at(ribbons, i);
        const trail = at(set.trails, i);
        const stations = trail.visible
          ? writeRibbon(
              trail,
              ribbon.positions.array as Float32Array,
              ribbon.colours.array as Float32Array,
            )
          : 0;
        ribbon.mesh.visible = stations > 0;
        if (stations === 0) continue;
        ribbon.positions.needsUpdate = true;
        ribbon.colours.needsUpdate = true;
        ribbon.mesh.geometry.setDrawRange(0, (stations - 1) * 6);
      }
      glows.forEach((glow, i) => {
        const lit = glow.opacity > 0 && glow.size > 0;
        if (!lit && sprites[i] === undefined) return;
        const sprite = spriteAt(i);
        sprite.visible = lit;
        if (!lit) return;
        sprite.position.set(glow.x, glow.y, glow.z);
        sprite.scale.setScalar(glow.size * 2);
        sprite.material.color.setRGB(glow.r, glow.g, glow.b);
        sprite.material.opacity = glow.opacity;
      });
    },
    dispose() {
      for (const { mesh } of ribbons) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
      material.dispose();
      for (const sprite of sprites) {
        scene.remove(sprite);
        sprite.material.dispose();
      }
      texture.dispose();
    },
  };
}
