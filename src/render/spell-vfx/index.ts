// Drawing the spell VFX slots that are not particles (mw-e29.10): the area ring and the beam.
//
// - The area ring is the magical material library's rune decal (src/render/magic-materials/rune.ts)
//   with its radius set to the spell radius, so its plane reaches exactly the radius, tinted by the
//   template/spell tint; it grows out from the centre over the template's `growSeconds`
//   (./rules.ts) and, like every decal, is updated by `MagicMaterials`.
// - The beam is two crossed strips (so it reads from any side) between its two sockets, one
//   ShaderMaterial for all: a soft bright core across the width and energy streaming along the
//   length. `setEnds` moves it (called every frame for live beams only); the shader clock is one
//   shared uniform, so a live beam costs a quaternion and a scale per frame and no allocation.
//
// Render-only (needs a GPU context): the surfaces' contract is tested headless in
// tests/integration/spell-vfx.test.ts; the drawing is verified by e2e/spell-vfx.spec.ts.

import type { Vec3 } from '@sim/index';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Object3D,
  type Scene,
} from 'three';
import { MAX_MAGIC_PULSE_HZ } from '../magic-materials/rules';
import type { MagicMaterials } from '../magic-materials/index';
import type { RuneDecal } from '../magic-materials/rune';
import {
  ringScale,
  type BeamDrawing,
  type BeamSpec,
  type RingDrawing,
  type RingSpec,
  type SpellVfxSurfaces,
} from './rules';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
uniform float uScroll;
uniform float uLength;
uniform float uPulse;
varying vec2 vUv;
void main() {
  float across = abs(vUv.y - 0.5) * 2.0;
  float core = pow(1.0 - across, 2.5);
  float halo = pow(1.0 - across, 1.0) * 0.35;
  // Energy streaming from the start to the end, a few bands per metre.
  float stream = 0.72 + 0.28 * sin((vUv.x * uLength * 3.0 - uTime * uScroll) * 6.2831853);
  // Fade at both ends so the strip has no hard cut.
  float ends = smoothstep(0.0, 0.04, vUv.x) * smoothstep(0.0, 0.04, 1.0 - vUv.x);
  float breathe = uPulse > 0.0 ? 0.775 + 0.225 * sin(6.2831853 * uPulse * uTime) : 1.0;
  float a = clamp((core * stream + halo) * ends * uAlpha * breathe, 0.0, 1.0);
  vec3 hot = mix(uColor, vec3(1.0), core * 0.55);
  gl_FragColor = vec4(hot * a, a);
}
`;

const X = new Vector3(1, 0, 0);

const hexNumber = (hex: string): number => Number.parseInt(hex.slice(1), 16);

/** Draws spell rings and beams into `scene`. Call `update` once a frame with the frame's seconds. */
export class SpellVfxView implements SpellVfxSurfaces {
  readonly #scene: Scene;
  readonly #magic: MagicMaterials;
  readonly #reduced: () => boolean;
  readonly #beamGeometry = new PlaneGeometry(1, 1);
  readonly #rings = new Set<{ decal: RuneDecal; elapsed: number; grow: number }>();
  readonly #clock = { value: 0 };
  #beams = 0;
  readonly #direction = new Vector3();
  readonly #quaternion = new Quaternion();

  constructor(scene: Scene, magic: MagicMaterials, reducedMotion: () => boolean = () => false) {
    this.#scene = scene;
    this.#magic = magic;
    this.#reduced = reducedMotion;
  }

  /** Whether anything is drawn (`update` has work only then). */
  get active(): boolean {
    return this.#rings.size > 0 || this.#beams > 0;
  }

  /** Rings and beams currently drawn (for the e2e probe). */
  get drawn(): { rings: number; beams: number } {
    return { rings: this.#rings.size, beams: this.#beams };
  }

  /** A rune ring on the ground whose plane reaches `radius` metres. */
  openRing(spec: { centre: Vec3; radius: number; ring: RingSpec }): RingDrawing {
    const { ring, radius, centre } = spec;
    const decal = this.#magic.runeDecal({
      radius,
      tint: hexNumber(ring.tint),
      intensity: ring.intensity,
      spin: ring.spin,
      pulseHz: Math.min(ring.pulseHz, MAX_MAGIC_PULSE_HZ),
    });
    decal.mesh.position.set(centre.x, centre.y + 0.03, centre.z);
    this.#scene.add(decal.mesh);
    const live = { decal, elapsed: 0, grow: ring.growSeconds };
    this.#rings.add(live);
    decal.mesh.scale.setScalar(ringScale(0, ring.growSeconds, this.#reduced()));
    return {
      close: () => {
        this.#rings.delete(live);
        decal.dispose();
      },
    };
  }

  /** A beam strip; `setEnds` places it. */
  openBeam(spec: BeamSpec): BeamDrawing {
    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uColor: { value: new Color().setHex(hexNumber(spec.tint), 'srgb-linear') },
        uAlpha: { value: spec.alpha },
        uTime: this.#clock,
        uScroll: { value: spec.scrollSpeed },
        uLength: { value: 1 },
        // Breathing rate, capped like every magical pulse and held steady in reduced motion.
        uPulse: { value: this.#reduced() ? 0 : Math.min(spec.pulseHz, MAX_MAGIC_PULSE_HZ) },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    material.toneMapped = false;
    const group = new Group();
    group.name = 'spell:beam';
    const strips: Object3D[] = [];
    for (const roll of [0, Math.PI / 2]) {
      const strip = new Mesh(this.#beamGeometry, material);
      strip.rotation.x = roll;
      strip.renderOrder = 11;
      strip.frustumCulled = false;
      group.add(strip);
      strips.push(strip);
    }
    group.visible = false;
    this.#scene.add(group);
    this.#beams++;
    const length = material.uniforms['uLength'] as { value: number };
    return {
      setEnds: (start, end) => {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const dz = end.z - start.z;
        const span = Math.hypot(dx, dy, dz);
        if (span < 1e-4) {
          group.visible = false;
          return;
        }
        this.#direction.set(dx / span, dy / span, dz / span);
        // The strip's long axis is x: turn x to the beam direction, keeping the roll about it.
        this.#quaternion.setFromUnitVectors(X, this.#direction);
        group.quaternion.copy(this.#quaternion);
        group.position.set((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
        group.scale.set(span, spec.width, spec.width);
        length.value = span;
        group.visible = true;
      },
      close: () => {
        this.#beams--;
        group.removeFromParent();
        material.dispose();
      },
    };
  }

  /** Grows the rings and runs the beams' shared clock. Does nothing with none drawn. */
  update(seconds: number): void {
    this.#clock.value += seconds;
    const reduced = this.#reduced();
    for (const ring of this.#rings) {
      ring.elapsed += seconds;
      ring.decal.mesh.scale.setScalar(ringScale(ring.elapsed, ring.grow, reduced));
    }
  }
}
