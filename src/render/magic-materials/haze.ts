// Heat haze / distortion (mw-e29.7), High only: a camera-facing patch that shows the frame behind it
// shifted by a rising noise field, for fire, gravity lensing and illusion shimmer. The frame comes
// from the DistortionPass, copied once per frame just before the first haze draws; the patch fades
// out at its rim so no edge shows, and things in front of it hide it (it is depth tested). Tint
// adds a faint wash; intensity scales how far the picture is pushed. In reduced motion the field
// holds still and pushes half as far. Nothing here flashes.
//
// Low has no haze at all: the library never builds one (see MagicMaterials.heatHaze), so no frame
// copy is ever made.
//
// Render-only; verified by tests/integration/magic-materials.test.ts and e2e/magic-materials.spec.ts.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  type Texture,
} from 'three';
import { resolveMagicLook, type MagicLook } from './rules';
import type { DistortionPass, DistortionRenderer } from './passes';
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
uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uTime;
uniform float uStrength;
uniform vec3 uTint;
uniform float uWash;
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
  float mask = 1.0 - smoothstep(0.35, 1.0, length(c));
  if (mask <= 0.001) discard;
  // Rising, wavering flow: two octaves drifting upward.
  vec2 flow = vec2(0.0, -uTime);
  vec2 p = vUv * vec2(4.0, 5.0);
  vec2 d = vec2(noise(p + flow) + 0.5 * noise(p * 2.1 + flow * 1.7),
                noise(p + 17.3 + flow) + 0.5 * noise(p * 2.1 + 9.1 + flow * 1.7)) / 1.5 - 0.5;
  // Offsets are a fraction of the screen's height, so the push looks the same at any resolution.
  vec2 offset = d * 2.0 * uStrength * mask * vec2(uResolution.y / uResolution.x, 1.0);
  vec2 uv = clamp(gl_FragCoord.xy / uResolution + offset, vec2(0.001), vec2(0.999));
  vec3 colour = texture2D(uScene, uv).rgb;
  colour = mix(colour, colour * (0.6 + uTint) + uTint * 0.05, uWash * mask);
  gl_FragColor = vec4(colour, smoothstep(0.0, 0.2, mask));
}
`;

export interface HeatHazeOptions extends Partial<MagicLook> {
  /** Width of the patch in metres (default 1.6). */
  readonly size?: number;
}

/** Distortion as a fraction of screen height at intensity 1. */
const STRENGTH = 0.012;

/** A unit quad centred on the origin (the vertex shader scales it in view space). */
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

export class HeatHaze {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  #look: MagicLook;
  #time = 0;
  #reduced = false;

  constructor(pass: DistortionPass, options: HeatHazeOptions = {}) {
    this.#look = resolveMagicLook(options);
    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uScene: { value: null as Texture | null },
        uResolution: { value: new Vector2(1, 1) },
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uTint: { value: new Color() },
        uWash: { value: 0 },
        uSize: { value: options.size ?? 1.6 },
      },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    material.toneMapped = false;
    this.mesh = new Mesh(quad(), material);
    this.mesh.name = 'magic:heat-haze';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12; // over the particles (10, 11), so smoke and sparks bend too
    this.mesh.onBeforeRender = (renderer) => {
      const r = renderer as unknown as DistortionRenderer;
      uniform<Texture | null>(material, 'uScene').value = pass.capture(r);
      r.getDrawingBufferSize(resolution);
      uniform<Vector2>(material, 'uResolution').value.copy(resolution);
    };
    this.#apply();
  }

  /** Changes the tint and strength. */
  setLook(look: Partial<MagicLook>): void {
    this.#look = resolveMagicLook({ ...this.#look, ...look });
    this.#apply();
  }

  /** Moves the flow to running time `seconds`; reduced motion holds it still and halves the push. */
  update(seconds: number, reducedMotion: boolean): void {
    if (reducedMotion !== this.#reduced) {
      this.#reduced = reducedMotion;
      this.#apply();
    }
    if (!reducedMotion) this.#time = seconds * 0.5;
    uniform<number>(this.mesh.material, 'uTime').value = this.#time;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  #apply(): void {
    const material = this.mesh.material;
    uniform<number>(material, 'uStrength').value =
      STRENGTH * this.#look.intensity * (this.#reduced ? 0.5 : 1);
    uniform<Color>(material, 'uTint').value.setHex(this.#look.tint, 'srgb-linear');
    uniform<number>(material, 'uWash').value = Math.min(0.14 * this.#look.intensity, 0.5);
  }
}
