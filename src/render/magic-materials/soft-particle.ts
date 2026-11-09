// Soft particles with depth fade (mw-e29.7): a camera-facing puff that fades out where it meets
// solid geometry, so smoke, glow and mist never cut a hard line through the floor or a wall. Depth
// comes from the SoftDepthPass, which draws only while a soft particle exists; when no depth is
// available (Low, or before the first depth frame) the puff just fades by its own rim. Additive or
// alpha; tint and intensity set colour and strength. Static: nothing here animates or flashes.
//
// Render-only; verified by tests/integration/magic-materials.test.ts and e2e/magic-materials.spec.ts.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  type Camera,
  type PerspectiveCamera,
  type Scene,
  type Texture,
} from 'three';
import { resolveMagicLook, type MagicLook } from './rules';
import type { DepthRenderer, SoftDepthPass } from './passes';
import { uniform } from './uniforms';

const VERTEX = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vec4 view = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  view.xy += position.xy * uSize;
  gl_Position = projectionMatrix * view;
  vUv = uv;
}
`;

const FRAGMENT = /* glsl */ `
#include <packing>
uniform sampler2D uDepth;
uniform float uDepthOn;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uSoftness;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uAdditive;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  float puff = (1.0 - smoothstep(0.1, 1.0, r));
  puff *= puff * (0.65 + 0.7 * noise(vUv * 5.0));
  float fade = 1.0;
  if (uDepthOn > 0.5) {
    float sceneZ = -perspectiveDepthToViewZ(texture2D(uDepth, gl_FragCoord.xy / uResolution).x, uNear, uFar);
    float partZ = -perspectiveDepthToViewZ(gl_FragCoord.z, uNear, uFar);
    fade = clamp((sceneZ - partZ) / uSoftness, 0.0, 1.0);
  }
  float a = clamp(puff * fade * uIntensity, 0.0, 1.0);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * mix(1.0, a, uAdditive), a);
}
`;

export interface SoftParticleOptions extends Partial<MagicLook> {
  /** Width of the puff in metres (default 1.5). */
  readonly size?: number;
  /** Metres over which it fades out ahead of a surface (default 0.6). */
  readonly softness?: number;
  /** Additive glow (default) or alpha-blended smoke. */
  readonly blend?: 'additive' | 'alpha';
  /** False draws it with no depth fade at all (a hard-edged puff, for comparison). */
  readonly soft?: boolean;
}

function quad(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
      3,
    ),
  );
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

const resolution = new Vector2();

export class SoftParticle {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  readonly #release: (() => void) | undefined;

  constructor(
    pass: SoftDepthPass,
    depthAvailable: () => boolean,
    options: SoftParticleOptions = {},
  ) {
    const look = resolveMagicLook(options);
    const additive = (options.blend ?? 'additive') === 'additive';
    const soft = options.soft ?? true;
    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uDepth: { value: null as Texture | null },
        uDepthOn: { value: 0 },
        uResolution: { value: new Vector2(1, 1) },
        uNear: { value: 0.1 },
        uFar: { value: 200 },
        uSoftness: { value: options.softness ?? 0.6 },
        uColor: { value: new Color().setHex(look.tint, 'srgb-linear') },
        uIntensity: { value: look.intensity },
        uAdditive: { value: additive ? 1 : 0 },
        uSize: { value: options.size ?? 1.5 },
      },
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    material.toneMapped = false;
    this.mesh = new Mesh(quad(), material);
    this.mesh.name = 'magic:soft-particle';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 11 : 10;
    this.#release = soft ? pass.acquire() : undefined;
    this.mesh.onBeforeRender = (renderer, scene: Scene, camera: Camera) => {
      if (!soft) return;
      const r = renderer as unknown as DepthRenderer;
      if (depthAvailable()) pass.update(r, scene, camera);
      const depth = depthAvailable() ? pass.texture : undefined;
      uniform<number>(material, 'uDepthOn').value = depth === undefined ? 0 : 1;
      uniform<Texture | null>(material, 'uDepth').value = depth ?? null;
      r.getDrawingBufferSize(resolution);
      uniform<Vector2>(material, 'uResolution').value.copy(resolution);
      const perspective = camera as PerspectiveCamera;
      uniform<number>(material, 'uNear').value = perspective.near;
      uniform<number>(material, 'uFar').value = perspective.far;
    };
  }

  setLook(look: Partial<MagicLook>): void {
    const next = resolveMagicLook(look);
    const material = this.mesh.material;
    if (look.tint !== undefined) {
      uniform<Color>(material, 'uColor').value.setHex(next.tint, 'srgb-linear');
    }
    if (look.intensity !== undefined)
      uniform<number>(material, 'uIntensity').value = next.intensity;
  }

  dispose(): void {
    this.#release?.();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
