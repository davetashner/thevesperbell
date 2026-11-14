// Greybox rendering (mw-e00.21): turns a scene layout (src/sim/scene) into Three.js objects. Kept
// cheap on purpose (AC-6: ≤ 8 ms p95 on the reference machine): all static parts of one purpose are
// merged into a single mesh, so a whole scene is at most one draw call per purpose (five), lit by a
// hemisphere light and one shadow-casting sun fitted to the scene's bounds. Both mirror the sim's
// light environment (mw-e03.37): the fill follows its ambient level, the sun its brightest
// directional light (off when it has none), through the same mapping as the torch lights. Materials are colour-coded
// by purpose and carry a 1 m world-space grid so distances read at a glance.
//
// Breakable pieces (mw-e03.11) are left out of the merged meshes: each is its own mesh (`piece`),
// which the scene loader binds to the piece's entity so it vanishes when the piece breaks. A piece
// whose profile telegraphs a weak spot gets dark crack lines on both faces of its thin side.
//
// Render-only (needs a GPU context), so it is excluded from unit coverage and verified by the
// Playwright scene smoke (e2e/scenes.spec.ts) and the breakables e2e (e2e/breakables.spec.ts).

import type { KitPurpose } from '@content/index';
import type {
  ResolvedLightEnvironment,
  SceneLayout,
  ScenePart,
  ScenePiecePlacement,
  SceneSpawnPlacement,
  Vec3,
} from '@sim/index';
import { renderIntensity } from '../light/index.ts';
import { SURFACE_COLOURS, surfacePatches } from './surface-patches';
import { loadBrazier, loadChest, loadTorch } from '../props/set-pieces';
import {
  CRATE_URL,
  IVY_TILE,
  IVY_URL,
  paintedMaterial,
  PILLAR_TILE,
  PILLAR_URL,
  worldUvPartGeometry,
} from '../props/surfaces';
import {
  BoxGeometry,
  PlaneGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Object3D,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Greybox colour code by purpose (sRGB). */
export const PURPOSE_COLOURS: Readonly<Record<KitPurpose, number>> = {
  walkable: 0x8c8676,
  blocking: 0x5d6470,
  climbable: 0x4f8f5a,
  interactive: 0x3d7bc4,
  hazard: 0xc4462f,
};

/** A rope (mw-e03.13): hemp, or grey iron when it ignores pierce and slash (a chain). */
const ROPE_COLOUR = 0x9b7b4a;
const CHAIN_COLOUR = 0x6b7078;
/** Thinnest a rope is drawn, metres across, so a 0.05 m cord still reads from the camera. */
const MIN_ROPE_WIDTH = 0.06;
const MARKER_COLOUR = 0xe8c547;
/** Spawn tags whose marker keeps the facing cone: they stand on the ground (mw-ju8.42). */
export const MARKER_CONE_TAGS: readonly string[] = ['arrival', 'player-start'];
/** A sign board, metres (width, height, thickness), and its weathered-wood colour. */
const SIGN_BOARD = [1.1, 0.5, 0.08] as const;
const SIGN_COLOUR = 0xc9a66b;
/** Crack lines on a weak wall (mw-e03.11). */
const CRACK_COLOUR = 0x1a1612;
/** A wall bracket holding a light (a torch spawn). */
const BRACKET_COLOUR = 0x3b3a5a;
const BACKGROUND = 0x10131c;
/** Direction the sunlight comes from until the scene's light environment says otherwise. */
const DEFAULT_SUN_DIRECTION = new Vector3(0.45, 1, -0.3).normalize();
const SHADOW_MAP_SIZE = 2048;

/**
 * The glenstone painted over a purpose's flat colour (mw-7w0, the owner's quay probe). `floor` lays it on
 * upward-facing surfaces only and keeps the grid (the testbed, as the owner wired it); `all` blends it onto
 * every face, projected along the surface's dominant axis (one fetch, not a blend: the slice is boxes), and
 * drops the grid.
 */
export interface StoneSurface {
  readonly faces: 'floor' | 'all';
  readonly grid: boolean;
}

/** The runtime stone painting: 1024², one tile is 4 m × 4 m (blocks 80 to 140 cm). */
export const STONE_URL = '/assets/texture/tex-glenstone-quay-wendmouth-probe-01.webp';
const STONE_TILE_METRES = 4;

/** Which scenes lay stone on which purposes, until scenes name their own surfaces. */
export function stoneFor(layoutId: string, purpose: KitPurpose): StoneSurface | undefined {
  if (layoutId === 'testbed' && purpose === 'walkable') return { faces: 'floor', grid: true };
  if (layoutId === 'slice' && ['walkable', 'blocking', 'climbable'].includes(purpose)) {
    return { faces: 'all', grid: false };
  }
  return undefined;
}

/** How much of the stone shows: 0 until the painting has loaded (so there is no black flash), then 1. */
interface StoneLoad {
  readonly map: Texture;
  readonly amount: { value: number };
}

/** A standard material with a 1 m world-space grid drawn over it, and optionally the stone painting. */
function gridMaterial(
  colour: number,
  stone?: { surface: StoneSurface; load: StoneLoad },
): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: new Color(colour), roughness: 0.9 });
  material.onBeforeCompile = (shader) => {
    if (stone !== undefined) {
      shader.uniforms['vbStoneMap'] = { value: stone.load.map };
      shader.uniforms['vbStoneAmount'] = stone.load.amount;
      shader.uniforms['vbStoneTile'] = { value: STONE_TILE_METRES };
    }
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vGridPos;\nvarying vec3 vGridNormal;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        [
          '#include <project_vertex>',
          'vGridPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
          'vGridNormal = normalize(mat3(modelMatrix) * objectNormal);',
        ].join('\n'),
      );
    const stoneHeader =
      stone === undefined
        ? ''
        : 'uniform sampler2D vbStoneMap;\nuniform float vbStoneAmount;\nuniform float vbStoneTile;\n';
    const stoneColour =
      stone === undefined
        ? []
        : stone.surface.faces === 'floor'
          ? [
              'float stoneFacing = smoothstep(0.7, 0.9, abs(normalize(vGridNormal).y)) * vbStoneAmount;',
              'vec3 stoneColour = texture2D(vbStoneMap, vGridPos.xz / vbStoneTile).rgb;',
              'diffuseColor.rgb = mix(diffuseColor.rgb, stoneColour, stoneFacing);',
            ]
          : [
              'vec3 stoneA = abs(normalize(vGridNormal));',
              'vec2 stoneUv = stoneA.y >= max(stoneA.x, stoneA.z) ? vGridPos.xz : (stoneA.x >= stoneA.z ? vGridPos.zy : vGridPos.xy);',
              'vec3 stoneColour = texture2D(vbStoneMap, stoneUv / vbStoneTile).rgb;',
              'diffuseColor.rgb = mix(diffuseColor.rgb, stoneColour, vbStoneAmount);',
            ];
    const gridLines =
      stone !== undefined && !stone.surface.grid
        ? []
        : [
            'vec3 gridN = abs(normalize(vGridNormal));',
            'vec3 gridW = max(fwidth(vGridPos) * 1.5, vec3(1e-4));',
            'vec3 gridL = 1.0 - clamp(abs(fract(vGridPos - 0.5) - 0.5) / gridW, 0.0, 1.0);',
            'float grid = max(max(gridL.x * (1.0 - gridN.x), gridL.y * (1.0 - gridN.y)), gridL.z * (1.0 - gridN.z));',
            'diffuseColor.rgb *= 1.0 - 0.3 * grid;',
          ];
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `${stoneHeader}varying vec3 vGridPos;\nvarying vec3 vGridNormal;\nvoid main() {`,
      )
      .replace(
        '#include <color_fragment>',
        ['#include <color_fragment>', ...stoneColour, ...gridLines].join('\n'),
      );
  };
  material.customProgramCacheKey = () =>
    stone === undefined
      ? 'greybox-grid'
      : `greybox-grid-stone-${stone.surface.faces}-${stone.surface.grid ? 'grid' : 'plain'}`;
  return material;
}

/** A wedge (ramp) of `size` centred on the origin, rising towards +z; flat-shaded. */
function wedgeGeometry(w: number, h: number, l: number): BufferGeometry {
  const [x0, x1, y0, y1, z0, z1] = [-w / 2, w / 2, -h / 2, h / 2, -l / 2, l / 2];
  const a = [x0, y0, z0];
  const b = [x1, y0, z0];
  const c = [x0, y0, z1];
  const d = [x1, y0, z1];
  const e = [x0, y1, z1];
  const f = [x1, y1, z1];
  // Counter-clockwise seen from outside: slope, bottom, back, left, right.
  const triangles = [a, e, f, a, f, b, a, b, d, a, d, c, c, d, f, c, f, e, a, c, e, b, f, d];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(triangles.flat(), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** One part's geometry, placed in world space. Non-indexed, position + normal only, so all merge. */
/** The layout parts that wear a painting (mw-va0): what it is, how many metres a tile covers, its colour until it loads. */
const PAINTED = {
  pillar: { url: PILLAR_URL, tile: PILLAR_TILE, fallback: 0x8c8a80 },
  ivy: { url: IVY_URL, tile: IVY_TILE, fallback: 0x2f4a3a },
} as const;
export type PaintedKind = keyof typeof PAINTED;

/** The world properties of a placement that decide a part's painting (the level material, a climb grade). */
export interface PaintedProperties {
  readonly material?: { readonly id: string } | undefined;
  readonly climbable?: string | undefined;
}

/** Which painting a part wears: a kit pillar, or a piece whose material or climb grade is ivy. */
export function paintedKind(
  part: Pick<ScenePart, 'piece'>,
  properties: PaintedProperties | undefined,
): PaintedKind | undefined {
  if (part.piece === 'pillar') return 'pillar';
  if (properties?.material?.id === 'ivy' || properties?.climbable === 'ivy') return 'ivy';
  return undefined;
}

const paintedMaterialCache = new Map<PaintedKind, MeshStandardMaterial>();

/** The shared tiling material of a painted kind. */
function paintedMaterials(kind: PaintedKind): MeshStandardMaterial {
  let material = paintedMaterialCache.get(kind);
  if (material === undefined) {
    material = paintedMaterial(PAINTED[kind].url, PAINTED[kind].fallback, true);
    paintedMaterialCache.set(kind, material);
  }
  return material;
}

/** The crate's painted face, on all six faces of its box (mw-va0); shared by every crate. */
let crateMaterial: MeshStandardMaterial | undefined;
function crateFaces(): MeshStandardMaterial {
  crateMaterial ??= paintedMaterial(CRATE_URL, PURPOSE_COLOURS.interactive, false);
  return crateMaterial;
}

function partGeometry(part: ScenePart): BufferGeometry {
  const { size, center, rotation } = part;
  let geometry: BufferGeometry;
  if (part.shape === 'wedge') {
    geometry = wedgeGeometry(size.x, size.y, size.z);
  } else {
    const box = new BoxGeometry(size.x, size.y, size.z);
    geometry = box.toNonIndexed();
    box.dispose();
    geometry.deleteAttribute('uv');
  }
  geometry.applyMatrix4(
    new Matrix4().compose(
      new Vector3(center.x, center.y, center.z),
      new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
      new Vector3(1, 1, 1),
    ),
  );
  return geometry;
}

/** The part's world matrix: its centre and rotation. */
function partMatrix(part: ScenePart): Matrix4 {
  const { center, rotation } = part;
  return new Matrix4().compose(
    new Vector3(center.x, center.y, center.z),
    new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    new Vector3(1, 1, 1),
  );
}

/**
 * Crack lines on both faces of a box part's thin side, in world space: a jagged line of thin dark
 * slabs from low on one side to high on the other, with a branch.
 */
function crackGeometry(part: ScenePart): BufferGeometry {
  const { x, y, z } = part.size;
  const alongX = z <= x; // the thin side faces ±z (a wall) or ±x
  const width = alongX ? x : z;
  const depth = (alongX ? z : x) / 2 + 0.004;
  const points: [number, number][] = [
    [-0.35, -0.4],
    [-0.15, -0.15],
    [-0.22, 0.05],
    [0.05, 0.2],
    [0.02, 0.38],
    [0.3, 0.45],
  ];
  const branch: [number, number][] = [
    [-0.22, 0.05],
    [-0.38, 0.22],
  ];
  const slabs: BufferGeometry[] = [];
  for (const line of [points, branch]) {
    line.slice(1).forEach(([u1, v1], i) => {
      const [u0, v0] = line[i] ?? [u1, v1];
      const du = (u1 - u0) * width;
      const dv = (v1 - v0) * y;
      const length = Math.hypot(du, dv);
      for (const side of [-1, 1]) {
        const slab = new BoxGeometry(length, 0.035, 0.01).toNonIndexed();
        slab.deleteAttribute('uv');
        slab.rotateZ(Math.atan2(dv, du));
        slab.translate(((u0 + u1) / 2) * width, ((v0 + v1) / 2) * y, side * depth);
        if (!alongX) slab.rotateY(Math.PI / 2);
        slabs.push(slab);
      }
    });
  }
  const merged = mergeGeometries(slabs);
  for (const slab of slabs) slab.dispose();
  merged.applyMatrix4(partMatrix(part));
  return merged;
}

export interface GreyboxView {
  /** The scene's static geometry: one merged mesh per purpose, added to the scene. */
  staticGeometry(layout: SceneLayout): Object3D;
  /** The object for one spawn (a prop box, or a marker cone pointing the spawn's way). */
  spawn(spawn: SceneSpawnPlacement): Object3D;
  /** A movable prop (mw-e03.39): a `size` box centred on the origin, which follows its body. */
  body(spawn: SceneSpawnPlacement, size: Vec3): Object3D;
  /** A breakable piece (mw-e03.11): its parts in world space, with crack lines when `crack`. */
  piece(piece: ScenePiecePlacement, parts: readonly ScenePart[], crack: boolean): Object3D;
  /**
   * Mirrors the sim's light environment (mw-e03.37): hemisphere fill from its ambient level, the
   * shadow-casting sun from its brightest directional light (none: the sun is off).
   */
  setEnvironment(environment: ResolvedLightEnvironment): void;
  /** Removes the lights. Scene objects are disposed through their render bindings. */
  dispose(): void;
}

/** Sets up greybox lighting in `scene` and returns the builders for scene objects. */
export function createGreyboxView(renderer: WebGLRenderer, scene: Scene): GreyboxView {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  scene.background = new Color(BACKGROUND);

  const sky = new HemisphereLight(0xc4d2ec, 0x3a3228, 1.4);
  const sun = new DirectionalLight(0xfff1dc, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sky, sun, sun.target);
  const sunDirection = DEFAULT_SUN_DIRECTION.clone();
  let fitted: readonly ScenePart[] = [];
  let stoneLoad: StoneLoad | undefined;

  /** The stone painting, loaded on the first scene that wants it and shared by every material. */
  const stone = (): StoneLoad => {
    if (stoneLoad === undefined) {
      const amount = { value: 0 };
      const map = new TextureLoader().load(
        STONE_URL,
        () => {
          amount.value = 1;
        },
        undefined,
        () => {
          // Keep the flat purpose colours.
        },
      );
      map.name = 'texture:tex-glenstone-quay-wendmouth-probe-01';
      map.colorSpace = SRGBColorSpace;
      map.wrapS = RepeatWrapping;
      map.wrapT = RepeatWrapping;
      map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      stoneLoad = { map, amount };
    }
    return stoneLoad;
  };

  /** Points the sun at the layout and fits its shadow camera around it. */
  const fitSun = (parts: readonly ScenePart[]): void => {
    fitted = parts;
    if (parts.length === 0) return;
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const part of parts) {
      min.min(new Vector3(part.min.x, part.min.y, part.min.z));
      max.max(new Vector3(part.max.x, part.max.y, part.max.z));
    }
    const centre = min.clone().add(max).multiplyScalar(0.5);
    const radius = Math.max(1, max.distanceTo(min) / 2);
    sun.target.position.copy(centre);
    sun.position.copy(centre).addScaledVector(sunDirection, radius * 2);
    const camera = sun.shadow.camera;
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.near = 0.1;
    camera.far = radius * 4;
    camera.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
  };

  return {
    staticGeometry(layout) {
      const group = new Group();
      group.name = `scene:${layout.id}`;
      const byPurpose = new Map<KitPurpose, BufferGeometry[]>();
      const paintedParts = new Map<PaintedKind, BufferGeometry[]>();
      for (const part of layout.parts) {
        // A breakable piece is drawn on its own (`piece`), so it can go when it breaks.
        if (layout.pieces[part.placement]?.breakable !== undefined) continue;
        // The pillars and the ivy wear paintings (mw-va0), so they are drawn on their own, with UVs.
        const kind = paintedKind(part, layout.pieces[part.placement]?.properties);
        const geometry =
          kind === undefined ? undefined : worldUvPartGeometry(part, PAINTED[kind].tile);
        if (kind !== undefined && geometry !== undefined) {
          const painted = paintedParts.get(kind) ?? [];
          painted.push(geometry);
          paintedParts.set(kind, painted);
          continue;
        }
        const list = byPurpose.get(part.purpose) ?? [];
        list.push(partGeometry(part));
        byPurpose.set(part.purpose, list);
      }
      for (const [kind, geometries] of paintedParts) {
        const merged = mergeGeometries(geometries);
        for (const geometry of geometries) geometry.dispose();
        const mesh = new Mesh(merged, paintedMaterials(kind));
        mesh.name = kind;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      for (const [purpose, geometries] of byPurpose) {
        const merged = mergeGeometries(geometries);
        for (const geometry of geometries) geometry.dispose();
        const surface = stoneFor(layout.id, purpose);
        const material =
          surface === undefined
            ? gridMaterial(PURPOSE_COLOURS[purpose])
            : gridMaterial(PURPOSE_COLOURS[purpose], { surface, load: stone() });
        const mesh = new Mesh(merged, material);
        mesh.name = purpose;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      // Tagged surface regions (mw-1jm): a flat patch of the surface's colour on the floor it covers.
      const patches = surfacePatches(layout.parts, layout.surfaces);
      const bySurface = new Map<string, BufferGeometry[]>();
      for (const patch of patches) {
        const plane = new PlaneGeometry(patch.maxX - patch.minX, patch.maxZ - patch.minZ);
        plane.rotateX(-Math.PI / 2);
        plane.translate((patch.minX + patch.maxX) / 2, patch.y, (patch.minZ + patch.maxZ) / 2);
        const list = bySurface.get(patch.surface) ?? [];
        list.push(plane);
        bySurface.set(patch.surface, list);
      }
      for (const [surface, geometries] of bySurface) {
        const merged = mergeGeometries(geometries);
        for (const geometry of geometries) geometry.dispose();
        const colour = SURFACE_COLOURS[surface as keyof typeof SURFACE_COLOURS];
        const mesh = new Mesh(merged, gridMaterial(colour));
        mesh.name = `surface:${surface}`;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      fitSun(layout.parts);
      scene.add(group);
      return group;
    },

    spawn(spawn) {
      const group = new Group();
      group.name = `spawn:${spawn.id}`;
      let mesh: Mesh;
      if (spawn.targetable !== undefined && spawn.prop === undefined) {
        // A lock-on target (mw-e02.16): a training-dummy post with a crossbar, about 1.8 m tall.
        const post = new BoxGeometry(0.3, 1.8, 0.3).translate(0, 0.9, 0);
        const arms = new BoxGeometry(1.1, 0.2, 0.2).translate(0, 1.3, 0);
        mesh = new Mesh(mergeGeometries([post, arms]), gridMaterial(PURPOSE_COLOURS.interactive));
        post.dispose();
        arms.dispose();
      } else if (spawn.container !== undefined && spawn.prop === undefined) {
        // A container (mw-e18.3): a chest-sized box standing on the spawn point.
        mesh = new Mesh(new BoxGeometry(0.9, 0.6, 0.6), gridMaterial(PURPOSE_COLOURS.interactive));
        mesh.position.y = 0.3;
      } else if (spawn.prop === undefined && spawn.rope !== undefined) {
        // A rope or chain (mw-e03.13): a thin cylinder from the spawn point to its other anchor, or
        // straight down. It leaves with the entity, so a burnt or snapped rope vanishes.
        const { rope } = spawn;
        const to = rope.to ?? {
          x: spawn.position.x,
          y: spawn.position.y - rope.length,
          z: spawn.position.z,
        };
        const along = new Vector3(
          to.x - spawn.position.x,
          to.y - spawn.position.y,
          to.z - spawn.position.z,
        );
        const width = Math.max(MIN_ROPE_WIDTH, (rope.radius ?? 0.05) * 2) / 2;
        mesh = new Mesh(
          new CylinderGeometry(width, width, along.length(), 6),
          new MeshStandardMaterial({
            color: new Color(rope.support?.resistances.pierce === 1 ? CHAIN_COLOUR : ROPE_COLOUR),
            // A little glow, so a thin rope still reads across a dim room.
            emissive: new Color(
              rope.support?.resistances.pierce === 1 ? CHAIN_COLOUR : ROPE_COLOUR,
            ),
            emissiveIntensity: 0.4,
            roughness: 0.9,
          }),
        );
        mesh.position.copy(along).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), along.normalize());
      } else if (
        spawn.prop === undefined &&
        (spawn.properties !== undefined || spawn.lightSource !== undefined)
      ) {
        // A placed light (a torch): a small bracket under where its flame burns. The flame and
        // its light come from the light rig, which mirrors the sim (src/render/light).
        mesh = new Mesh(
          new BoxGeometry(0.1, 0.35, 0.1).translate(0, -0.25, 0),
          new MeshStandardMaterial({ color: new Color(BRACKET_COLOUR), roughness: 0.8 }),
        );
      } else if (spawn.prop === undefined && spawn.tags.includes('sign')) {
        // A sign (mw-ju8.42): a flat board at its own height, facing the way the spawn faces, not a
        // cone floating in the air.
        mesh = new Mesh(
          new BoxGeometry(SIGN_BOARD[0], SIGN_BOARD[1], SIGN_BOARD[2]),
          new MeshStandardMaterial({ color: new Color(SIGN_COLOUR), roughness: 0.8 }),
        );
      } else if (spawn.prop === undefined && MARKER_CONE_TAGS.some((t) => spawn.tags.includes(t))) {
        // An arrival or the start point: a flat cone lying down, pointing the way the spawn faces
        // (+z at yaw 0). It stands on the ground, so it cannot mislead.
        mesh = new Mesh(
          new ConeGeometry(0.3, 0.8, 12),
          new MeshStandardMaterial({ color: new Color(MARKER_COLOUR), roughness: 0.6 }),
        );
        mesh.rotation.x = Math.PI / 2;
        mesh.position.y = 0.3;
      } else if (spawn.prop === undefined) {
        // Any other marker (a banner, a path, a bridge end): a small flat disc, so it does not
        // read as a thing in the world (mw-ju8.42).
        mesh = new Mesh(
          new CylinderGeometry(0.15, 0.15, 0.02, 12),
          new MeshStandardMaterial({ color: new Color(MARKER_COLOUR), roughness: 0.6 }),
        );
      } else {
        mesh = new Mesh(
          new BoxGeometry(0.7, 0.7, 0.7),
          spawn.prop === 'crate' ? crateFaces() : gridMaterial(PURPOSE_COLOURS.interactive),
        );
        mesh.position.y = 0.35;
      }
      mesh.name =
        spawn.prop ??
        (spawn.container !== undefined
          ? 'container'
          : spawn.rope !== undefined
            ? 'rope'
            : spawn.tags.includes('sign')
              ? 'sign'
              : 'marker');
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      // A torch or a brazier (mw-546): its model takes the bracket's place once loaded (the bracket
      // stays if it never loads). The flame and light are the light rig's, at this spawn point.
      if (spawn.container !== undefined && spawn.prop === undefined) {
        void loadChest().then(
          (model) => {
            mesh.visible = false;
            const chest = new Mesh(model.geometry, model.material);
            chest.name = 'chest';
            chest.castShadow = true;
            chest.receiveShadow = true;
            group.add(chest);
          },
          (error: unknown) => {
            console.warn('The chest model did not load; keeping the stand-in.', error);
          },
        );
      }
      const isTorch = spawn.tags.includes('torch');
      if (spawn.prop === undefined && (isTorch || spawn.tags.includes('brazier'))) {
        const loaded = isTorch ? loadTorch() : loadBrazier(spawn.position.y);
        void loaded.then(
          (model) => {
            mesh.visible = false;
            const piece = new Mesh(model.geometry, model.material);
            piece.name = isTorch ? 'torch' : 'brazier';
            piece.castShadow = true;
            piece.receiveShadow = true;
            // Its wall plate is on −x; a torch on the east side of the room turns to put it on +x.
            if (isTorch && spawn.position.x > 0) piece.rotation.y = Math.PI;
            group.add(piece);
          },
          (error: unknown) => {
            console.warn(
              `The ${isTorch ? 'torch' : 'brazier'} model did not load; keeping the stand-in.`,
              error,
            );
          },
        );
      }
      scene.add(group);
      return group;
    },

    body(spawn, size) {
      const group = new Group();
      group.name = `body:${spawn.id}`;
      const mesh = new Mesh(
        new BoxGeometry(size.x, size.y, size.z),
        spawn.prop === 'crate' ? crateFaces() : gridMaterial(PURPOSE_COLOURS.interactive),
      );
      mesh.name = spawn.prop ?? 'body';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      scene.add(group);
      return group;
    },

    piece(piece, parts, crack) {
      const group = new Group();
      group.name = `piece:${piece.piece}:${String(piece.placement)}`;
      const geometries = parts.map(partGeometry);
      const mesh = new Mesh(
        mergeGeometries(geometries),
        gridMaterial(PURPOSE_COLOURS[piece.purpose]),
      );
      for (const geometry of geometries) geometry.dispose();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      if (crack) {
        const lines = parts.filter((part) => part.shape === 'box').map(crackGeometry);
        if (lines.length > 0) {
          const cracks = new Mesh(
            mergeGeometries(lines),
            new MeshStandardMaterial({ color: new Color(CRACK_COLOUR), roughness: 1 }),
          );
          for (const line of lines) line.dispose();
          cracks.name = 'cracks';
          group.add(cracks);
        }
      }
      scene.add(group);
      return group;
    },

    setEnvironment(environment) {
      sky.intensity = renderIntensity(environment.ambient, sky.color);
      const key = environment.directional.reduce<(typeof environment.directional)[number] | null>(
        (best, light) => (best === null || light.level > best.level ? light : best),
        null,
      );
      // Floor-referenced: a directional light of level L brightens a floor as much as a torch of
      // level L right above it, whatever its elevation (the sim's level has no angle term).
      sun.intensity =
        key === null
          ? 0
          : renderIntensity(key.level, sun.color) / Math.max(0.2, Math.abs(key.direction.y));
      sun.castShadow = key !== null;
      if (key !== null) {
        const { x, y, z } = key.direction;
        sunDirection.set(-x, -y, -z).normalize();
      }
      fitSun(fitted);
    },

    dispose() {
      stoneLoad?.map.dispose();
      stoneLoad = undefined;
      sun.shadow.dispose();
      scene.remove(sky, sun, sun.target);
    },
  };
}
