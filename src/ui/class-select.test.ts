// @vitest-environment happy-dom
// The class selection screen (mw-e19.5): the cards it shows, highlighting with confirm or a click,
// Confirm disabled until a class is highlighted, and Back never leaving a new game without a class.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLASS_SELECT_SCREEN,
  CLASS_SELECT_TEXT,
  highlightedText,
  lockedText,
  openClassSelect,
  type ClassCardModel,
} from '@ui/class-select';
import { UiRoot } from '@ui/screens';
import { find } from '@ui/testing/layout';

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true });
});

const KNIGHT: ClassCardModel = {
  id: 'knight',
  name: 'Knight',
  pitch: 'Steel.',
  verbs: ['Parry', 'Bash', 'Plate'],
  kit: ['Sword'],
};
const THIEF: ClassCardModel = {
  id: 'thief',
  name: 'Thief',
  pitch: 'Shadows.',
  verbs: ['Pick', 'Lift', 'Climb'],
  kit: ['Knife', '40 gold'],
};
const CARDS: readonly ClassCardModel[] = [KNIGHT, THIEF];

const card = (id: string): HTMLElement => find(`[data-class="${id}"]`);
const texts = (selector: string, root: ParentNode): string[] =>
  [...root.querySelectorAll(selector)].map((el) => el.textContent);

describe('class selection screen', () => {
  it('shows a card per class with its pitch, verbs and kit, focused on the first', () => {
    const select = openClassSelect(ui, { cards: CARDS, onConfirm: vi.fn() });
    expect(select.screen.id).toBe(CLASS_SELECT_SCREEN);
    expect(ui.pausesSim && ui.capturesInput).toBe(true);
    expect(find('[role="radiogroup"]').getAttribute('aria-label')).toBe(CLASS_SELECT_TEXT.group);
    const thief = card('thief');
    expect(thief.getAttribute('role')).toBe('radio');
    expect(document.getElementById(thief.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
      'Thief',
    );
    expect(texts('p', thief)).toEqual(['Shadows.']);
    expect(texts('[data-verbs] li', thief)).toEqual(['Pick', 'Lift', 'Climb']);
    expect(texts('[data-kit] li', thief)).toEqual(['Knife', '40 gold']);
    expect(document.activeElement).toBe(card('knight'));
    expect(select.highlighted).toBeUndefined();
    expect(find('[data-testid="class-select-status"]').textContent).toBe(CLASS_SELECT_TEXT.none);
  });

  it('highlights the focused card on confirm and moves focus to an enabled Confirm', () => {
    const onConfirm = vi.fn();
    const select = openClassSelect(ui, { cards: CARDS, onConfirm });
    expect(select.confirm.disabled).toBe(true);
    ui.intent('confirm', 'gamepad');
    expect(select.highlighted).toBe('knight');
    expect(card('knight').getAttribute('aria-checked')).toBe('true');
    expect(select.confirm.disabled).toBe(false);
    expect(document.activeElement).toBe(select.confirm);
    expect(find('[data-testid="class-select-status"]').textContent).toBe(highlightedText('Knight'));

    // A click highlights another; only one card is checked.
    card('thief').click();
    expect(select.highlighted).toBe('thief');
    expect(card('knight').getAttribute('aria-checked')).toBe('false');
    expect(onConfirm).not.toHaveBeenCalled();

    ui.intent('confirm', 'gamepad');
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('thief');
    expect(ui.top).toBeUndefined();
  });

  it('keeps Confirm inert while nothing is highlighted, and Back never closes the screen', () => {
    const onConfirm = vi.fn();
    const select = openClassSelect(ui, { cards: CARDS, onConfirm });
    select.confirm.disabled = false; // even a forced press does nothing without a highlight
    select.confirm.click();
    expect(onConfirm).not.toHaveBeenCalled();
    ui.intent('back', 'keyboard');
    expect(ui.top?.id).toBe(CLASS_SELECT_SCREEN);
  });

  it('mw-e31.11 AC-3: with an onBack, Back (Esc or B) closes class selection and calls it', () => {
    const onBack = vi.fn();
    const onConfirm = vi.fn();
    openClassSelect(ui, { cards: CARDS, onConfirm, onBack });
    ui.intent('back', 'gamepad');
    expect(onBack).toHaveBeenCalledOnce();
    expect(ui.top).toBeUndefined();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('opens with no cards without a focus target', () => {
    const select = openClassSelect(ui, { cards: [], onConfirm: vi.fn() });
    expect(select.confirm.disabled).toBe(true);
    expect(document.querySelectorAll('[role="radio"]')).toHaveLength(0);
  });

  it('AC-1: a locked card shows a lock badge and the reason, stays focusable, and focus starts on the first playable card', () => {
    const cards = [{ ...KNIGHT, locked: true }, THIEF];
    openClassSelect(ui, { cards, onConfirm: vi.fn() });
    const knight = card('knight');
    expect(knight.dataset['locked']).toBe('');
    expect(knight.getAttribute('aria-disabled')).toBe('true');
    expect(knight.getAttribute('tabindex')).toBe('0');
    expect(find('[data-part="lock"]', knight).textContent).toBe(CLASS_SELECT_TEXT.lockBadge);
    expect(find('[data-part="lock-reason"]', knight).textContent).toBe(
      'Not playable in this build yet',
    );
    expect(knight.getAttribute('aria-describedby')).toBe(
      find('[data-part="lock-reason"]', knight).id,
    );
    expect(card('thief').querySelector('[data-part="lock"]')).toBeNull();
    expect(card('thief').hasAttribute('aria-describedby')).toBe(false);
    expect(document.activeElement).toBe(card('thief'));
  });

  it('AC-2: a locked card never highlights; Confirm is disabled with the reason while it holds focus', () => {
    const onConfirm = vi.fn();
    const select = openClassSelect(ui, {
      cards: [KNIGHT, { ...THIEF, locked: true }],
      onConfirm,
    });
    const status = find('[data-testid="class-select-status"]');
    card('thief').focus();
    expect(select.confirm.disabled).toBe(true);
    expect(select.confirm.dataset['reason']).toBe(CLASS_SELECT_TEXT.lockReason);
    expect(status.textContent).toBe(lockedText('Thief'));
    ui.intent('confirm', 'gamepad');
    card('thief').click();
    expect(select.highlighted).toBeUndefined();
    expect(card('thief').getAttribute('aria-checked')).toBe('false');

    // Back on a playable card with nothing highlighted, Confirm stays disabled but loses the reason.
    card('knight').focus();
    expect(select.confirm.disabled).toBe(true);
    expect(select.confirm.hasAttribute('title')).toBe(false);
    expect(select.confirm.dataset['reason']).toBeUndefined();
    expect(status.textContent).toBe(CLASS_SELECT_TEXT.none);
    ui.intent('confirm', 'keyboard');
    expect(status.textContent).toBe(highlightedText('Knight'));
    select.confirm.click();
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('knight');
  });

  it('focuses the first card when every class is locked', () => {
    const select = openClassSelect(ui, {
      cards: CARDS.map((c) => ({ ...c, locked: true })),
      onConfirm: vi.fn(),
    });
    expect(document.activeElement).toBe(card('knight'));
    expect(select.confirm.disabled).toBe(true);
  });
});
