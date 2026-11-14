// @vitest-environment happy-dom
// The journal HUD (mw-e23.6.1): the new-entry toast, the unread mark and the pinned quest tracker.
import { find } from '@ui/testing/layout';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  JOURNAL_HUD_TEXT,
  JOURNAL_TOAST_MS,
  JournalHud,
  MAX_JOURNAL_TOASTS,
} from '@ui/journal-hud';

let hud: JournalHud;
const tracker = (): HTMLElement => find('[data-testid="quest-tracker"]', hud.element);
const mark = (): HTMLElement => find('[data-testid="journal-unread"]', hud.element);

beforeEach(() => {
  document.body.innerHTML = '';
  hud = new JournalHud();
  document.body.append(hud.element);
});

describe('new-entry toast', () => {
  it('AC-3: a toast shows for at least 3 s and then goes', () => {
    hud.toast('New journal entry: The Bounty', 1000);
    expect(JOURNAL_TOAST_MS).toBeGreaterThanOrEqual(3000);
    hud.frame(1000 + 2999);
    expect(hud.toasts).toEqual(['New journal entry: The Bounty']);
    hud.frame(1000 + JOURNAL_TOAST_MS);
    expect(hud.toasts).toEqual([]);
    expect(hud.element.querySelectorAll('[data-testid="journal-toast"]')).toHaveLength(0);
  });

  it('toasts stack in order; the oldest makes way when full; a live region announces them', () => {
    for (let i = 0; i < MAX_JOURNAL_TOASTS + 1; i++) hud.toast(`t${String(i)}`, i);
    expect(hud.toasts).toHaveLength(MAX_JOURNAL_TOASTS);
    expect(hud.toasts[0]).toBe('t1');
    expect(hud.element.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(
      JOURNAL_HUD_TEXT.region,
    );
  });

  it('a toast with the same key keeps its text and starts its time again', () => {
    hud.toast('first', 0, 'q');
    hud.toast('second', 3000, 'q');
    hud.toast('other', 3000, 'r');
    hud.toast('unkeyed', 3000);
    expect(hud.toasts).toEqual(['first', 'other', 'unkeyed']);
    hud.frame(JOURNAL_TOAST_MS);
    expect(hud.toasts).toEqual(['first', 'other', 'unkeyed']);
  });

  it('frame keeps toasts that are not due', () => {
    hud.toast('a', 0);
    hud.toast('b', 2000);
    hud.frame(JOURNAL_TOAST_MS);
    expect(hud.toasts).toEqual(['b']);
  });
});

describe('unread mark', () => {
  it('AC-3: shows while something is unread and hides at zero', () => {
    expect(mark().hidden).toBe(true);
    hud.setUnread(2);
    expect(mark().hidden).toBe(false);
    expect(mark().dataset['count']).toBe('2');
    hud.setUnread(-1);
    expect(mark().hidden).toBe(true);
    expect(mark().dataset['count']).toBe('0');
  });
});

describe('quest tracker', () => {
  const view = { title: 'The Bounty', objectives: ['Ask Dot.', 'Find the key.'] };

  it('AC-5: shows the pinned quest with its open objectives', () => {
    expect(tracker().hidden).toBe(true);
    hud.track(view);
    expect(tracker().hidden).toBe(false);
    expect(tracker().querySelector('h2')?.textContent).toBe('The Bounty');
    expect(tracker().querySelectorAll('li')).toHaveLength(2);
    hud.track({ title: 'Done soon', objectives: [] });
    expect(tracker().querySelector('ul')).toBeNull();
    hud.track(undefined);
    expect(tracker().hidden).toBe(true);
    expect(tracker().children).toHaveLength(0);
  });

  it('AC-5: disabled in settings, a pinned quest renders no tracker; enabling brings it back', () => {
    hud.setTrackerEnabled(false);
    hud.track(view);
    expect(tracker().hidden).toBe(true);
    expect(tracker().children).toHaveLength(0);
    hud.setTrackerEnabled(true);
    expect(tracker().hidden).toBe(false);
    expect(tracker().querySelector('h2')?.textContent).toBe('The Bounty');
  });

  it('AC-5: can start disabled', () => {
    const off = new JournalHud({ trackerEnabled: false });
    off.track(view);
    expect(find('[data-testid="quest-tracker"]', off.element).hidden).toBe(true);
  });
});
