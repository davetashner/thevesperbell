// Emissive pulse (mw-e29.7): a body that glows in a tint and breathes, for charged, enchanted and
// summoned things. It works on the object's own material copies (clone.ts) and puts the originals
// back; the rate never exceeds MAX_MAGIC_PULSE_HZ and reduced motion holds it steady.
//
// Render-only; verified by tests/integration/magic-materials.test.ts and e2e/magic-materials.spec.ts.

import { Color, type Object3D } from 'three';
import { magicPulse, resolveMagicLook, type MagicLook } from './rules';
import { cloneMaterials, type MaterialCopies } from './clone';

export interface PulseOptions extends Partial<MagicLook> {
  /** Breathing rate in hertz (default 1.2; 0 = steady). */
  readonly hz?: number;
}

export class EmissivePulse {
  readonly #copies: MaterialCopies;
  readonly #base: number[];
  readonly #hz: number;
  readonly #colour = new Color();
  #look: MagicLook;

  constructor(root: Object3D, options: PulseOptions = {}) {
    this.#look = resolveMagicLook(options);
    this.#hz = options.hz ?? 1.2;
    this.#copies = cloneMaterials(root);
    // A material that does not glow of its own starts from nothing, whatever its intensity says.
    this.#base = this.#copies.clones.map((material) =>
      material.emissive.getHex() === 0 ? 0 : material.emissiveIntensity,
    );
    this.update(0, true);
  }

  /** Materials this pulse made; for tests and diagnostics. */
  get materials(): readonly object[] {
    return this.#copies.clones;
  }

  setLook(look: Partial<MagicLook>): void {
    this.#look = resolveMagicLook({ ...this.#look, ...look });
  }

  /** Sets the glow for the running time `seconds`. */
  update(seconds: number, reducedMotion: boolean): void {
    this.#colour.set(this.#look.tint);
    const factor = magicPulse(this.#hz, seconds, reducedMotion);
    this.#copies.clones.forEach((material, i) => {
      material.emissive.copy(this.#colour);
      material.emissiveIntensity = (this.#base[i] ?? 0) + this.#look.intensity * factor;
    });
  }

  /** Puts the object's own materials back. */
  dispose(): void {
    this.#copies.restore();
  }
}
