// Fresnel glow (mw-e29.7): a shell that glows at the grazing edges of a body and fades to nothing
// face-on, for rims on summoned things, shields and charged bodies. A shell is drawn over each mesh
// of the target (skinned meshes keep their skeleton, so it follows the animation), additive and
// without writing depth. Tint and intensity set the colour and strength; a pulse (never above
// MAX_MAGIC_PULSE_HZ, steady in reduced motion) breathes it.
//
// Render-only; verified by tests/integration/magic-materials.test.ts and e2e/magic-materials.spec.ts.

import {
  AdditiveBlending,
  Color,
  Mesh,
  ShaderMaterial,
  SkinnedMesh,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { magicPulse, resolveMagicLook, type MagicLook } from './rules';
import { uniform } from './uniforms';

const VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vFresnelNormal;
varying vec3 vFresnelView;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vFresnelNormal = normalize(transformedNormal);
  vFresnelView = normalize(-mvPosition.xyz);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uPower;
varying vec3 vFresnelNormal;
varying vec3 vFresnelView;
void main() {
  float facing = clamp(dot(normalize(vFresnelNormal), normalize(vFresnelView)), 0.0, 1.0);
  float rim = pow(1.0 - facing, uPower);
  float a = clamp(rim * uIntensity, 0.0, 1.0);
  // Additive: premultiplied by alpha, written as-is (colours are authored in sRGB).
  gl_FragColor = vec4(uColor * a * 1.4, a);
}
`;

export interface FresnelOptions extends Partial<MagicLook> {
  /** Falloff exponent: higher is a thinner rim (default 2.6). */
  readonly power?: number;
  /** Breathing rate in hertz (0 = steady; capped at MAX_MAGIC_PULSE_HZ). */
  readonly pulseHz?: number;
}

/** The material of a fresnel shell; its uniforms are `uColor`, `uIntensity`, `uPower`. */
export function createFresnelMaterial(options: FresnelOptions = {}): ShaderMaterial {
  const look = resolveMagicLook(options);
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uColor: { value: new Color().setHex(look.tint, 'srgb-linear') },
      uIntensity: { value: look.intensity },
      uPower: { value: options.power ?? 2.6 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  material.toneMapped = false;
  return material;
}

/** A fresnel glow applied to an object: one shell per mesh. */
export class FresnelGlow {
  readonly material: ShaderMaterial;
  readonly #shells: Mesh[] = [];
  readonly #hz: number;
  #tint: number;
  #intensity: number;

  constructor(root: Object3D, options: FresnelOptions = {}) {
    this.material = createFresnelMaterial(options);
    this.#hz = options.pulseHz ?? 0;
    const look = resolveMagicLook(options);
    this.#tint = look.tint;
    this.#intensity = look.intensity;
    const targets: Mesh[] = [];
    root.traverse((child) => {
      if (child instanceof Mesh && child.visible) targets.push(child as Mesh);
    });
    for (const target of targets) {
      const geometry: BufferGeometry = target.geometry;
      const shell =
        target instanceof SkinnedMesh
          ? new SkinnedMesh(geometry, this.material)
          : new Mesh(geometry, this.material);
      if (target instanceof SkinnedMesh && shell instanceof SkinnedMesh) {
        shell.bind(target.skeleton, target.bindMatrix);
      }
      shell.name = `${target.name}:fresnel`;
      shell.frustumCulled = target.frustumCulled;
      shell.renderOrder = 8;
      shell.castShadow = false;
      shell.receiveShadow = false;
      target.parent?.add(shell);
      shell.position.copy(target.position);
      shell.quaternion.copy(target.quaternion);
      shell.scale.copy(target.scale);
      this.#shells.push(shell);
    }
  }

  /** Shells drawn (one per mesh the target has). */
  get shells(): readonly Mesh[] {
    return this.#shells;
  }

  /** Changes the tint and strength. */
  setLook(look: Partial<MagicLook>): void {
    const next = resolveMagicLook({ tint: this.#tint, intensity: this.#intensity, ...look });
    this.#tint = next.tint;
    this.#intensity = next.intensity;
    uniform<Color>(this.material, 'uColor').value.setHex(next.tint, 'srgb-linear');
  }

  /** Breathes the glow; call each frame with the running time. */
  update(seconds: number, reducedMotion: boolean): void {
    uniform<number>(this.material, 'uIntensity').value =
      this.#intensity * magicPulse(this.#hz, seconds, reducedMotion);
  }

  dispose(): void {
    for (const shell of this.#shells) shell.removeFromParent();
    this.#shells.length = 0;
    this.material.dispose();
  }
}
