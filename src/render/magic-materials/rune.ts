// Rune decal (mw-e29.7): a ring of runes laid on the ground, for conjuration circles, wards and
// spell targets. The runes are Hornfolk-style (style bible §5.3): one continuous meander line that
// turns at right angles and never ends, between two thin rings, drawn procedurally into a small
// texture so no asset is needed. It lies flat on the plane it is placed on (a projection onto the
// ground plane; see the follow-up bead for projection onto uneven surfaces), additive, and turns
// slowly (not in reduced motion). Tint and intensity set colour and glow.
//
// Render-only; verified by tests/integration/magic-materials.test.ts and e2e/magic-materials.spec.ts.

import {
  AdditiveBlending,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
} from 'three';
import { magicPulse, resolveMagicLook, type MagicLook } from './rules';
import { uniform } from './uniforms';

/** Meander repeats around the ring. */
const REPEATS = 14;
/** Pixels per repeat across and the band's height. */
const TILE = 64;

/** One repeat of the meander in tile pixels: a line that steps in, doubles back and carries on. */
const MEANDER: readonly (readonly [number, number])[] = [
  [0, 46],
  [12, 46],
  [12, 14],
  [44, 14],
  [44, 38],
  [27, 38],
  [27, 26],
  [56, 26],
  [56, 46],
  [64, 46],
];

function distanceToSegment(
  px: number,
  py: number,
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.min(Math.max(((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy), 0), 1);
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/** The meander band: REPEATS tiles wide, one tile tall, white strokes with soft edges. */
export function runeTexture(): DataTexture {
  const width = TILE * REPEATS;
  const height = TILE;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tx = x % TILE;
      let d = 99;
      MEANDER.forEach((to, i) => {
        const from = MEANDER[i - 1];
        if (from !== undefined) d = Math.min(d, distanceToSegment(tx + 0.5, y + 0.5, from, to));
      });
      // Thin rings along both edges of the band.
      d = Math.min(d, Math.abs(y + 0.5 - 3) + 0.5, Math.abs(y + 0.5 - (height - 3)) + 0.5);
      const alpha = Math.min(Math.max(1 - (d - 2.2) / 1.6, 0), 1);
      const i = (y * width + x) * 4;
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new DataTexture(pixels, width, height, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uRunes;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uSpin;
varying vec2 vUv;
const float TAU = 6.28318530718;
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  float angle = atan(c.y, c.x) / TAU + 0.5 + uSpin;
  // Meander band between 62 % and 90 % of the radius.
  float v = (r - 0.62) / 0.28;
  float band = (v >= 0.0 && v <= 1.0) ? texture2D(uRunes, vec2(angle, 1.0 - v)).a : 0.0;
  // Outer ring, inner ring and a faint disc of light under it all.
  float outer = 1.0 - smoothstep(0.0, 0.012, abs(r - 0.965));
  float inner = 1.0 - smoothstep(0.0, 0.01, abs(r - 0.54));
  float disc = (1.0 - smoothstep(0.0, 0.6, r)) * 0.10;
  float edge = 1.0 - smoothstep(0.9, 1.0, r);
  float a = clamp((band + outer * 0.8 + inner * 0.6 + disc) * edge * uIntensity, 0.0, 1.0);
  gl_FragColor = vec4(uColor * a, a);
}
`;

export interface RuneDecalOptions extends Partial<MagicLook> {
  /** Radius in metres (default 1.4). */
  readonly radius?: number;
  /** Turns per second (default 0.04; 0 = still). */
  readonly spin?: number;
  /** Breathing rate in hertz (0 = steady, the default; capped at MAX_MAGIC_PULSE_HZ). */
  readonly pulseHz?: number;
}

let sharedTexture: DataTexture | undefined;

export class RuneDecal {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly #spin: number;
  readonly #hz: number;
  #intensity: number;

  constructor(options: RuneDecalOptions = {}) {
    const look = resolveMagicLook(options);
    sharedTexture ??= runeTexture();
    this.#spin = options.spin ?? 0.04;
    this.#hz = options.pulseHz ?? 0;
    this.#intensity = look.intensity;
    const radius = options.radius ?? 1.4;
    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uRunes: { value: sharedTexture },
        uColor: { value: new Color().setHex(look.tint, 'srgb-linear') },
        uIntensity: { value: look.intensity },
        uSpin: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      // Lies on the ground without z-fighting it.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    material.toneMapped = false;
    this.mesh = new Mesh(new PlaneGeometry(radius * 2, radius * 2), material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 9;
    this.mesh.name = 'magic:rune-decal';
  }

  setLook(look: Partial<MagicLook>): void {
    const next = resolveMagicLook({ intensity: this.#intensity, ...look });
    this.#intensity = next.intensity;
    if (look.tint !== undefined) {
      uniform<Color>(this.mesh.material, 'uColor').value.setHex(next.tint, 'srgb-linear');
    }
  }

  /** Turns and breathes; call each frame with the running time. */
  update(seconds: number, reducedMotion: boolean): void {
    const material = this.mesh.material;
    uniform<number>(material, 'uSpin').value = reducedMotion ? 0 : (seconds * this.#spin) % 1;
    uniform<number>(material, 'uIntensity').value =
      this.#intensity * magicPulse(this.#hz, seconds, reducedMotion);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
