// The game clock on the HUD (mw-e27.13): "Day 1 · 06:00" in a corner, so resting and the passing of
// the night can be felt. It shows the text it is given and writes the DOM only when that changes.

import { h } from './components/dom';
import { WriteCache } from './hud';

/** What the clock shows. */
export interface ClockViewModel {
  /** The text, e.g. "Day 2 · 06:00". */
  readonly text: string;
  /** The phase of the day (`dawn`, `day`, `dusk`, `night`), exposed as `data-phase` for styling. */
  readonly phase: string;
}

/** A small read-only clock widget. */
export class ClockHud {
  readonly element: HTMLElement;
  readonly #cache = new WriteCache();

  constructor() {
    this.element = h('div', {
      className: 'vb-clock',
      attrs: { role: 'timer', 'aria-label': 'Game time' },
      data: { testid: 'clock-hud' },
    });
  }

  update(model: ClockViewModel): void {
    this.#cache.set('text', model.text, (text) => {
      this.element.textContent = text;
    });
    this.#cache.set('phase', model.phase, (phase) => {
      this.element.dataset['phase'] = phase;
    });
  }
}
