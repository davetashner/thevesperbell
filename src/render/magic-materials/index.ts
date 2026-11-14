// The magical material library (mw-e29.7): one shared set of looks so spells, summons and deaths
// read as one world. Every look takes a tint and an intensity (src/game/vfx/magic-materials.ts has
// the rules); this facade builds them for a renderer and tier.
//
//   dissolve      death, summon (run it backwards), illusion fade      src/render/magic-materials/dissolve.ts
//   fresnel       rim glow shells                                      fresnel.ts
//   heatHaze      heat haze / distortion, High only                    haze.ts
//   runeDecal     Hornfolk rune ring on the ground                     rune.ts
//   pulse         emissive pulse                                       pulse.ts
//   softParticle  puff that fades out ahead of surfaces                soft-particle.ts
//
// Low tier: distortion is skipped (heatHaze returns undefined and no frame is ever copied) and
// soft particles fade by their own rim. Reduced motion: pulses hold steady, runes do not turn, the
// haze holds still. Nothing flashes faster than 2 Hz.
//
// Render-only; verified by tests/integration/magic-materials.test.ts and e2e/magic-materials.spec.ts.

import type { Object3D, WebGLRenderer } from 'three';
import type { VfxQualityTier } from '@content/index';
import { distortionAllowed } from './rules';
import { Dissolve, applyDissolve, type DissolveOptions } from './dissolve';
import { FresnelGlow, type FresnelOptions } from './fresnel';
import { HeatHaze, type HeatHazeOptions } from './haze';
import { DistortionPass, FrameGate, SoftDepthPass, type DistortionRenderer } from './passes';
import { EmissivePulse, type PulseOptions } from './pulse';
import { RuneDecal, type RuneDecalOptions } from './rune';
import { SoftParticle, type SoftParticleOptions } from './soft-particle';

export {
  Dissolve,
  applyDissolve,
  type DissolveOptions,
  EmissivePulse,
  type PulseOptions,
  FresnelGlow,
  type FresnelOptions,
  HeatHaze,
  type HeatHazeOptions,
  RuneDecal,
  type RuneDecalOptions,
  SoftParticle,
  type SoftParticleOptions,
  DistortionPass,
  SoftDepthPass,
  FrameGate,
};
export { createFresnelMaterial } from './fresnel';
export { runeTexture } from './rune';
export { cloneMaterials } from './clone';

export interface MagicMaterialsOptions {
  /** The renderer the looks are drawn with (the passes need its frame). */
  readonly renderer: Pick<WebGLRenderer, 'getDrawingBufferSize' | 'copyFramebufferToTexture'> & {
    readonly info: DistortionRenderer['info'];
  };
  /** Quality tier (default High); changeable with setTier. */
  readonly tier?: VfxQualityTier;
  /** Whether motion is reduced right now. */
  readonly reducedMotion?: () => boolean;
}

/** What the library has drawn, for the e2e probe and the stats overlay. */
export interface MagicMaterialsStats {
  readonly tier: VfxQualityTier;
  /** Heat hazes alive and visible. */
  readonly hazes: number;
  /** Distortion requests refused because the tier does not draw them. */
  readonly distortionSkipped: number;
  /** Frame copies the distortion pass has made. */
  readonly distortionPasses: number;
  /** Depth renders the soft particles have caused. */
  readonly depthPasses: number;
}

interface Animated {
  update(seconds: number, reducedMotion: boolean): void;
}

export class MagicMaterials {
  readonly distortion: DistortionPass;
  readonly depth: SoftDepthPass;
  readonly #gate = new FrameGate();
  readonly #animated = new Set<Animated>();
  readonly #hazes = new Set<HeatHaze>();
  readonly #reduced: () => boolean;
  #tier: VfxQualityTier;
  #skipped = 0;
  #seconds = 0;

  constructor(options: MagicMaterialsOptions) {
    this.#tier = options.tier ?? 'high';
    this.#reduced = options.reducedMotion ?? (() => false);
    this.distortion = new DistortionPass(this.#gate);
    this.depth = new SoftDepthPass(this.#gate);
  }

  get tier(): VfxQualityTier {
    return this.#tier;
  }

  /** Switches tier: hazes already alive are hidden on Low (so no pass runs) and shown again on High. */
  setTier(tier: VfxQualityTier): void {
    this.#tier = tier;
    for (const haze of this.#hazes) haze.mesh.visible = distortionAllowed(tier);
  }

  /** Makes `root` dissolvable (progress 0 whole … 1 gone) on copies of its own materials. */
  dissolve(root: Object3D, options?: DissolveOptions): Dissolve {
    return applyDissolve(root, options);
  }

  /** A rim glow around every mesh of `root`. */
  fresnel(root: Object3D, options?: FresnelOptions): FresnelGlow {
    return this.#track(new FresnelGlow(root, options));
  }

  /**
   * A heat haze, or undefined when the tier does not draw distortion (Low): the request is skipped,
   * counted, and no frame is copied. Add its `mesh` to the scene.
   */
  heatHaze(options?: HeatHazeOptions): HeatHaze | undefined {
    if (!distortionAllowed(this.#tier)) {
      this.#skipped++;
      return undefined;
    }
    const haze = new HeatHaze(this.distortion, options);
    this.#hazes.add(haze);
    return this.#track(haze, () => this.#hazes.delete(haze));
  }

  /** A rune ring for the ground. Add its `mesh` to the scene. */
  runeDecal(options?: RuneDecalOptions): RuneDecal {
    return this.#track(new RuneDecal(options));
  }

  /** `root` glowing in a tint and breathing. */
  pulse(root: Object3D, options?: PulseOptions): EmissivePulse {
    return this.#track(new EmissivePulse(root, options));
  }

  /** A puff that fades ahead of surfaces (High) or by its own rim (Low). Add its `mesh`. */
  softParticle(options?: SoftParticleOptions): SoftParticle {
    return new SoftParticle(this.depth, () => this.#tier === 'high', options);
  }

  /** Advances everything that moves: pulses, turning runes, haze flow. */
  update(seconds: number): void {
    this.#seconds += Math.max(seconds, 0);
    const reduced = this.#reduced();
    for (const item of this.#animated) item.update(this.#seconds, reduced);
  }

  stats(): MagicMaterialsStats {
    let visible = 0;
    for (const haze of this.#hazes) if (haze.mesh.visible) visible++;
    return {
      tier: this.#tier,
      hazes: visible,
      distortionSkipped: this.#skipped,
      distortionPasses: this.distortion.runs,
      depthPasses: this.depth.runs,
    };
  }

  dispose(): void {
    this.distortion.dispose();
    this.depth.dispose();
    this.#animated.clear();
    this.#hazes.clear();
  }

  #track<T extends Animated & { dispose(): void }>(item: T, extra?: () => void): T {
    this.#animated.add(item);
    const original = item.dispose.bind(item);
    item.dispose = () => {
      this.#animated.delete(item);
      extra?.();
      original();
    };
    return item;
  }
}
