// The contest screens (mw-opf6): the entry window and the in-play panel for a data-defined contest
// (src/content/types/contest.ts, run by src/sim/contest).
//
// - The entry window is a modal screen that pauses the sim. It shows the rules (who, how it ends), the
//   entry fee against the player's crowns, and the book's offers: a bet on yourself at fixed odds with
//   a stake stepper, or the offer to throw the match for a payout. The player picks one (or none) and
//   presses Enter the contest; a refusal comes back as a line on the status and the window stays open.
//   It never changes game state: the game places the entry, the bet and the contest.
// - The in-play panel is a HUD widget (never focusable, the game keeps running under it): the
//   standings, an optional grip meter, the keys to play with and the last thing that happened.
//   Keys are read by the game, which owns input; the panel only says what they are.
//
// Every size is in em so both follow the text-size setting.

import { button } from './components/controls';
import { h } from './components/dom';
import type { Screen, UiRoot } from './screens';

/** `data-screen` of the entry window. */
export const CONTEST_SCREEN = 'contest';

export const CONTEST_TEXT = Object.freeze({
  crowns: 'Your crowns',
  fee: 'Entry fee',
  noBet: 'No bet',
  stake: 'Stake',
  fewer: 'Lower the stake',
  more: 'Raise the stake',
  enter: 'Enter the contest',
  leave: 'Walk away',
  standings: 'Standings',
});

/** The book's bet on the player. */
export interface ContestBetOffer {
  readonly book: string;
  readonly numerator: number;
  readonly denominator: number;
  readonly minStake: number;
  readonly maxStake: number;
}

/** The book's offer to throw the match. */
export interface ContestThrowOffer {
  readonly book: string;
  /** Crowns for a clean loss. */
  readonly payout: number;
}

export interface ContestWindowModel {
  readonly name: string;
  /** The rules in a line: who you face and how it ends. */
  readonly rules: string;
  readonly fee: number;
  readonly crowns: number;
  readonly bet?: ContestBetOffer;
  readonly offer?: ContestThrowOffer;
}

/** What the player chose to stake. */
export type ContestChoice =
  | { readonly kind: 'none' }
  | { readonly kind: 'onPlayer'; readonly stake: number }
  | { readonly kind: 'throw' };

export interface ContestWindowOptions {
  readonly model: ContestWindowModel;
  /** The player pressed Enter: returns the reason it was refused (the window stays), or undefined. */
  readonly onStart: (choice: ContestChoice) => string | undefined;
  readonly onClose?: () => void;
}

export interface ContestWindow {
  readonly screen: Screen;
  /** The current choice. */
  choice(): ContestChoice;
  close(): void;
}

/** The text of the odds, "2:1". */
export function oddsText(offer: Pick<ContestBetOffer, 'numerator' | 'denominator'>): string {
  return `${String(offer.numerator)}:${String(offer.denominator)}`;
}

/** Opens the entry window. */
export function openContestWindow(ui: UiRoot, options: ContestWindowOptions): ContestWindow {
  const { model } = options;
  let kind: ContestChoice['kind'] = 'none';
  let stake = model.bet?.minStake ?? 0;

  const status = h('p', {
    className: 'vb-contest-status',
    attrs: { role: 'status' },
    data: { testid: 'contest-status' },
  });
  const stakeText = h('span', { className: 'vb-contest-stake', data: { testid: 'contest-stake' } });
  const choices = new Map<ContestChoice['kind'], HTMLButtonElement>();

  const choose = (next: ContestChoice['kind']): void => {
    kind = next;
    for (const [id, control] of choices) control.setAttribute('aria-pressed', String(id === next));
    status.textContent = '';
  };
  const addChoice = (id: ContestChoice['kind'], label: string): HTMLButtonElement => {
    const control = button({
      label,
      onPress: () => {
        choose(id);
      },
    });
    control.dataset['choice'] = id;
    choices.set(id, control);
    return control;
  };
  const none = addChoice('none', CONTEST_TEXT.noBet);

  const rows: HTMLElement[] = [none];
  if (model.bet !== undefined) {
    const { bet } = model;
    const step = (by: number): HTMLButtonElement => {
      const control = button({
        label: by < 0 ? '−' : '+',
        onPress: () => {
          stake = Math.min(bet.maxStake, Math.max(bet.minStake, stake + by));
          stakeText.textContent = `${CONTEST_TEXT.stake}: ${String(stake)}`;
          choose('onPlayer');
        },
      });
      control.setAttribute('aria-label', by < 0 ? CONTEST_TEXT.fewer : CONTEST_TEXT.more);
      control.dataset['step'] = by < 0 ? 'fewer' : 'more';
      return control;
    };
    stakeText.textContent = `${CONTEST_TEXT.stake}: ${String(stake)}`;
    rows.push(
      h(
        'div',
        { className: 'vb-row vb-contest-bet' },
        addChoice('onPlayer', `${bet.book} pays ${oddsText(bet)} on you`),
        step(-1),
        stakeText,
        step(1),
      ),
    );
  }
  if (model.offer !== undefined) {
    const { offer } = model;
    rows.push(
      addChoice('throw', `${offer.book} offers ${String(offer.payout)} crowns to throw the match`),
    );
  }

  const start = button({
    label: CONTEST_TEXT.enter,
    autofocus: true,
    onPress: () => {
      const choice: ContestChoice =
        kind === 'onPlayer' ? { kind, stake } : kind === 'throw' ? { kind } : { kind: 'none' };
      const refused = options.onStart(choice);
      if (refused === undefined) screen.close();
      else status.textContent = refused;
    },
  });
  start.dataset['action'] = 'enter';
  const leave = button({
    label: CONTEST_TEXT.leave,
    onPress: () => {
      screen.close();
    },
  });
  leave.dataset['action'] = 'leave';

  const content = h(
    'div',
    { className: 'vb-panel vb-stack vb-contest', data: { testid: 'contest-window' } },
    h('h1', { className: 'vb-contest-name', text: model.name }),
    h('p', { className: 'vb-contest-rules', text: model.rules }),
    h('p', {
      className: 'vb-contest-fee',
      text: `${CONTEST_TEXT.fee}: ${String(model.fee)}. ${CONTEST_TEXT.crowns}: ${String(model.crowns)}.`,
      data: { testid: 'contest-fee' },
    }),
    h('div', { className: 'vb-stack', attrs: { role: 'group', 'aria-label': 'Bets' } }, ...rows),
    status,
    h('div', { className: 'vb-row' }, start, leave),
  );
  choose('none');

  const screen = ui.push({
    id: CONTEST_SCREEN,
    label: model.name,
    content,
    pausesSim: true,
    onClose: options.onClose ?? (() => undefined),
  });
  return {
    screen,
    choice: () =>
      kind === 'onPlayer' ? { kind, stake } : kind === 'throw' ? { kind } : { kind: 'none' },
    close: () => {
      screen.close();
    },
  };
}

/** One line of the standings. */
export interface ContestStandingRow {
  readonly name: string;
  readonly score: number;
  readonly you: boolean;
}

export interface ContestHudModel {
  readonly title: string;
  readonly rows: readonly ContestStandingRow[];
  /** Points that win it, when it is first to N. */
  readonly target?: number;
  /** A grip or effort meter, 0 to 1. */
  readonly meter?: { readonly label: string; readonly value: number };
  /** The keys: "F: Push". */
  readonly hints: readonly string[];
  /** The last thing that happened. */
  readonly message: string;
}

/** The in-play panel, a HUD widget. */
export class ContestHud {
  readonly element: HTMLElement;
  readonly #title = h('h2', { className: 'vb-contest-hud-title' });
  readonly #rows = h('ul', { className: 'vb-contest-hud-rows', data: { testid: 'contest-rows' } });
  readonly #meter = h('progress', {
    className: 'vb-contest-hud-meter',
    attrs: { max: '1', value: '0' },
    data: { testid: 'contest-meter' },
  });
  readonly #hints = h('p', {
    className: 'vb-contest-hud-hints',
    data: { testid: 'contest-hints' },
  });
  readonly #message = h('p', {
    className: 'vb-contest-hud-message',
    attrs: { role: 'status' },
    data: { testid: 'contest-message' },
  });

  constructor() {
    this.element = h(
      'section',
      {
        className: 'vb-contest-hud',
        attrs: { 'aria-label': CONTEST_TEXT.standings, hidden: '' },
        data: { testid: 'contest-hud' },
      },
      this.#title,
      this.#rows,
      this.#meter,
      this.#hints,
      this.#message,
    );
  }

  get visible(): boolean {
    return !this.element.hasAttribute('hidden');
  }

  show(model: ContestHudModel): void {
    this.#title.textContent = model.title;
    this.#rows.replaceChildren(
      ...model.rows.map((row) =>
        h('li', {
          className: 'vb-contest-hud-row',
          text:
            model.target === undefined
              ? `${row.name}: ${String(row.score)}`
              : `${row.name}: ${String(row.score)} of ${String(model.target)}`,
          data: { you: String(row.you) },
        }),
      ),
    );
    this.#meter.hidden = model.meter === undefined;
    if (model.meter !== undefined) {
      this.#meter.value = model.meter.value;
      this.#meter.setAttribute('aria-label', model.meter.label);
    }
    this.#hints.textContent = model.hints.join('   ');
    this.#message.textContent = model.message;
    this.element.removeAttribute('hidden');
  }

  hide(): void {
    this.element.setAttribute('hidden', '');
  }
}
