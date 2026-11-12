// @vitest-environment happy-dom
// The slice-complete card (mw-e01.18): its content, focus and keyboard/gamepad operation. The game
// side (when it opens, the autosave outcome) is src/game/ui/slice-complete.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completionSaveText,
  openSliceComplete,
  SLICE_COMPLETE_SCREEN,
  SLICE_COMPLETE_TEXT,
} from '@ui/slice-complete';
import { UiRoot } from '@ui/screens';

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true });
});

const text = (testid: string): string | null =>
  document.querySelector(`[data-testid="${testid}"]`)?.textContent ?? null;

describe('the slice-complete card (mw-e01.18)', () => {
  it('AC-2: a run of 9000 ticks at 60 Hz shows 2:30, with the class', () => {
    openSliceComplete(ui, {
      seconds: 9000 / 60,
      className: 'Knight',
      save: { state: 'saved' },
      onReturn: vi.fn(),
    });
    expect(text('slice-complete-time')).toBe('Run time: 2:30');
    expect(text('slice-complete-class')).toBe('Class: Knight');
    expect(document.querySelector('h2')?.textContent).toBe(SLICE_COMPLETE_TEXT.heading);
  });

  it('AC-1: Return to title is focused, captures input and does not pause the sim', () => {
    const onReturn = vi.fn();
    const card = openSliceComplete(ui, {
      seconds: 0,
      className: '',
      save: { state: 'saving' },
      onReturn,
    });
    expect(document.activeElement).toBe(card.returnButton);
    expect(card.returnButton.textContent).toBe('Return to title');
    expect(ui.capturesInput).toBe(true);
    expect(ui.pausesSim).toBe(false);
    expect(ui.top?.id).toBe(SLICE_COMPLETE_SCREEN);
    expect(document.querySelector('[data-testid="slice-complete-class"]')).toBeNull();
    card.returnButton.click();
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('Enter on the focused button returns to the title', () => {
    const onReturn = vi.fn();
    const keys = new EventTarget();
    ui.attachInput({ window: keys, now: () => 0 });
    openSliceComplete(ui, { seconds: 0, className: '', save: { state: 'saved' }, onReturn });
    keys.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', cancelable: true }));
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('mw-e24.21: Continue, when offered, closes the card; without it there is no such button', () => {
    openSliceComplete(ui, {
      seconds: 0,
      className: '',
      save: { state: 'saved' },
      onReturn: vi.fn(),
    });
    expect(document.querySelector('[data-testid="slice-complete-continue"]')).toBeNull();
    ui.top?.close();
    const onContinue = vi.fn(() => {
      ui.top?.close();
    });
    const card = openSliceComplete(ui, {
      seconds: 0,
      className: '',
      save: { state: 'saved' },
      onReturn: vi.fn(),
      onContinue,
    });
    // Return to title stays the focused choice.
    expect(document.activeElement).toBe(card.returnButton);
    document.querySelector<HTMLElement>('[data-testid="slice-complete-continue"]')?.click();
    expect(onContinue).toHaveBeenCalledOnce();
    expect(ui.top).toBeUndefined();
  });

  it('Back does not dismiss the card', () => {
    openSliceComplete(ui, {
      seconds: 0,
      className: '',
      save: { state: 'saved' },
      onReturn: vi.fn(),
    });
    const keys = new EventTarget();
    ui.attachInput({ window: keys, now: () => 0 });
    keys.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', cancelable: true }));
    expect(ui.top?.id).toBe(SLICE_COMPLETE_SCREEN);
  });

  it('AC-4: the save line follows the save and never claims a save that did not happen', () => {
    const card = openSliceComplete(ui, {
      seconds: 0,
      className: '',
      save: { state: 'saving' },
      onReturn: vi.fn(),
    });
    expect(text('slice-complete-save')).toBe(SLICE_COMPLETE_TEXT.saving);
    card.setSave({ state: 'unsaved', reason: "Can't save during combat" });
    expect(text('slice-complete-save')).toBe("This run was not saved. Can't save during combat");
    card.setSave({ state: 'saved' });
    expect(text('slice-complete-save')).toBe(SLICE_COMPLETE_TEXT.saved);
    expect(completionSaveText({ state: 'unsaved' })).toBe(SLICE_COMPLETE_TEXT.notSaved);
    expect(completionSaveText({ state: 'unsaved', reason: '' })).toBe(SLICE_COMPLETE_TEXT.notSaved);
  });
});
