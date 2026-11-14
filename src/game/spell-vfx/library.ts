// The spell VFX library (mw-e29.10): turns a spell's `vfx` block (templates by slot, with optional
// tint and scale) into what the VFX layer plays, with no code per spell. Each slot resolves to
// particle effects (tinted copies of the template's loaded effects), or, for the two slots that are
// not particles, the numbers the ring and beam drawings take. The tinted effects a library has
// resolved are handed to the VfxSystem (`derivedEffects`) when it is built, so tinting is free at
// cast time. A slot the block leaves out resolves to nothing and is skipped when cast (AC-4).
//
// Pure data in, data out: no renderer, no clock, no randomness. Docs: docs/vfx/spell-hooks.md.

import {
  SPELL_VFX_SLOTS,
  type GameEntry,
  type SpellVfxBlock,
  type SpellVfxBlockInput,
  type SpellVfxSlot,
} from '@content/index';
import type { BeamSpec, RingSpec } from '@render/spell-vfx/rules';
import type { VfxEffectEntry } from '../vfx/index.ts';
import { tintEffect, tintedEffectId } from './tint.ts';

/** A loaded spell VFX template. */
export type SpellVfxTemplateEntry = GameEntry<'spell-vfx-template'>;

/** A particle effect a slot plays: a tinted effect id and the spawn scale. */
export interface ResolvedEffect {
  readonly effect: string;
  readonly scale: number;
}

/** The rune ring an area slot draws, with the numbers its template holds. */
export interface ResolvedRing extends RingSpec {
  readonly scale: number;
  /** Motes across the ring, scaled by the radius when cast. */
  readonly motes: ResolvedEffect | undefined;
}

/** The beam strip a beam slot draws (width is the template's times the scale). */
export interface ResolvedBeam extends BeamSpec {
  readonly end: ResolvedEffect | undefined;
}

/** A summon slot: its arrival effect and how long the body dissolves. */
export interface ResolvedSummon extends ResolvedEffect {
  readonly tint: string;
  readonly dissolveSeconds: number;
}

/** A projectile slot: the head and the optional trail. */
export interface ResolvedProjectile {
  readonly head: ResolvedEffect;
  readonly trail: ResolvedEffect | undefined;
}

/** Every slot of a spell's VFX block resolved; a slot the spell does not use is undefined. */
export interface ResolvedSpellVfx {
  readonly castWindup: ResolvedEffect | undefined;
  readonly castRelease: ResolvedEffect | undefined;
  readonly projectile: ResolvedProjectile | undefined;
  readonly impact: ResolvedEffect | undefined;
  readonly area: ResolvedRing | undefined;
  readonly beam: ResolvedBeam | undefined;
  readonly sustainOnTarget: ResolvedEffect | undefined;
  readonly summon: ResolvedSummon | undefined;
}

/** A spell with nothing to draw. */
export const NO_SPELL_VFX: ResolvedSpellVfx = Object.freeze({
  castWindup: undefined,
  castRelease: undefined,
  projectile: undefined,
  impact: undefined,
  area: undefined,
  beam: undefined,
  sustainOnTarget: undefined,
  summon: undefined,
});

/** Resolves spell VFX blocks against the loaded templates and effects. */
export class SpellVfxLibrary {
  readonly #templates = new Map<string, SpellVfxTemplateEntry>();
  readonly #effects = new Map<string, VfxEffectEntry>();
  readonly #derived = new Map<string, VfxEffectEntry>();

  constructor(templates: readonly SpellVfxTemplateEntry[], effects: readonly VfxEffectEntry[]) {
    for (const template of templates) this.#templates.set(template.id, template);
    for (const effect of effects) this.#effects.set(effect.id, effect);
  }

  /** The tinted effects resolved so far; add them to the VfxSystem's effects when building it. */
  derivedEffects(): readonly VfxEffectEntry[] {
    return [...this.#derived.values()];
  }

  #effect(effectId: string, tint: string, scale: number): ResolvedEffect {
    const id = tintedEffectId(effectId, tint);
    if (!this.#derived.has(id)) {
      const source = this.#effects.get(effectId);
      if (source === undefined) throw new Error(`spell vfx: unknown effect "${effectId}"`);
      this.#derived.set(id, tintEffect(source, tint));
    }
    return { effect: id, scale };
  }

  /**
   * Resolves `block` (a spell's `vfx`, or the same shape written as plain ids). Throws, naming the
   * slot, for a template that is unknown or fills another slot: content that passed validation
   * never does.
   */
  resolve(block: SpellVfxBlock | SpellVfxBlockInput | undefined): ResolvedSpellVfx {
    if (block === undefined) return NO_SPELL_VFX;
    const out: { -readonly [K in SpellVfxSlot]?: ResolvedSpellVfx[K] } = {};
    for (const slot of SPELL_VFX_SLOTS) {
      const use = block[slot];
      if (use === undefined) continue;
      const id = typeof use.template === 'string' ? use.template : use.template.id;
      const template = this.#templates.get(id);
      if (template?.slot !== slot) {
        throw new Error(`spell vfx: slot ${slot} cannot use template "${id}"`);
      }
      const tint = use.tint ?? template.tint;
      const scale = use.scale ?? template.scale;
      const play = (effectRef: { readonly id: string }): ResolvedEffect =>
        this.#effect(effectRef.id, tint, scale);
      switch (template.slot) {
        case 'castWindup':
        case 'castRelease':
        case 'impact':
        case 'sustainOnTarget':
          out[template.slot] = play(template.effect);
          break;
        case 'projectile':
          out.projectile = {
            head: play(template.head),
            trail: template.trail && play(template.trail),
          };
          break;
        case 'area':
          out.area = {
            tint,
            scale,
            ...template.ring,
            motes: template.effect && play(template.effect),
          };
          break;
        case 'beam':
          out.beam = {
            tint,
            width: template.beam.width * scale,
            alpha: template.beam.alpha,
            scrollSpeed: template.beam.scrollSpeed,
            pulseHz: template.beam.pulseHz,
            end: template.endEffect && play(template.endEffect),
          };
          break;
        case 'summon':
          out.summon = {
            ...play(template.effect),
            tint,
            dissolveSeconds: template.dissolveSeconds,
          };
          break;
      }
    }
    return { ...NO_SPELL_VFX, ...out };
  }
}
