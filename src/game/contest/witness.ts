// Who saw the player do it (mw-opf6): the `ContestPerception` the contest runner asks to decide
// whether a cheat is caught (src/sim/contest). It reads the perception system's `perceived` reports
// and nothing else, so cover, darkness and facing protect a cheat exactly as they protect a thief: a
// watcher has seen the player when its latest evaluation of its senses included the player as a seen
// target no longer than WITNESS_WINDOW_TICKS ago. A watcher nobody can resolve to a live creature
// (not in this scene) never sees anything.

import {
  entitySource,
  perceived,
  type ContestEvent,
  type ContestPerception,
  type EntityId,
  type World,
} from '@sim/index';

/** How long a sighting of the player counts, ticks (1.5 s at 60 Hz). */
export const WITNESS_WINDOW_TICKS = 90;

export interface WitnessOptions {
  /** The player's entity; undefined before there is one. */
  readonly player: () => EntityId | undefined;
  /** A creature's content id to its live entity. */
  readonly resolve: (creature: string) => EntityId | undefined;
}

export class PerceptionWitness implements ContestPerception {
  readonly #options: WitnessOptions;
  /** The tick each agent last perceived the player. */
  readonly #sighted = new Map<EntityId, number>();
  readonly #off: () => void;

  constructor(world: World<never>, options: WitnessOptions) {
    this.#options = options;
    this.#off = world.events.on(perceived, (report) => {
      const player = options.player();
      if (player === undefined) return;
      const source = entitySource(player);
      if (report.percepts.some((p) => p.kind === 'seen-target' && p.source === source)) {
        this.#sighted.set(report.agent, report.tick);
      }
    });
  }

  perceives(watcher: string, event: ContestEvent): boolean {
    const agent = this.#options.resolve(watcher);
    if (agent === undefined) return false;
    const seen = this.#sighted.get(agent);
    return seen !== undefined && event.tick - seen <= WITNESS_WINDOW_TICKS;
  }

  dispose(): void {
    this.#off();
  }
}
