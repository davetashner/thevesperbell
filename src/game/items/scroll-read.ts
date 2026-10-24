// Reading a spell scroll in the game (mw-ju8.17): which spell each scroll item casts (the book's
// `casts`), the sim rules over them, and the aim a read takes. A read is aimed like a normal cast: the
// scroll's spell goes where the reticle points (the view the inventory was opened from), through the
// same `resolveAim`, so a ground spell needs a floor under the reticle and a touch spell a target.
// The aim is worked out when the player chooses Read and travels in the command, so replays repeat it.

import type { GameContent, SpellEntry } from '@content/index';
import {
  ScrollRules,
  type EntityId,
  type InventoryRules,
  type SpellPipeline,
  type Vec3,
} from '@sim/index';
import { resolveAim, type AimContext, type AimInvalid, type AimRay } from '../magic/aim';

/** The spell each scroll item casts, by item id (scrolls without spell content cast nothing yet). */
export function scrollCasts(content: Pick<GameContent, 'all'>): ReadonlyMap<string, string> {
  const casts = new Map<string, string>();
  for (const item of content.all('item')) {
    if (item.category === 'book' && item.book.kind === 'scroll' && item.book.casts !== undefined) {
      casts.set(item.id, item.book.casts.id);
    }
  }
  return casts;
}

/** The scroll rules for the running game. */
export function createScrollRules(
  content: Pick<GameContent, 'all'>,
  pipeline: Pick<SpellPipeline, 'cast'>,
  inventory: Pick<InventoryRules, 'remove'>,
): ScrollRules {
  const casts = scrollCasts(content);
  return new ScrollRules({ casts: (id) => casts.get(id), pipeline, inventory });
}

/** Where a read goes, or why it cannot be aimed. */
export type ScrollAim =
  | { readonly valid: true; readonly aim: Vec3; readonly target?: EntityId }
  | { readonly valid: false; readonly text: string };

const AIM_TEXT: Readonly<Record<AimInvalid, string>> = Object.freeze({
  'no-floor': 'There is no floor there to aim at.',
  blocked: 'Something blocks the way there.',
  'no-target': 'The scroll needs someone to aim at.',
  'out-of-reach': 'Too far for the scroll to reach.',
  'no-caster': 'You cannot read that now.',
});

/** Aims `spell` along `ray` for a scroll read. */
export function aimScroll(spell: SpellEntry, ray: AimRay, context: AimContext): ScrollAim {
  const aim = resolveAim(spell, ray, context);
  if (!aim.valid) return { valid: false, text: AIM_TEXT[aim.reason] };
  return {
    valid: true,
    aim: aim.point,
    ...(aim.mode === 'target' && aim.target !== null && { target: aim.target }),
  };
}
