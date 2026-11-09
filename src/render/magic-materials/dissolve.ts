// Dissolve (mw-e29.7): a body breaks up along a noise field and burns away at the edge, for deaths,
// summons (run it backwards) and illusion fades. It works on the object's own material copies
// (clone.ts), patched through onBeforeCompile so it handles skinned meshes and keeps their lighting,
// and gives the mesh matching depth materials so its shadow dissolves with it. One program is shared
// by every dissolving thing; progress, tint and seed are uniforms of each copy set, so dissolving one
// skeleton never dissolves another.
//
//   progress 0  whole, no edge       progress 1  gone
//
// The edge chars the surface, then glows in the tint (additive emissive); nothing flashes, the glow
// is steady and only moves with the dissolve front.
//
// Render-only; verified by tests/integration/magic-materials.test.ts and e2e/magic-materials.spec.ts.

import {
  Color,
  Mesh,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  RGBADepthPacking,
  Vector3,
  type Material,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { resolveMagicLook, type MagicLook } from './rules';
import { cloneMaterials, type MaterialCopies } from './clone';

export interface DissolveOptions extends Partial<MagicLook> {
  /** Width of the burning edge, in field units (0.02 … 0.3; default 0.12). */
  readonly edge?: number;
  /** Noise cells per metre (default 3.2). */
  readonly scale?: number;
  /** How much the dissolve sweeps from the top down instead of through noise alone, 0 … 1. */
  readonly sweep?: number;
  /** World y of the feet and the height of the thing, for the sweep. */
  readonly feet?: number;
  readonly height?: number;
  /** Varies the noise from thing to thing. */
  readonly seed?: number;
}

const PROGRAM_KEY = 'magic-dissolve-v1';

const UNIFORMS = /* glsl */ `
uniform float uDissolve;
uniform vec3 uDissolveSeed;
uniform float uDissolveScale;
uniform float uDissolveEdge;
uniform vec3 uDissolveTint;
uniform float uDissolveGlow;
uniform vec3 uDissolveSweep;
varying vec3 vDissolveWorld;
float dsHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float dsNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dsHash(i), dsHash(i + vec3(1, 0, 0)), f.x), mix(dsHash(i + vec3(0, 1, 0)), dsHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(dsHash(i + vec3(0, 0, 1)), dsHash(i + vec3(1, 0, 1)), f.x), mix(dsHash(i + vec3(0, 1, 1)), dsHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// Where this fragment falls on the dissolve: negative is already gone, 0 … edge is the burning rim.
float dissolveDistance() {
  vec3 p = vDissolveWorld * uDissolveScale + uDissolveSeed;
  float n = 0.62 * dsNoise(p) + 0.38 * dsNoise(p * 2.7 + 7.1);
  n = clamp((n - 0.2) / 0.6, 0.0, 1.0);
  float h = clamp((vDissolveWorld.y - uDissolveSweep.x) / max(uDissolveSweep.y, 0.001), 0.0, 1.0);
  float field = mix(n, 1.0 - h, uDissolveSweep.z);
  return field - uDissolve * (1.0 + uDissolveEdge) + uDissolveEdge;
}
`;

const DECIDE = /* glsl */ `
float dissolveD = dissolveDistance();
if (dissolveD < 0.0) discard;
`;

/** Shader patch shared by the body, depth and distance materials. */
function patch(
  material: Material,
  uniforms: Record<string, { value: unknown }>,
  surface: boolean,
): void {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vDissolveWorld;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvDissolveWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    let fragment = shader.fragmentShader
      .replace('void main() {', `${UNIFORMS}\nvoid main() {`)
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>\n${DECIDE}`,
      );
    if (surface) {
      fragment = fragment
        .replace(
          '#include <color_fragment>',
          [
            '#include <color_fragment>',
            // Charred just inside the rim, before the glow.
            'diffuseColor.rgb *= 1.0 - 0.9 * (1.0 - smoothstep(0.0, uDissolveEdge * 3.4, dissolveD)) * step(0.0001, uDissolve);',
          ].join('\n'),
        )
        .replace(
          '#include <emissivemap_fragment>',
          [
            '#include <emissivemap_fragment>',
            'float dissolveRim = (1.0 - smoothstep(0.0, uDissolveEdge, dissolveD)) * step(0.0001, uDissolve);',
            'totalEmissiveRadiance += pow(uDissolveTint, vec3(1.5)) * (dissolveRim * dissolveRim * uDissolveGlow);',
          ].join('\n'),
        );
    }
    shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () => `${PROGRAM_KEY}:${surface ? 'surface' : 'depth'}`;
  material.needsUpdate = true;
}

interface DepthPair {
  readonly mesh: Mesh;
  readonly depth: Material | undefined;
  readonly distance: Material | undefined;
}

/** A dissolve applied to one object. */
export class Dissolve {
  readonly #copies: MaterialCopies;
  readonly #depths: DepthPair[] = [];
  readonly #own: Material[] = [];
  readonly #uniforms: Record<string, { value: unknown }>;
  readonly #progressUniform = { value: 0 };
  readonly #tint = { value: new Color() };
  readonly #glow = { value: 1 };
  #look: MagicLook;
  #progress = 0;

  constructor(root: Object3D, options: DissolveOptions = {}) {
    this.#look = resolveMagicLook(options);
    const seed = options.seed ?? 0;
    const edge = Math.min(Math.max(options.edge ?? 0.12, 0.02), 0.3);
    this.#uniforms = {
      uDissolve: this.#progressUniform,
      uDissolveSeed: { value: new Vector3(seed * 13.7, seed * 7.3 + 3.1, seed * 3.9 + 8.2) },
      uDissolveScale: { value: options.scale ?? 3.2 },
      uDissolveEdge: { value: edge },
      uDissolveTint: this.#tint,
      uDissolveGlow: this.#glow,
      uDissolveSweep: {
        value: new Vector3(
          options.feet ?? 0,
          options.height ?? 1.8,
          Math.min(Math.max(options.sweep ?? 0, 0), 1),
        ),
      },
    };
    this.#applyLook();
    this.#copies = cloneMaterials(root);
    for (const clone of this.#copies.clones) patch(clone, this.#uniforms, true);
    for (const mesh of this.#copies.meshes) {
      const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
      const distance = new MeshDistanceMaterial();
      patch(depth, this.#uniforms, false);
      patch(distance, this.#uniforms, false);
      this.#depths.push({
        mesh,
        depth: mesh.customDepthMaterial,
        distance: mesh.customDistanceMaterial,
      });
      this.#own.push(depth, distance);
      mesh.customDepthMaterial = depth;
      mesh.customDistanceMaterial = distance;
    }
  }

  get progress(): number {
    return this.#progress;
  }

  /** Materials this dissolve made (one set per mesh); for tests and diagnostics. */
  get materials(): readonly Material[] {
    return this.#copies.clones;
  }

  /** How far the body has dissolved: 0 whole … 1 gone. */
  setProgress(progress: number): void {
    this.#progress = Math.min(Math.max(progress, 0), 1);
    this.#progressUniform.value = this.#progress;
  }

  /** Changes the tint and strength of the burning edge. */
  setLook(look: Partial<MagicLook>): void {
    this.#look = resolveMagicLook({ ...this.#look, ...look });
    this.#applyLook();
  }

  /** Puts the object's own materials back and frees the copies. */
  dispose(): void {
    for (const { mesh, depth, distance } of this.#depths) {
      mesh.customDepthMaterial = depth;
      mesh.customDistanceMaterial = distance;
    }
    for (const material of this.#own) material.dispose();
    this.#own.length = 0;
    this.#depths.length = 0;
    this.#copies.restore();
  }

  #applyLook(): void {
    this.#tint.value.set(this.#look.tint);
    this.#glow.value = 2.6 * this.#look.intensity;
  }
}

/** Makes `root` dissolvable with its own material copies (see Dissolve). */
export function applyDissolve(root: Object3D, options: DissolveOptions = {}): Dissolve {
  return new Dissolve(root, options);
}
