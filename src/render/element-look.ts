// Draws the element-state look on scene objects (mw-e03.28): wet darkening and sheen, frost overlay,
// ember glow, charge shimmer. Each affected object's materials are cloned once, tinted and made to
// glow from the combined look (src/game/vfx/element-look.ts), pulsed each frame when the look pulses
// (never in reduced motion), and put back (clones disposed) when the entity leaves every state.
//
// Render-only (needs Three.js materials), verified by e2e/element-states.spec.ts and its screenshots.

import {
  Color,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  type Material,
  type Object3D,
} from 'three';

/** What the renderer needs of a combined look (src/game/vfx's LookParams satisfies it). */
export interface LookParams {
  readonly tintMix: number;
  readonly tint: readonly [number, number, number];
  readonly emissive: readonly [number, number, number];
  readonly roughness: number | undefined;
}

interface Original {
  readonly mesh: Mesh;
  readonly material: Material | Material[];
}

interface Applied {
  readonly originals: Original[];
  readonly clones: MeshStandardMaterial[];
  look: LookParams;
}

const scratch = new Color();

export class ElementLooks {
  readonly #applied = new Map<Object3D, Applied>();

  /** Objects currently carrying a look. */
  get size(): number {
    return this.#applied.size;
  }

  /**
   * Brings the scene up to date: `wanted` is every object that should carry a look. Objects not in it
   * are restored; the rest are tinted and glow by `glowOf` (a pulse, or 1).
   */
  sync(wanted: ReadonlyMap<Object3D, LookParams>, glowOf: (look: LookParams) => number): void {
    for (const [object, applied] of [...this.#applied]) {
      if (!wanted.has(object)) this.#restore(object, applied);
    }
    for (const [object, look] of wanted) {
      let applied = this.#applied.get(object);
      if (applied === undefined) {
        applied = this.#apply(object, look);
        this.#applied.set(object, applied);
      }
      applied.look = look;
      const glow = glowOf(look);
      for (const material of applied.clones) paint(material, look, glow);
    }
  }

  /** Restores every object. */
  dispose(): void {
    for (const [object, applied] of [...this.#applied]) this.#restore(object, applied);
  }

  #apply(object: Object3D, look: LookParams): Applied {
    const applied: Applied = { originals: [], clones: [], look };
    object.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const mesh = child as Mesh;
      const source = mesh.material;
      applied.originals.push({ mesh, material: source });
      const clone = (material: Material): Material => {
        if (!(material instanceof MeshStandardMaterial)) return material;
        const copy = material.clone();
        stash(copy, material);
        applied.clones.push(copy);
        return copy;
      };
      mesh.material = Array.isArray(source) ? source.map(clone) : clone(source);
    });
    return applied;
  }

  #restore(object: Object3D, applied: Applied): void {
    this.#applied.delete(object);
    for (const { mesh, material } of applied.originals) mesh.material = material;
    for (const clone of applied.clones) clone.dispose();
  }
}

/** The material each clone was made from: textures load after a material is made, so it is re-read. */
const SOURCE = new WeakMap<MeshStandardMaterial, MeshStandardMaterial>();

function stash(copy: MeshStandardMaterial, original: MeshStandardMaterial): void {
  SOURCE.set(copy, original);
}

function paint(material: MeshStandardMaterial, look: LookParams, glow: number): void {
  const base = SOURCE.get(material);
  if (base === undefined) return;
  if (material.map !== base.map) {
    material.map = base.map;
    material.needsUpdate = true;
  }
  material.color.copy(base.color);
  if (look.tintMix > 0) {
    material.color.lerp(scratch.setRGB(...look.tint, SRGBColorSpace), look.tintMix);
  }
  const [r, g, b] = look.emissive;
  const peak = Math.max(r, g, b);
  if (peak > 0) {
    material.emissive.setRGB(r / peak, g / peak, b / peak, SRGBColorSpace);
    material.emissiveIntensity = peak * glow; // props carry no glow of their own
  } else {
    material.emissive.copy(base.emissive);
    material.emissiveIntensity = base.emissiveIntensity;
  }
  material.roughness = look.roughness ?? base.roughness;
}
