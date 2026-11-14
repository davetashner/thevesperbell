// Hit feedback glue (mw-e29.5): turns the player's combat events into camera shake and the damage
// vignette, and the player's health into the low-health grade.
//
// - DamageApplied on the player: trauma 0.15 (light) or 0.3 (heavy: a critical, a poise break, or
//   15%+ of max health); the vignette is the fraction of max health the hit removed. Blocked hits
//   that did no damage shake nothing, and a guard break's own hit leaves the trauma to GuardBroken.
// - GuardBroken on the player: trauma 0.5.
// - Explosions have no sim event yet: the game calls `shake.addExplosion(distance, radius)`.
//
// Events queue as the sim emits them and apply on the next drawn frame at that frame's time.

import {
  DAMAGE_TAGS,
  DamageApplied,
  GuardBroken,
  healthOf,
  type EntityId,
  type World,
} from '@sim/index';
import type { ScreenFeedback } from '@ui/index';
import { CameraShake, TRAUMA } from '../camera/shake';
import { DamageVignette, desaturation } from '../vfx/screen-feedback';

/** A hit taking this fraction of max health or more is heavy. */
export const HEAVY_HIT_FRACTION = 0.15;

const HEAVY_TAGS: readonly string[] = [
  DAMAGE_TAGS.critical,
  DAMAGE_TAGS.backstab,
  DAMAGE_TAGS.riposte,
];

export interface ScreenFeedbackGlueOptions {
  readonly world: World<never>;
  readonly player: EntityId;
  readonly shake: CameraShake;
  readonly vignette: DamageVignette;
  readonly overlay: ScreenFeedback;
  /** Whether reduce-screen-effects is on (accessibility.reduceScreenEffects): no vignette, no grade. */
  readonly reduceEffects?: () => boolean;
}

export interface ScreenFeedbackGlue {
  /** Call once per drawn frame, after the sim stepped. */
  frame(nowMs: number): void;
  /** Stops listening to the sim. */
  dispose(): void;
}

export function attachScreenFeedback(options: ScreenFeedbackGlueOptions): ScreenFeedbackGlue {
  const { world, player, shake, vignette, overlay } = options;
  const reduceEffects = options.reduceEffects ?? (() => false);
  let trauma = 0;
  let lost = 0;
  const offDamage = world.events.on(DamageApplied, (hit) => {
    if (hit.target !== player || hit.total <= 0) return;
    const max = Math.max(1, healthOf(world, player)?.max ?? 1);
    const fraction = (hit.healthBefore - hit.healthAfter) / max;
    lost = Math.max(lost, fraction);
    if (hit.packet.tags.includes(DAMAGE_TAGS.guardBreak)) return;
    const heavy =
      hit.poiseBroken ||
      fraction >= HEAVY_HIT_FRACTION ||
      hit.packet.tags.some((tag) => HEAVY_TAGS.includes(tag));
    trauma += heavy ? TRAUMA.heavy : TRAUMA.light;
  });
  const offGuard = world.events.on(GuardBroken, (event) => {
    if (event.entity === player) trauma += TRAUMA.guardBreak;
  });
  return {
    frame(nowMs) {
      if (trauma > 0) shake.add(trauma);
      trauma = 0;
      if (lost > 0) vignette.hit(lost, nowMs);
      lost = 0;
      const health = healthOf(world, player);
      // Reduce screen effects: the health bar and the damage ring still say what happened.
      const plain = reduceEffects();
      overlay.update({
        vignette: plain ? 0 : vignette.intensity(nowMs),
        desaturation: plain || health === undefined ? 0 : desaturation(health.current, health.max),
      });
    },
    dispose() {
      offDamage();
      offGuard();
    },
  };
}
