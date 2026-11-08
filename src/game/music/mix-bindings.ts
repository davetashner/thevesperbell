// Mix state bindings (mw-e28.9): which snapshot the game is in, from the sim's alert states and the
// pause menu, and the parry duck from the sim's HitParried. Presentation only: it reads events and
// never writes to the sim. The pause snapshot wins over the alert-derived one while the menu is open.
import type { MixController, SnapshotName } from '@audio/index';
import type { AlertState } from '@content/index';
import { AlertStateChanged, Died, HitParried, type EntityId, type World } from '@sim/index';

/** The snapshot for the most alarmed creature's state: combat, else stealth when any is stirring. */
export function snapshotForAlert(highest: AlertState | undefined): SnapshotName {
  if (highest === 'combat') return 'combat';
  return highest === undefined || highest === 'unaware' ? 'explore' : 'stealth';
}

const RANK: Record<AlertState, number> = {
  unaware: 0,
  suspicious: 1,
  investigating: 2,
  searching: 3,
  alerted: 4,
  combat: 5,
};

export interface MixBindings {
  /** The pause menu opened or closed. */
  setPaused(paused: boolean): void;
  dispose(): void;
}

export interface MixBindingsOptions {
  readonly world: World<never>;
  readonly mix: MixController;
  /** Presentation clock in ms. */
  readonly now: () => number;
}

export function bindMix({ world, mix, now }: MixBindingsOptions): MixBindings {
  const states = new Map<EntityId, AlertState>();
  let paused = false;
  const refresh = (): void => {
    let highest: AlertState | undefined;
    for (const state of states.values()) {
      if (highest === undefined || RANK[state] > RANK[highest]) highest = state;
    }
    mix.setSnapshot(paused ? 'paused' : snapshotForAlert(highest));
  };
  const offs = [
    world.events.on(AlertStateChanged, ({ entity, to }) => {
      if (to === 'unaware') states.delete(entity);
      else states.set(entity, to);
      refresh();
    }),
    world.events.on(Died, ({ target }) => {
      if (states.delete(target)) refresh();
    }),
    world.events.on(HitParried, () => {
      mix.duck('parry', now());
    }),
  ];
  refresh();
  return {
    setPaused(next) {
      paused = next;
      refresh();
    },
    dispose() {
      for (const off of offs) off();
    },
  };
}
