// Creature deaths drawn as a dissolve (mw-e29.7 AC-3): listens for the sim's Died event and, for a
// creature that has a render entity, starts its corpse's clock (CorpseDissolves in
// magic-materials.ts). The dissolve runs over 1.2 s once the collapse has landed, then the render
// entity is taken away. Render-only: the sim is never written to and never told, and it may keep
// the entity (its health carries through saves) or drop it first; what is drawn is the proxy.

import { Died, type EntityId, type World } from '@sim/index';
import { CorpseDissolves } from './magic-materials.ts';
import type { DissolveSpec } from '@render/magic-materials/rules';

/** What the renderer provides for a corpse: `P` is a render entity, `H` the handle of its dissolve. */
export interface CorpseGlueOptions<P, H> {
  readonly events: World['events'];
  /** The render entity of a creature, or undefined if it is not drawn. */
  readonly proxyOf: (entity: EntityId) => P | undefined;
  /** Makes the render entity dissolvable. */
  readonly dissolve: (entity: EntityId, proxy: P) => H;
  /** Sets how far it has dissolved, 0 whole … 1 gone. */
  readonly progress: (handle: H, progress: number) => void;
  /** Takes the render entity away (its dissolve is over). */
  readonly remove: (entity: EntityId, proxy: P, handle: H) => void;
  /** When and for how long (default: the death dissolve). */
  readonly spec?: DissolveSpec;
}

export interface CorpseGlue {
  /** Advances every corpse by a frame of `seconds`. */
  update(seconds: number): void;
  /** Whether `entity` died and its render entity has not yet been removed. */
  dying(entity: EntityId): boolean;
  /** How far `entity`'s dissolve has gone (undefined before it starts or after it ends). */
  progressOf(entity: EntityId): number | undefined;
  /** Corpses not yet removed. */
  readonly size: number;
  /** Render entities removed so far. */
  readonly removed: number;
  /** Stops listening for deaths. */
  detach(): void;
}

export function attachCorpseDissolves<P, H>(options: CorpseGlueOptions<P, H>): CorpseGlue {
  const proxies = new Map<EntityId, P>();
  const progress = new Map<EntityId, number>();
  let removed = 0;
  const corpses = new CorpseDissolves<EntityId, { entity: EntityId; proxy: P; handle: H }>(
    {
      apply: (entity) => {
        const proxy = proxies.get(entity) as P;
        return { entity, proxy, handle: options.dissolve(entity, proxy) };
      },
      progress: ({ entity, handle }, amount) => {
        progress.set(entity, amount);
        options.progress(handle, amount);
      },
      remove: (entity, { proxy, handle }) => {
        options.remove(entity, proxy, handle);
        proxies.delete(entity);
        progress.delete(entity);
        removed++;
      },
    },
    options.spec,
  );
  const detach = options.events.on(Died, ({ target }) => {
    const proxy = options.proxyOf(target);
    if (proxy === undefined) return;
    proxies.set(target, proxy);
    corpses.died(target);
  });
  return {
    update(seconds) {
      corpses.update(seconds);
    },
    dying: (entity) => corpses.dying(entity),
    progressOf: (entity) => progress.get(entity),
    get size() {
      return corpses.size;
    },
    get removed() {
      return removed;
    },
    detach,
  };
}
