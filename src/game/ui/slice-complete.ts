// The slice-complete card in the game (mw-e01.18): when the world fact `slice.complete` turns true,
// the next rendered frame opens the card (src/ui/slice-complete.ts), which captures input so the
// knight stops moving. The card does not pause the sim, because the completion autosave
// (mw-e01.7) is written by the sim loop; it says how that went and never claims a save that did not
// happen: a failed write, or one held back by a safety veto (a creature in Combat), reads "not saved".
// A save that lands later still updates the line. Return to title waits for a write in flight, so the
// page does not leave mid-save. Loading a completed save restores the fact without an event, so
// Continue does not show the card again.

import { factChanged, type World } from '@sim/index';
import type { AutosaveEvent } from '../save/autosave/scheduler';
import {
  openSliceComplete,
  type CompletionSave,
  type SliceCompleteCard,
  type UiRoot,
} from '@ui/index';

export interface SliceCompleteControllerOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  /** The fact that ends the slice (`slice.complete`); also the completion autosave's source. */
  readonly fact: string;
  /** The class's display name for the card. */
  readonly className: () => string;
  /** Why saving is unsafe now (the first objecting safety veto), or null. */
  readonly saveBlocked: () => string | null;
  /** Leaves for the title screen. */
  readonly returnToTitle: () => void;
  /** Publishes `shown` for the e2e. */
  readonly publish?: (state: 'shown') => void;
}

export class SliceCompleteController {
  readonly #options: SliceCompleteControllerOptions;
  readonly #stop: () => void;
  #completedTick: number | undefined;
  #save: CompletionSave = { state: 'saving' };
  #settled = false;
  #card: SliceCompleteCard | undefined;
  #returnWanted = false;

  constructor(options: SliceCompleteControllerOptions) {
    this.#options = options;
    this.#stop = options.world.events.on(factChanged, (change) => {
      if (change.key === options.fact && change.new === true) {
        this.#completedTick ??= options.world.tick;
      }
    });
  }

  /** The card is open. */
  get shown(): boolean {
    return this.#card !== undefined;
  }

  /** Call once per rendered frame: opens the card the frame after the fact turned true. */
  frame(): void {
    if (this.#completedTick === undefined || this.#card !== undefined) return;
    const { world, ui } = this.#options;
    if (!this.#settled) {
      const reason = this.#options.saveBlocked();
      if (reason !== null) this.#save = { state: 'unsaved', reason };
    }
    this.#card = openSliceComplete(ui, {
      seconds: this.#completedTick / world.clock.hz,
      className: this.#options.className(),
      save: this.#save,
      onReturn: () => {
        this.#returnWanted = true;
        this.#leave();
      },
      // Walking on into the valley (mw-e24.21): the card closes and, the fact being already true,
      // never opens again; a pending save line keeps updating in the (now closed) card harmlessly.
      onContinue: () => {
        this.#card?.screen.close();
      },
    });
    this.#options.publish?.('shown');
  }

  /** Feed every autosave event: the completion's outcome updates the card's save line. */
  autosave(event: AutosaveEvent): void {
    if (event.trigger.source !== this.#options.fact) return;
    if (event.type === 'saving') this.#save = { state: 'saving' };
    else if (event.type === 'saved') this.#save = { state: 'saved' };
    else if (event.retrying) this.#save = { state: 'saving' };
    else this.#save = { state: 'unsaved' };
    this.#settled = this.#save.state !== 'saving';
    this.#card?.setSave(this.#save);
    this.#leave();
  }

  stop(): void {
    this.#stop();
  }

  /** Leaves for the title once chosen and no completion write is in flight. */
  #leave(): void {
    if (!this.#returnWanted || this.#save.state === 'saving') return;
    this.#returnWanted = false;
    this.#options.returnToTitle();
  }
}
