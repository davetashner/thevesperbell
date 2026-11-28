// The rest menu (mw-e27.13): what the player sees on interacting with an inn bed, campfire or shrine.
// A heading, one button per duration the point offers (Until dawn, Until dusk, 2 hours...), the
// actions other systems added to the rest menu (arrow assembly, artifact recharge; disabled ones show
// why), a status line, and Close. It pauses the sim while open and never changes game state: it
// reports the choice and the game decides what it does. `say` shows the outcome ("You wake at 06:00")
// and `render` redraws the lists after something changed.

import { button } from './components/controls';
import { h } from './components/dom';
import { UI_INTENT_GLYPHS } from './components/overlays';
import type { Screen, UiRoot } from './screens';

/** `data-screen` of the rest window. */
export const REST_SCREEN = 'rest';

export const REST_TEXT = Object.freeze({
  close: 'Leave',
  hint: `${UI_INTENT_GLYPHS.keyboard.back} or ${UI_INTENT_GLYPHS.gamepad.back}: Leave.`,
});

/** One line of the menu: a duration or an action. */
export interface RestChoice {
  readonly id: string;
  readonly label: string;
  /** Why it cannot be chosen now; empty or absent when it can. */
  readonly reason?: string | undefined;
}

/** What the rest window shows. */
export interface RestWindowModel {
  readonly title: string;
  readonly durations: readonly RestChoice[];
  readonly actions: readonly RestChoice[];
}

export interface RestWindowOptions {
  readonly model: RestWindowModel;
  /** A duration was chosen. */
  readonly onRest: (id: string) => void;
  /** A rest action was chosen. */
  readonly onAction: (id: string) => void;
  /** The window closed (Esc, B or Leave). */
  readonly onClose?: () => void;
}

export interface RestWindow {
  readonly screen: Screen;
  /** Shows `text` on the status line. */
  say(text: string): void;
  /** Redraws the lists from `model`. */
  render(model: RestWindowModel): void;
  close(): void;
}

/** Opens the rest window on `ui`. */
export function openRestWindow(ui: UiRoot, options: RestWindowOptions): RestWindow {
  const title = h('h1', { text: options.model.title });
  const durations = h('div', {
    className: 'vb-stack',
    attrs: { role: 'group', 'aria-label': 'Rest for' },
    data: { testid: 'rest-durations' },
  });
  const actions = h('div', {
    className: 'vb-stack',
    attrs: { role: 'group', 'aria-label': 'Rest actions' },
    data: { testid: 'rest-actions' },
  });
  const status = h('p', {
    attrs: { role: 'status' },
    data: { testid: 'rest-status' },
  });
  const leave = button({
    label: REST_TEXT.close,
    onPress: () => {
      screen.close();
    },
  });
  leave.dataset['action'] = 'leave';

  const choiceButton = (
    choice: RestChoice,
    kind: 'rest' | 'action',
    press: (id: string) => void,
    autofocus: boolean,
  ): HTMLButtonElement => {
    const reason = choice.reason ?? '';
    const el = button({
      label: choice.label,
      disabled: reason !== '',
      autofocus,
      onPress: () => {
        press(choice.id);
      },
    });
    el.dataset['action'] = `${kind}:${choice.id}`;
    if (reason !== '') el.title = reason;
    return el;
  };

  function render(model: RestWindowModel): void {
    title.textContent = model.title;
    const first = model.durations.findIndex((choice) => (choice.reason ?? '') === '');
    durations.replaceChildren(
      ...model.durations.map((choice, i) =>
        choiceButton(choice, 'rest', options.onRest, i === Math.max(first, 0)),
      ),
    );
    actions.hidden = model.actions.length === 0;
    actions.replaceChildren(
      ...model.actions.map((choice) => choiceButton(choice, 'action', options.onAction, false)),
    );
  }

  render(options.model);
  const screen = ui.push({
    id: REST_SCREEN,
    label: options.model.title,
    content: h(
      'div',
      { className: 'vb-panel vb-stack', data: { testid: 'rest-window' } },
      title,
      durations,
      actions,
      status,
      leave,
      h('p', { text: REST_TEXT.hint }),
    ),
    pausesSim: true,
    ...(options.onClose !== undefined && { onClose: options.onClose }),
  });

  return {
    screen,
    say: (text) => {
      status.textContent = text;
    },
    render,
    close: () => {
      screen.close();
    },
  };
}
