// @vitest-environment happy-dom
// The journal window (mw-e23.6): tabs, entries with objective checks, empty states, focus, closing
// and pausing.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JOURNAL_SCREEN,
  JOURNAL_TABS,
  JOURNAL_TEXT,
  openJournalWindow,
  type JournalModel,
} from '@ui/journal-window';
import { setTextScale, textScale } from '@ui/comfort';
import { UiRoot } from '@ui/screens';
import { find, rectFromData } from '@ui/testing/layout';

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
});

const MODEL: JournalModel = {
  active: [
    {
      id: 'q1',
      title: 'The Bounty',
      paragraphs: ['First.\n\nSecond.'],
      objectives: [
        { text: 'Ask Dot.', done: true, optional: false },
        { text: 'Find the key.', done: false, optional: true },
      ],
    },
  ],
  done: [{ id: 'q2', title: 'The Lost Thing', status: 'Failed', paragraphs: ['Gone.'] }],
  rumours: [],
  notes: [{ id: 'n1', title: 'Why you came', paragraphs: ['Because.'], objectives: [] }],
};

const open = (tab?: Parameters<typeof openJournalWindow>[1]['tab']) => {
  const onClose = vi.fn<() => void>();
  const window = openJournalWindow(ui, {
    model: MODEL,
    ...(tab !== undefined && { tab }),
    onClose,
  });
  return { window, onClose };
};
const panel = (id: string) => find(`[data-testid="journal-${id}"]`);

describe('journal window', () => {
  it('AC-1: opens on Active with the quest, its paragraphs and a checked and an optional objective; pauses the sim', () => {
    open();
    expect(ui.top?.id).toBe(JOURNAL_SCREEN);
    expect(ui.pausesSim).toBe(true);
    expect(find('h1').textContent).toBe(JOURNAL_TEXT.title);
    expect([...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(
      JOURNAL_TABS.map((t) => t.label),
    );
    const entry = panel('active').querySelector('article');
    expect(entry?.querySelector('h2')?.textContent).toBe('The Bounty');
    expect([...(entry?.querySelectorAll('p') ?? [])].map((p) => p.textContent)).toEqual([
      'First.',
      'Second.',
    ]);
    const items = [...(entry?.querySelectorAll('li') ?? [])];
    expect(items.map((li) => li.dataset['done'])).toEqual(['true', 'false']);
    expect(items[0]?.textContent).toBe('[x] Done: Ask Dot.');
    expect(items[1]?.textContent).toBe('[ ] To do: Find the key. (optional)');
  });

  it('AC-2: a status shows beside a finished entry; an empty section says so', () => {
    const t = open('done');
    expect(t.window.tab).toBe('done');
    expect(panel('done').querySelector('.vb-journal-status')?.textContent).toBe('Failed');
    t.window.select('rumours');
    expect(t.window.tab).toBe('rumours');
    expect(panel('rumours').textContent).toBe(JOURNAL_TABS[2].empty);
    expect(panel('rumours').hidden).toBe(false);
    expect(panel('active').hidden).toBe(true);
  });

  it('Q and E (LB and RB) switch sections, wrapping', () => {
    const t = open();
    ui.intent('tabNext', 'keyboard');
    expect(t.window.tab).toBe('done');
    ui.intent('tabPrev', 'keyboard');
    ui.intent('tabPrev', 'keyboard');
    expect(t.window.tab).toBe('notes');
  });

  it('opens with the first entry focused, or the tab when the section is empty', () => {
    open();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('The Bounty');
    ui.top?.close();
    openJournalWindow(ui, { model: { ...MODEL, active: [] } });
    expect(document.activeElement?.getAttribute('role')).toBe('tab');
  });

  it('every entry is focusable so a long list scrolls with the arrows instead of clipping', () => {
    open();
    expect(
      [...document.querySelectorAll('article')].every((a) => a.getAttribute('tabindex') === '0'),
    ).toBe(true);
    expect(panel('active').className).toContain('vb-journal-panel');
  });

  it('Back and the Close button close it and report once', () => {
    const t = open();
    ui.intent('back', 'keyboard');
    expect(t.onClose).toHaveBeenCalledOnce();
    expect(ui.top).toBeUndefined();
    const again = open();
    (find('[data-action="close"]') as HTMLButtonElement).click();
    expect(again.onClose).toHaveBeenCalledOnce();
    const last = open();
    last.window.close();
    expect(ui.top).toBeUndefined();
  });

  it('works without an onClose', () => {
    const w = openJournalWindow(ui, { model: MODEL });
    w.close();
    expect(ui.top).toBeUndefined();
  });

  it('AC-3: unread entries tag their tab and themselves until the tab is viewed, reported once', () => {
    const onViewed = vi.fn();
    openJournalWindow(ui, {
      model: MODEL,
      unread: { active: ['q1'], rumours: ['r1'] },
      onViewed,
    });
    const tab = (id: string): HTMLElement => find(`[role="tab"][data-tab="${id}"]`);
    // The opening tab counts as viewed at once; its entry keeps its tag for this visit.
    expect(onViewed).toHaveBeenCalledExactlyOnceWith('active');
    expect(tab('active').dataset['unread']).toBeUndefined();
    expect(document.querySelector('[data-entry="q1"] .vb-journal-new')?.textContent).toBe(
      `(${JOURNAL_TEXT.unread})`,
    );
    expect(tab('rumours').dataset['unread']).toBe('true');
    expect(tab('rumours').textContent).toContain(JOURNAL_TEXT.unread);
    expect(tab('done').dataset['unread']).toBeUndefined();
    tab('rumours').click();
    expect(onViewed).toHaveBeenLastCalledWith('rumours');
    expect(tab('rumours').dataset['unread']).toBeUndefined();
    expect(tab('rumours').textContent).toBe('Rumours');
    tab('done').click();
    tab('rumours').click();
    expect(onViewed).toHaveBeenCalledTimes(2);
  });

  it('AC-3: with nothing unread nothing is tagged and viewing reports nothing', () => {
    const onViewed = vi.fn();
    openJournalWindow(ui, { model: MODEL, unread: { done: [] }, onViewed });
    find('[role="tab"][data-tab="notes"]').click();
    expect(onViewed).not.toHaveBeenCalled();
    expect(document.querySelector('.vb-journal-new')).toBeNull();
    expect(document.querySelector('[data-unread]')).toBeNull();
  });

  it('AC-4: at 150% text a 10-objective quest scrolls in its panel without clipping', () => {
    const styled = new UiRoot(document.body, { focus: { rectOf: rectFromData } });
    setTextScale(styled.element, 1.5);
    expect(textScale(styled.element)).toBe(1.5);
    const objectives = Array.from({ length: 10 }, (_, i) => ({
      text: `Objective number ${String(i + 1)}, written as a long line of prose that wraps.`,
      done: i < 3,
      optional: i === 9,
    }));
    openJournalWindow(styled, {
      model: { ...MODEL, active: [{ id: 'big', title: 'Big', paragraphs: ['Go.'], objectives }] },
    });
    const panelEl = find('[data-panel="active"]');
    const style = getComputedStyle(panelEl);
    // The panel is height-capped and scrolls; entries wrap instead of clipping.
    expect(style.overflowY).toBe('auto');
    expect(style.maxHeight).not.toBe('none');
    expect(panelEl.querySelectorAll('li')).toHaveLength(10);
    expect(getComputedStyle(find('.vb-journal-objectives li')).overflowWrap).toBe('anywhere');
    expect(styled.element.style.getPropertyValue('--ui-text-scale')).toBe('1.5');
    expect(document.querySelector('article')?.getAttribute('tabindex')).toBe('0');
  });
});
