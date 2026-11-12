// The dialogue screen (mw-e22.10): what the player reads a conversation on. A HUD widget like the
// Interact prompt: it shows a view model the game derives from the dialogue runtime
// (src/game/conversation) and writes the DOM only when a shown value changes.
//
// - Speaker name and a portrait slot (a generic silhouette until the art lands, mw-e37.137).
// - The line reveals at the reveal speed setting (or whole, when instant); Enter skips the reveal.
//   The words not yet shown are transparent, not absent, so the line never reflows as it types and a
//   screen reader reads it whole. A separate live region announces each line once.
// - Options in a list: number keys, arrows, the pad and the mouse pick; tags render as glyph + label;
//   a locked option is greyed and, while focused, shows why; a choice that leads to a check shows its
//   odds label; a resolved check shows its score breakdown.
// - A history panel (scrollback) over the same box.
// - Text size, text background opacity and high contrast come from the UI root's comfort settings
//   (comfort.ts); the box scrolls rather than clips at any size.

import { h } from './components/dom';
import { WriteCache, type HudWidget } from './hud';

export const REVEAL_SPEEDS = ['instant', 'slow', 'normal', 'fast'] as const;
export type RevealSpeed = (typeof REVEAL_SPEEDS)[number];

/** Characters a second for each reveal speed (instant shows the whole line at once). */
export const REVEAL_CHARS_PER_SECOND: Readonly<Record<RevealSpeed, number>> = Object.freeze({
  instant: Number.POSITIVE_INFINITY,
  slow: 20,
  normal: 45,
  fast: 90,
});

/** An option tag: a glyph and its "[Thief]" label. */
export interface DialogueBoxTag {
  readonly kind: 'class' | 'capability' | 'item';
  readonly glyph: string;
  readonly label: string;
}

/** The odds of the check an option leads to ("Persuade: fair"). */
export interface DialogueBoxOdds {
  readonly level: 'easy' | 'fair' | 'hard' | 'impossible';
  readonly label: string;
}

/** One option on offer. */
export interface DialogueBoxChoice {
  readonly text: string;
  readonly locked: boolean;
  /** Why it is locked; empty otherwise. */
  readonly reason: string;
  readonly tags: readonly DialogueBoxTag[];
  readonly odds?: DialogueBoxOdds;
}

/** What a persuasion check came to. */
export interface DialogueBoxOutcome {
  readonly success: boolean;
  readonly title: string;
  readonly lines: readonly string[];
}

/** One entry of the history panel. */
export interface DialogueHistoryEntry {
  readonly kind: 'line' | 'choice' | 'check' | 'divider';
  /** Who said it; empty for the rest. */
  readonly speaker: string;
  readonly text: string;
}

/** The words the box labels itself with. */
export interface DialogueBoxLabels {
  readonly replies: string;
  readonly locked: string;
  readonly history: string;
  readonly historyTitle: string;
  readonly historyEmpty: string;
}

/** What the box shows; null hides it (no conversation). */
export interface DialogueBoxModel {
  /** Who speaks (the last speaker while options are on offer). */
  readonly speaker: string;
  /** Which portrait; the slot shows a silhouette whatever it is. */
  readonly portrait: string;
  /** The line (the last one while options are on offer). */
  readonly text: string;
  /** Changes with every new line, so the reveal restarts. */
  readonly lineKey: number;
  /** The options, empty while a line is showing. */
  readonly choices: readonly DialogueBoxChoice[];
  /** The option the cursor is on. */
  readonly focus: number;
  /** How to go on. */
  readonly hint: string;
  /** The last check's result, until the player moves on. */
  readonly outcome?: DialogueBoxOutcome;
  readonly history: readonly DialogueHistoryEntry[];
  readonly historyOpen: boolean;
  readonly labels: DialogueBoxLabels;
}

/** What the pointer can do. */
export interface DialogueBoxHandlers {
  /** An option was clicked (0-based). */
  readonly choose?: (index: number) => void;
  /** The pointer moved onto an option. */
  readonly focus?: (index: number) => void;
  /** The line was clicked. */
  readonly advance?: () => void;
  /** The history button was clicked. */
  readonly toggleHistory?: () => void;
}

/** The conversation widget; put its element in `ui.hud`. */
export class DialogueBox implements HudWidget<DialogueBoxModel | null> {
  readonly element: HTMLElement;
  readonly #handlers: DialogueBoxHandlers;
  readonly #portrait: HTMLElement;
  readonly #speaker: HTMLElement;
  readonly #shown: HTMLElement;
  readonly #pending: HTMLElement;
  readonly #text: HTMLElement;
  readonly #outcome: HTMLElement;
  readonly #choices: HTMLElement;
  readonly #hint: HTMLElement;
  readonly #historyButton: HTMLButtonElement;
  readonly #history: HTMLElement;
  readonly #historyTitle: HTMLElement;
  readonly #historyList: HTMLElement;
  readonly #announce: HTMLElement;
  readonly #cache = new WriteCache();
  #speed: RevealSpeed = 'normal';
  #line = '';
  #key = -1;
  #count = 0;
  #startMs: number | undefined;

  constructor(handlers: DialogueBoxHandlers = {}) {
    this.#handlers = handlers;
    this.#portrait = h('div', {
      className: 'vb-dialogue-portrait',
      attrs: { 'aria-hidden': 'true' },
      data: { part: 'portrait' },
    });
    this.#speaker = h('p', { className: 'vb-dialogue-speaker', data: { part: 'speaker' } });
    this.#shown = h('span', { className: 'vb-dialogue-shown' });
    this.#pending = h('span', { className: 'vb-dialogue-pending' });
    this.#text = h(
      'p',
      { className: 'vb-dialogue-text', data: { part: 'text' } },
      this.#shown,
      this.#pending,
    );
    this.#text.addEventListener('click', () => {
      this.#handlers.advance?.();
    });
    this.#outcome = h('div', { className: 'vb-dialogue-outcome', data: { part: 'outcome' } });
    this.#choices = h('ol', {
      className: 'vb-dialogue-choices',
      attrs: { role: 'listbox' },
      data: { part: 'choices' },
    });
    this.#hint = h('p', { className: 'vb-dialogue-hint', data: { part: 'hint' } });
    this.#historyButton = h('button', {
      className: 'vb-dialogue-history-button',
      attrs: { type: 'button', tabindex: '-1', 'aria-expanded': 'false' },
      data: { part: 'history-button' },
    });
    this.#historyButton.addEventListener('click', () => {
      this.#handlers.toggleHistory?.();
    });
    this.#historyTitle = h('h2', { className: 'vb-dialogue-history-title' });
    this.#historyList = h('ol', { className: 'vb-dialogue-history-list' });
    this.#history = h(
      'section',
      { className: 'vb-dialogue-history', data: { part: 'history' } },
      this.#historyTitle,
      this.#historyList,
    );
    this.#announce = h('p', {
      className: 'vb-dialogue-announce',
      attrs: { role: 'log', 'aria-live': 'polite' },
      data: { part: 'announce' },
    });
    const body = h(
      'div',
      { className: 'vb-dialogue-body' },
      this.#speaker,
      this.#text,
      this.#outcome,
      this.#choices,
    );
    const main = h('div', { className: 'vb-dialogue-main' }, this.#portrait, body);
    this.element = h(
      'div',
      {
        className: 'vb-dialogue',
        attrs: { 'aria-label': 'Dialogue' },
        data: { testid: 'dialogue-box', uiComponent: 'dialogue' },
      },
      main,
      this.#history,
      h('div', { className: 'vb-dialogue-foot' }, this.#hint, this.#historyButton),
      this.#announce,
    );
    this.element.hidden = true;
  }

  /** The reveal speed setting. */
  setRevealSpeed(speed: RevealSpeed): void {
    this.#speed = speed;
    if (speed === 'instant') this.finishReveal();
  }

  /** The line is still being typed out. */
  get revealing(): boolean {
    return this.#count < this.#line.length;
  }

  /** Shows the rest of the line now. */
  finishReveal(): void {
    this.#count = this.#line.length;
    this.#paintReveal();
  }

  /** Types the line out; call once a frame. */
  frame(nowMs: number): void {
    if (!this.revealing) return;
    this.#startMs ??= nowMs;
    const rate = REVEAL_CHARS_PER_SECOND[this.#speed];
    this.#count = Math.min(this.#line.length, Math.floor(((nowMs - this.#startMs) / 1000) * rate));
    this.#paintReveal();
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
    c.set('portrait', model.portrait, (v) => {
      this.#portrait.dataset['portrait'] = v;
    });
    if (model.lineKey !== this.#key) {
      this.#key = model.lineKey;
      this.#line = model.text;
      this.#startMs = undefined;
      // A line shown again beside its options is already read; only a new one is typed out.
      this.#count = this.#speed === 'instant' || model.choices.length > 0 ? model.text.length : 0;
      this.#paintReveal();
    } else if (model.choices.length > 0) {
      this.finishReveal();
    }
    this.#text.hidden = model.text === '';
    c.set('announce', `${model.speaker}\n${model.text}\n${String(model.choices.length)}`, () => {
      this.#announce.textContent =
        model.choices.length === 0
          ? `${model.speaker}: ${model.text}`
          : `${model.labels.replies}: ${model.choices.map((x) => x.text).join('. ')}`;
    });
    c.set('hint', model.hint, (v) => {
      this.#hint.textContent = v;
    });
    c.set('outcome', JSON.stringify(model.outcome ?? null), () => {
      const outcome = model.outcome;
      this.#outcome.hidden = outcome === undefined;
      this.#outcome.dataset['success'] = String(outcome?.success ?? false);
      this.#outcome.replaceChildren(
        ...(outcome === undefined
          ? []
          : [
              h('p', { className: 'vb-dialogue-outcome-title', text: outcome.title }),
              ...outcome.lines.map((line) =>
                h('p', { className: 'vb-dialogue-outcome-line', text: line }),
              ),
            ]),
      );
    });
    c.set('choices', JSON.stringify([model.choices, model.focus, model.labels]), () => {
      this.#renderChoices(model);
    });
    c.set('history', JSON.stringify([model.history, model.historyOpen, model.labels]), () => {
      this.#renderHistory(model);
    });
  }

  #paintReveal(): void {
    this.#shown.textContent = this.#line.slice(0, this.#count);
    this.#pending.textContent = this.#line.slice(this.#count);
  }

  #renderChoices(model: DialogueBoxModel): void {
    const list = this.#choices;
    list.hidden = model.choices.length === 0;
    list.setAttribute('aria-label', model.labels.replies);
    list.replaceChildren(
      ...model.choices.map((choice, index) => {
        const focused = index === model.focus;
        const reasonId = `vb-dialogue-reason-${String(index)}`;
        const label = h('span', { className: 'vb-dialogue-choice-text' }, choice.text);
        const parts: (Node | string)[] = [
          h('span', { className: 'vb-dialogue-number', text: `${String(index + 1)}.` }),
          ...(choice.locked
            ? [
                h('span', {
                  className: 'vb-dialogue-lock',
                  text: '⊗',
                  attrs: { 'aria-hidden': 'true' },
                }),
              ]
            : []),
          ...choice.tags.map((tag) =>
            h(
              'span',
              { className: 'vb-dialogue-tag', data: { kind: tag.kind } },
              h('span', {
                className: 'vb-dialogue-tag-glyph',
                text: tag.glyph,
                attrs: { 'aria-hidden': 'true' },
              }),
              h('span', { className: 'vb-dialogue-tag-label', text: tag.label }),
            ),
          ),
          label,
          ...(choice.odds === undefined
            ? []
            : [
                h('span', {
                  className: 'vb-dialogue-odds',
                  text: choice.odds.label,
                  data: { level: choice.odds.level },
                }),
              ]),
        ];
        const item = h(
          'li',
          {
            className: 'vb-dialogue-choice',
            attrs: {
              role: 'option',
              'aria-selected': String(focused),
              ...(choice.locked && { 'aria-disabled': 'true', 'aria-describedby': reasonId }),
            },
            data: { locked: String(choice.locked), focused: String(focused) },
          },
          ...parts,
        );
        if (choice.locked) {
          const reason = h('span', {
            className: 'vb-dialogue-reason',
            text: choice.reason,
            attrs: { id: reasonId },
            data: { part: 'reason' },
          });
          reason.hidden = !focused;
          item.append(reason);
        }
        item.addEventListener('click', () => {
          this.#handlers.choose?.(index);
        });
        item.addEventListener('pointerenter', () => {
          this.#handlers.focus?.(index);
        });
        return item;
      }),
    );
  }

  #renderHistory(model: DialogueBoxModel): void {
    this.#history.hidden = !model.historyOpen;
    this.element.dataset['history'] = String(model.historyOpen);
    this.#historyButton.textContent = model.labels.history;
    this.#historyButton.setAttribute('aria-expanded', String(model.historyOpen));
    this.#historyTitle.textContent = model.labels.historyTitle;
    this.#historyList.replaceChildren(
      ...(model.history.length === 0
        ? [h('li', { className: 'vb-dialogue-history-empty', text: model.labels.historyEmpty })]
        : model.history.map((entry) =>
            h(
              'li',
              { className: 'vb-dialogue-history-entry', data: { kind: entry.kind } },
              ...(entry.speaker === ''
                ? [entry.text]
                : [h('strong', { text: `${entry.speaker}: ` }), entry.text]),
            ),
          )),
    );
    if (model.historyOpen) this.#history.scrollTop = this.#history.scrollHeight;
  }

  /** Scrolls the history panel by `pixels` (the arrows while it is open). */
  scrollHistory(pixels: number): void {
    this.#history.scrollTop += pixels;
  }
}
