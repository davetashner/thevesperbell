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
});
