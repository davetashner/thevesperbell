// The slice-complete card (mw-e01.18, beat B8): a grey-box card shown when the player walks through
// the exit, naming the run time and the class, with "Return to title" focused. It captures input (so
// the knight stops moving) but does not pause the sim: the completion autosave is written by the sim
// loop, and the card says how that went. The card keeps no state the sim cares about; it only reports
// that Return to title was chosen. Ending screens and credits are E39/E38.

import { button } from './components/controls';
import { h } from './components/dom';
import { formatPlaytime } from './death-screen';
import type { Screen, UiRoot } from './screens';

/** `data-screen` of the slice-complete card. */
export const SLICE_COMPLETE_SCREEN = 'slice-complete';

export const SLICE_COMPLETE_TEXT = Object.freeze({
  heading: 'Slice complete',
  time: 'Run time',
  characterClass: 'Class',
  returnToTitle: 'Return to title',
  continueOn: 'Continue on the mountain road',
  saving: 'Saving your progress…',
  saved: 'Progress saved.',
  /** Shown when the completion autosave did not happen; never claims the run was saved. */
  notSaved: 'This run was not saved.',
});

/** How the completion autosave went. `reason` says why a save did not happen, when known. */
export type CompletionSave =
  | { readonly state: 'saving' }
  | { readonly state: 'saved' }
  | { readonly state: 'unsaved'; readonly reason?: string | undefined };

export interface SliceCompleteOptions {
  /** Seconds of playtime from New Game to completion. */
  readonly seconds: number;
  /** The class's display name ("Knight"), or empty when the run has none. */
  readonly className: string;
  readonly save: CompletionSave;
  /** Return to title was chosen (the card stays open; the game leaves for the title). */
  readonly onReturn: () => void;
  /** Continue was chosen: the card closes and the player walks on (mw-e24.21). */
  readonly onContinue?: () => void;
}

export interface SliceCompleteCard {
  readonly screen: Screen;
  /** The Return to title button (focused on open). */
  readonly returnButton: HTMLButtonElement;
  /** Updates the save line as the completion autosave settles. */
  setSave(save: CompletionSave): void;
}

/** The save line's text. */
export function completionSaveText(save: CompletionSave): string {
  if (save.state === 'saving') return SLICE_COMPLETE_TEXT.saving;
  if (save.state === 'saved') return SLICE_COMPLETE_TEXT.saved;
  return save.reason === undefined || save.reason === ''
    ? SLICE_COMPLETE_TEXT.notSaved
    : `${SLICE_COMPLETE_TEXT.notSaved} ${save.reason}`;
}

/** Opens the card. Input goes to it; Back does nothing (the way out is Return to title). */
export function openSliceComplete(ui: UiRoot, options: SliceCompleteOptions): SliceCompleteCard {
  const status = h('p', { attrs: { role: 'status' }, data: { testid: 'slice-complete-save' } });
  const setSave = (save: CompletionSave): void => {
    status.textContent = completionSaveText(save);
    status.dataset['state'] = save.state;
  };
  setSave(options.save);
  const returnButton = button({
    label: SLICE_COMPLETE_TEXT.returnToTitle,
    autofocus: true,
    // The card stays up while the game leaves for the title, so input is never handed back.
    onPress: options.onReturn,
  });
  returnButton.dataset['testid'] = 'slice-complete-return';
  const onContinue = options.onContinue;
  const continueButton =
    onContinue === undefined
      ? undefined
      : button({ label: SLICE_COMPLETE_TEXT.continueOn, onPress: onContinue });
  if (continueButton !== undefined) continueButton.dataset['testid'] = 'slice-complete-continue';
  const stat = (label: string, value: string, testid: string): HTMLElement =>
    h('p', { data: { testid } }, h('span', { text: `${label}: ` }), h('strong', { text: value }));
  const content = h(
    'div',
    { className: 'vb-panel vb-stack', data: { testid: 'slice-complete' } },
    h('h2', { text: SLICE_COMPLETE_TEXT.heading }),
    stat(SLICE_COMPLETE_TEXT.time, formatPlaytime(options.seconds), 'slice-complete-time'),
    ...(options.className === ''
      ? []
      : [stat(SLICE_COMPLETE_TEXT.characterClass, options.className, 'slice-complete-class')]),
    status,
    h(
      'div',
      { className: 'vb-row' },
      returnButton,
      ...(continueButton === undefined ? [] : [continueButton]),
    ),
  );
  const screen = ui.push({
    id: SLICE_COMPLETE_SCREEN,
    label: SLICE_COMPLETE_TEXT.heading,
    content,
    modal: true,
    onBack: () => true,
  });
  return { screen, returnButton, setSave };
}
