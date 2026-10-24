// Reading a spell scroll (mw-ju8.17): casts the scroll's spell once and spends the scroll. Owner
// decision 2026-10-24: the cast is free (no mana), needs no learning, any class may read one. That is
// exactly a `free` cast (ADR-0007: no known-spell check, no gates, no costs, no wind-up).
//
// `read` is the inventory's Read on a carried scroll. The caller (the game glue) has aimed the spell the
// way a normal cast is aimed and passes `aim` and `target`. The scroll is spent only when the cast
// started: a fizzle (the delivery could not start) leaves it in the pack, so a scroll is never wasted on
// nothing. Nothing here names a spell: which spell a scroll casts is the `casts` lookup the game derives
// from the book items (`book.casts`).

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { inventoryOf, type InventoryRules } from '../inventory/inventory';
import type { Vec3 } from '../stimulus/shapes';
import type { SpellPipeline } from './pipeline';

/** Why a read did nothing. */
export type ScrollRefusal =
  /** No such item, or one that casts no spell. */
  | 'not-readable'
  /** The pipeline fizzled the cast; the scroll is kept. */
  | 'fizzled';

/** A scroll was read: its spell started and one scroll was spent. */
export interface ScrollRead {
  readonly tick: number;
  readonly actor: EntityId;
  /** The scroll item's definition id. */
  readonly scroll: string;
  readonly spell: string;
}

export const ScrollRead = defineEvent<ScrollRead>('magic.scrollRead');

export type ScrollReadResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: ScrollRefusal };

export interface ScrollRulesOptions {
  /** The spell the scroll item `defId` casts, or undefined for an item that is no castable scroll. */
  readonly casts: (defId: string) => string | undefined;
  readonly pipeline: Pick<SpellPipeline, 'cast'>;
  readonly inventory: Pick<InventoryRules, 'remove'>;
}

export class ScrollRules {
  readonly #options: ScrollRulesOptions;

  constructor(options: ScrollRulesOptions) {
    this.#options = options;
  }

  /** Whether `defId` is a scroll that casts a spell. */
  castable(defId: string): boolean {
    return this.#options.casts(defId) !== undefined;
  }

  /**
   * Reads carried scroll `instanceId`: casts its spell free at `aim`/`target`, then spends one scroll.
   * Refusals change nothing.
   */
  read(
    world: World<never>,
    actor: EntityId,
    instanceId: number,
    where: { readonly aim?: Vec3; readonly target?: EntityId } = {},
  ): ScrollReadResult {
    const defId = inventoryOf(world, actor)?.items.find(
      (item) => item.instanceId === instanceId,
    )?.defId;
    const spell = defId === undefined ? undefined : this.#options.casts(defId);
    if (defId === undefined || spell === undefined) return { ok: false, reason: 'not-readable' };
    const cast = this.#options.pipeline.cast(world, {
      caster: actor,
      spell,
      source: 'free',
      ...(where.aim !== undefined && { aim: where.aim }),
      ...(where.target !== undefined && { target: where.target }),
    });
    if (cast.status !== 'cast') return { ok: false, reason: 'fizzled' };
    this.#options.inventory.remove(world, actor, { instanceId, count: 1 });
    world.events.emit(ScrollRead, { tick: world.tick, actor, scroll: defId, spell });
    return { ok: true };
  }
}
