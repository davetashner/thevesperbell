// The two halves of an area transition (mw-e01.11) on the game side.
//
// Leaving: `TransitionController` listens for the sim's `areaTransition` (the player walked into a
// volume) and, at the next point between sim steps, captures the carry (which captures the area's
// level deltas), records the hand-off in session storage and reloads the page into the target scene.
// A hand-off that outlasts the loading delay shows the area's name over the old page.
//
// Arriving: `Arrival` starts when the target page boots and ends when it is playable. It shows the
// same overlay if the boot outlasts the delay, and reports how long the whole transition took (from
// the crossing on the old page to the first playable frame) for the perf suite.
//
// Nothing here moves the player or touches a scene: the scene loader and the player start do that,
// from the spawn the hand-off names.

import {
  areaTransition,
  travelRequested,
  gameClockOf,
  type AreaTransition,
  type EntityId,
  type World,
} from '@sim/index';
import { showAreaLoadingAfter, type AreaLoading, type AreaLoadingOptions } from '@ui/area-loading';
import type { SaveRegistry } from '../save/format';
import { captureCarry } from './carry';
import { transitSearch, writeTransit, type Transit, type TransitStorage } from './payload';

/** What #app[data-transit] carries. */
export type TransitReadout =
  | {
      readonly kind: 'leaving';
      readonly from: string;
      readonly to: string;
      readonly spawn: string;
      readonly follow: boolean;
    }
  | {
      readonly kind: 'arrived';
      readonly from: string;
      readonly to: string;
      readonly spawn: string;
      /** Milliseconds from the crossing to the first playable frame (wall clock; for the perf suite). */
      readonly ms: number;
      /** Whether the loading overlay appeared (the transition outlasted its delay). */
      readonly overlay: boolean;
    };

export interface TransitionControllerOptions {
  readonly world: World<never>;
  readonly player: EntityId;
  /** The scene this page runs, named as `from` by a transition a `travelTo` effect asks for. */
  readonly sceneId?: () => string;
  readonly registry: SaveRegistry;
  /** Display name of a scene, for the loading overlay. */
  readonly areaName: (scene: string) => string;
  readonly session: TransitStorage;
  /** Wall-clock milliseconds since the Unix epoch. */
  readonly now: () => number;
  /** Reloads the page with this search string. */
  readonly navigate: (search: string) => void;
  /** The current search string, whose own parameters carry over. */
  readonly search: () => string;
  /** Where the loading overlay goes. */
  readonly overlayParent: HTMLElement;
  readonly overlay?: Pick<AreaLoadingOptions, 'delayMs' | 'setTimer' | 'clearTimer'>;
  readonly publish?: (readout: TransitReadout) => void;
  readonly warn?: (message: string) => void;
}

/** Answers `areaTransition` by saving the area's changes and reloading into the target scene. */
export class TransitionController {
  private pending: AreaTransition | undefined;
  private started = false;
  private readonly stop: () => void;

  constructor(private readonly options: TransitionControllerOptions) {
    const { events } = options.world;
    const stopCrossing = events.on(areaTransition, (transition) => {
      // The first crossing wins; a player who walks on while the page reloads crosses nothing more.
      this.pending ??= transition;
    });
    // A service that carries the player (the barge, mw-e20.14) asks for the same hand-off without a volume.
    const stopTravel = events.on(travelRequested, ({ scene, spawn }) => {
      this.pending ??= {
        tick: options.world.tick,
        from: options.sceneId?.() ?? '',
        transition: 'travel',
        scene,
        spawn,
        follow: false,
        entity: options.player,
      };
    });
    this.stop = () => {
      stopCrossing();
      stopTravel();
    };
  }

  /** Whether the player has crossed a volume and the area is being left. */
  get leaving(): boolean {
    return this.pending !== undefined;
  }

  /** Call after every sim step: the hand-off happens here, between steps. */
  afterStep(): void {
    const crossing = this.pending;
    if (crossing === undefined || this.started) return;
    this.started = true;
    const { options } = this;
    let transit: Transit;
    try {
      // A leg of a long walk (the towpath) takes game time: advance the clock before the carry is
      // captured, so the facts that cross the reload already say how late it is.
      if (crossing.advanceMinutes !== undefined && crossing.advanceMinutes > 0) {
        gameClockOf(options.world)?.advanceTime(crossing.advanceMinutes, 'travel');
      }
      transit = {
        from: crossing.from,
        to: crossing.scene,
        spawn: crossing.spawn,
        follow: crossing.follow,
        areaName: options.areaName(crossing.scene),
        startedAt: options.now(),
        carry: captureCarry(options.world, options.player, options.registry),
      };
      writeTransit(options.session, transit);
    } catch (error) {
      // Stay in the area rather than lose the player's state; stepping out and in tries again.
      options.warn?.(`area transition to ${crossing.scene} failed: ${String(error)}`);
      this.pending = undefined;
      this.started = false;
      return;
    }
    this.stop();
    showAreaLoadingAfter(options.overlayParent, transit.areaName, options.overlay);
    options.publish?.({
      kind: 'leaving',
      from: transit.from,
      to: transit.to,
      spawn: transit.spawn,
      follow: transit.follow,
    });
    options.navigate(transitSearch(options.search(), transit.to));
  }
}

/** The arriving page's side: the overlay while it loads and the timing once it is playable. */
export class Arrival {
  private readonly loading: AreaLoading;
  private shown = false;

  constructor(
    private readonly transit: Transit,
    private readonly options: {
      readonly overlayParent: HTMLElement;
      readonly now: () => number;
      readonly overlay?: Pick<AreaLoadingOptions, 'delayMs' | 'setTimer' | 'clearTimer'>;
      readonly publish?: (readout: TransitReadout) => void;
    },
  ) {
    this.loading = showAreaLoadingAfter(options.overlayParent, transit.areaName, {
      ...options.overlay,
      onShown: () => {
        this.shown = true;
      },
    });
  }

  /** The hand-off turned out not to be for this page: takes the overlay down, reports nothing. */
  dismiss(): void {
    this.loading.hide();
  }

  /** The first playable frame is about to run: takes the overlay down and reports the timing. */
  playable(): TransitReadout {
    this.loading.hide();
    const readout: TransitReadout = {
      kind: 'arrived',
      from: this.transit.from,
      to: this.transit.to,
      spawn: this.transit.spawn,
      ms: Math.max(0, this.options.now() - this.transit.startedAt),
      overlay: this.shown,
    };
    this.options.publish?.(readout);
    return readout;
  }
}
