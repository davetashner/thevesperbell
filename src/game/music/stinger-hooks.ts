// Alert stinger hooks (mw-e28.8): a `MusicStinger` hook event whenever a creature's alert state
// moves into Suspicious, Alerted or Combat, so the music system (adaptive controller, e28.11) can
// play a stinger without knowing about alert machines. Presentation only: it reads the sim's
// AlertStateChanged (mw-e11.7) and keeps no alert state of its own (the mix bindings and the slice
// music already track who is alarmed); listeners get the transition as it happens.
import { AlertStateChanged, type EntityId, type World } from '@sim/index';
import type { AlertState } from '@content/index';

/** The alert states a stinger can announce. */
export const STINGER_ALERT_STATES = ['suspicious', 'alerted', 'combat'] as const;

/** A stinger-worthy alert state. */
export type StingerAlertState = (typeof STINGER_ALERT_STATES)[number];

/** The `MusicStinger` hook event. */
export interface MusicStinger {
  readonly type: 'MusicStinger';
  /** The creature whose alert state changed. */
  readonly entity: EntityId;
  /** The state it entered, which picks the stinger. */
  readonly state: StingerAlertState;
  /** The state it left. */
  readonly from: AlertState;
  /** World tick of the transition. */
  readonly tick: number;
}

export type MusicStingerListener = (event: MusicStinger) => void;

export interface AlertStingerHooksOptions {
  readonly world: World<never>;
}

const announced = (state: AlertState): state is StingerAlertState =>
  (STINGER_ALERT_STATES as readonly string[]).includes(state);

/** Turns alert transitions into MusicStinger events for whoever subscribes. One per world. */
export class AlertStingerHooks {
  readonly #listeners = new Set<MusicStingerListener>();
  readonly #off: () => void;

  constructor({ world }: AlertStingerHooksOptions) {
    this.#off = world.events.on(AlertStateChanged, ({ entity, from, to, tick }) => {
      if (!announced(to)) return;
      const event: MusicStinger = { type: 'MusicStinger', entity, state: to, from, tick };
      for (const listener of this.#listeners) listener(event);
    });
  }

  /** Subscribes to MusicStinger events; returns a function that unsubscribes. */
  on(listener: MusicStingerListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Stops listening to the world (leaving the scene). */
  dispose(): void {
    this.#off();
    this.#listeners.clear();
  }
}
