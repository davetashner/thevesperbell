// A minimal conversation readout (mw-e22.9): the line being said, or the options on offer, in a box
// at the bottom of the screen, with how to continue. It exists so a conversation can be had and read
// before the real dialogue screen (mw-e22.10 replaces it); it is a HUD widget like the Interact
// prompt: it shows a view model the game derives from the dialogue runtime and writes the DOM only
// when a shown value changes.

import { h } from './components/dom';
import { WriteCache, type HudWidget } from './hud';

/** One option on offer. */
export interface DialogueBoxChoice {
  readonly text: string;
  readonly locked: boolean;
  /** Why it is locked; empty otherwise. */
  readonly reason: string;
}

/** What the box shows; null hides it (no conversation). */
export interface DialogueBoxModel {
  /** Who speaks; empty for a choice. */
  readonly speaker: string;
  /** The line; empty for a choice. */
  readonly text: string;
  /** The options, empty while a line is showing. */
  readonly choices: readonly DialogueBoxChoice[];
  /** How to go on ("Enter to continue"). */
  readonly hint: string;
}

/** The conversation readout widget; put its element in `ui.hud`. */
export class DialogueBox implements HudWidget<DialogueBoxModel | null> {
  readonly element: HTMLElement;
  readonly #speaker: HTMLElement;
  readonly #text: HTMLElement;
  readonly #choices: HTMLElement;
  readonly #hint: HTMLElement;
  readonly #cache = new WriteCache();

  constructor() {
    this.#speaker = h('p', { className: 'vb-dialogue-speaker', data: { part: 'speaker' } });
    this.#text = h('p', { className: 'vb-dialogue-text', data: { part: 'text' } });
    this.#choices = h('ol', { className: 'vb-dialogue-choices', data: { part: 'choices' } });
    this.#hint = h('p', { className: 'vb-dialogue-hint', data: { part: 'hint' } });
    this.element = h(
      'div',
      {
        className: 'vb-dialogue',
        attrs: { role: 'log', 'aria-live': 'polite' },
        data: { testid: 'dialogue-box', uiComponent: 'dialogue' },
      },
      this.#speaker,
      this.#text,
      this.#choices,
      this.#hint,
    );
    this.element.hidden = true;
  }

  update(model: DialogueBoxModel | null): void {
    const c = this.#cache;
    c.set('shown', String(model !== null), (v) => {
      this.element.hidden = v === 'false';
    });
    if (model === null) return;
    c.set('speaker', model.speaker, (v) => {
      this.#speaker.textContent = v;
      this.#speaker.hidden = v === '';
    });
    c.set('text', model.text, (v) => {
      this.#text.textContent = v;
      this.#text.hidden = v === '';
    });
    c.set('hint', model.hint, (v) => {
      this.#hint.textContent = v;
    });
    c.set('choices', JSON.stringify(model.choices), () => {
      this.#choices.replaceChildren(
        ...model.choices.map((choice) =>
          h('li', {
            className: 'vb-dialogue-choice',
            text: choice.locked ? `${choice.text} (${choice.reason})` : choice.text,
            data: { locked: String(choice.locked) },
          }),
        ),
      );
      this.#choices.hidden = model.choices.length === 0;
    });
  }
}
