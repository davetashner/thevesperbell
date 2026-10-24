// The casting HUD's game glue (mw-e06.15): what the reticle shows and why. The widget
// (src/ui/reticle.ts) reads no sim state; this file turns the controller's preview of the selected
// spell and the reasons a cast was refused into its model, once per drawn frame:
//
// - ready: the aim is valid; far: the aim ran past the spell's range and was brought back to it;
//   invalid: it would be refused (no floor for an area, no target in reach…).
// - A refusal (the controller's, before sending) or a SpellFizzled for the player (the sim's: not
//   enough mana, on cooldown…) keeps the reticle red with the reason under it for NOTE_MS.

import { SpellFizzled, type EntityId, type World } from '@sim/index';
import { NO_RETICLE, type Reticle, type ReticleModel } from '@ui/index';
import type { AimRay, AimResult } from './aim';
import type { SpellCaster } from './caster';

/** How long a refusal's reason stays under the reticle, ms. */
export const NOTE_MS = 1500;

const REASONS: Readonly<Record<string, string>> = Object.freeze({
  'no-floor': 'No floor there',
  blocked: 'Blocked',
  'no-target': 'No target',
  'out-of-reach': 'Out of reach',
  'no-caster': 'Cannot cast',
  'no-spell': 'No spell learned',
  'insufficient-mana': 'Not enough mana',
  'no-mana-pool': 'No mana',
  cooldown: 'Not ready',
  'already-casting': 'Already casting',
  silenced: 'Silenced',
  grappled: 'Held fast',
  restrained: 'Held fast',
  quenched: 'Quenched',
  'not-learned': 'Not learned',
});

/** Player-facing text for a refusal or fizzle reason (the reason itself when unlisted). */
export function reasonText(reason: string): string {
  return REASONS[reason] ?? reason;
}

/** The reticle for the selected spell `name`, its `aim` and the `note` still showing. */
export function reticleModel(
  name: string | undefined,
  aim: AimResult | undefined,
  note: string,
): ReticleModel {
  if (name === undefined) return NO_RETICLE;
  const invalid = note !== '' || (aim !== undefined && !aim.valid);
  const text = note !== '' ? note : aim?.reason == null ? '' : reasonText(aim.reason);
  return {
    visible: true,
    state: invalid ? 'invalid' : aim?.clamped === true ? 'far' : 'ready',
    spell: name,
    note: text,
  };
}

export interface SpellHudOptions {
  readonly world: World<never>;
  readonly player: EntityId;
  readonly caster: SpellCaster;
  readonly reticle: Reticle;
  /** The camera's view ray this frame. */
  readonly ray: () => AimRay;
}

export interface SpellHudGlue {
  /** The aim shown on the last frame (the ground marker draws from it). */
  readonly aim: () => AimResult | undefined;
  /** Call once per drawn frame, after the sim stepped. */
  frame(nowMs: number): void;
  dispose(): void;
}

/** Wires `reticle` to the player's casting (see the file header). */
export function attachSpellHud(options: SpellHudOptions): SpellHudGlue {
  const { world, player, caster, reticle, ray } = options;
  let note = '';
  let noteUntil = -Infinity;
  let refusals = caster.refusals;
  let aim: AimResult | undefined;
  let pending: string | undefined;
  const off = world.events.on(SpellFizzled, (fizzle) => {
    if (fizzle.caster === player) pending = fizzle.reason;
  });
  return {
    aim: () => aim,
    frame(nowMs) {
      if (pending !== undefined) {
        note = reasonText(pending);
        noteUntil = nowMs + NOTE_MS;
        pending = undefined;
      }
      if (caster.refusals !== refusals) {
        refusals = caster.refusals;
        note = reasonText(caster.lastRefusal ?? '');
        noteUntil = nowMs + NOTE_MS;
      }
      if (nowMs >= noteUntil) note = '';
      const spell = caster.spell();
      aim = spell === undefined ? undefined : caster.preview(ray());
      reticle.update(reticleModel(spell?.name, aim, note));
    },
    dispose: off,
  };
}
