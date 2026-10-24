// The casting reticle (mw-e06.15): a small cross at the centre of the view while a spell is selected,
// with the spell's name under it. It is the camera ray's anchor — the cast goes where it points — and
// shows three states from the model the game derives (src/game/magic/hud.ts):
//
// - ready      a cast would start now
// - far        the aim ran past the spell's range and was brought back to it (a dimmer cross)
// - invalid    the cast would be refused (a red cross and the reason under it): no floor to place an
//              area on, no target in reach, not enough mana…
//
// Like every HUD widget it reads no sim state and writes the DOM only when the model changed.

import { h } from './components/dom';
import { WriteCache, type HudWidget } from './hud';

export type ReticleState = 'ready' | 'far' | 'invalid';

/** What the reticle shows this frame. */
export interface ReticleModel {
  /** Hidden when no spell is selected. */
  readonly visible: boolean;
  readonly state: ReticleState;
  /** The selected spell's name. */
  readonly spell: string;
  /** Why a cast would be refused (shown while invalid), else ''. */
  readonly note: string;
}

/** Nothing selected: the reticle is hidden. */
export const NO_RETICLE: ReticleModel = Object.freeze({
  visible: false,
  state: 'ready',
  spell: '',
  note: '',
});

/** The casting reticle; put its element in `ui.hud`. */
export class Reticle implements HudWidget<ReticleModel> {
  readonly element: HTMLElement;
  readonly #label: HTMLElement;
  readonly #note: HTMLElement;
  readonly #cache = new WriteCache();

  constructor() {
    this.#label = h('span', { className: 'vb-reticle-spell' });
    this.#note = h('span', { className: 'vb-reticle-note' });
    this.element = h(
      'div',
      {
        className: 'vb-reticle',
        attrs: { 'aria-hidden': 'true', hidden: '' },
        data: { testid: 'reticle', uiComponent: 'reticle', state: 'ready' },
      },
      h('span', { className: 'vb-reticle-cross' }),
      this.#label,
      this.#note,
    );
  }

  update(model: ReticleModel): void {
    const c = this.#cache;
    c.set('shown', String(model.visible), () => {
      this.element.hidden = !model.visible;
    });
    c.set('state', model.state, (v) => (this.element.dataset['state'] = v));
    c.set('spell', model.spell, (v) => {
      this.#label.textContent = v;
      this.element.dataset['spell'] = v;
    });
    c.set('note', model.note, (v) => {
      this.#note.textContent = v;
    });
  }
}
