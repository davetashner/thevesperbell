// @vitest-environment happy-dom
// The reader window (mw-kf4c): title, byline and paragraphs, paging, closing with Esc, B and the
// interact key, and pausing.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openReaderWindow, pageLabel, READER_SCREEN, READER_TEXT } from '@ui/reader-window';
import { UiRoot } from '@ui/screens';
import { find, rectFromData } from '@ui/testing/layout';

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
});

const PAGES = ['First page.\n\nSecond paragraph.', 'Second page [illegible].', 'Third.'];

function open(pages: readonly string[] = PAGES, byline?: string) {
  const onClose = vi.fn<() => void>();
  const window = openReaderWindow(ui, {
    model: { title: 'A letter', ...(byline !== undefined && { byline }), pages },
    onClose,
  });
  return { window, onClose };
}

describe('reader window (mw-kf4c)', () => {
  it('AC-1: shows the title, byline and the first page as paragraphs, and pauses the sim', () => {
    open(PAGES, 'Someone');
    expect(ui.top?.id).toBe(READER_SCREEN);
    expect(ui.pausesSim).toBe(true);
    expect(find('h1').textContent).toBe('A letter');
    expect(find('[data-testid="reader-byline"]').textContent).toBe('Someone');
    expect(
      [...document.querySelectorAll('[data-testid="reader-body"] p')].map((p) => p.textContent),
    ).toEqual(['First page.', 'Second paragraph.']);
    expect(find('[data-testid="reader-page"]').textContent).toBe(pageLabel(0, 3));
  });

  it('AC-1: a single page with no byline hides the byline and the pager', () => {
    open(['Only.']);
    expect(find('[data-testid="reader-byline"]').hidden).toBe(true);
    expect(find('[data-testid="reader-page"]').hidden).toBe(true);
    ui.intent('right', 'keyboard');
    ui.intent('tabPrev', 'keyboard');
    expect(find('[data-testid="reader-body"]').textContent).toBe('Only.');
  });

  it('AC-1: Next, Previous, the arrows and Q turn the page within the pages there are', () => {
    const t = open();
    const nextButton = find('[data-action="next"]') as HTMLButtonElement;
    const prevButton = find('[data-action="previous"]') as HTMLButtonElement;
    expect(prevButton.disabled).toBe(true);
    nextButton.click();
    expect(t.window.page).toBe(1);
    expect(find('[data-testid="reader-body"]').textContent).toContain('[illegible]');
    ui.intent('right', 'keyboard');
    expect(t.window.page).toBe(2);
    expect(nextButton.disabled).toBe(true);
    ui.intent('right', 'keyboard');
    expect(t.window.page).toBe(2);
    ui.intent('left', 'keyboard');
    ui.intent('tabPrev', 'keyboard');
    expect(t.window.page).toBe(0);
    nextButton.click();
    prevButton.click();
    expect(t.window.page).toBe(0);
    t.window.turn(9);
    expect(t.window.page).toBe(2);
    expect(READER_TEXT.hint).toContain('Esc');
  });

  it('AC-1: Esc, B, the interact key (E, X) and Close each close it and report once', () => {
    for (const press of [
      () => ui.intent('back', 'keyboard'),
      () => ui.intent('back', 'gamepad'),
      () => ui.intent('tabNext', 'keyboard'),
      () => ui.intent('secondary', 'gamepad'),
      () => {
        find('[data-action="close"]').click();
      },
    ]) {
      const t = open();
      press();
      expect(ui.top).toBeUndefined();
      expect(t.onClose).toHaveBeenCalledTimes(1);
    }
  });

  it('AC-1: other intents are left to the UI, close() shuts it, and onClose is optional', () => {
    const window = openReaderWindow(ui, { model: { title: 'T', pages: ['x'] } });
    ui.intent('up', 'keyboard');
    expect(ui.top?.id).toBe(READER_SCREEN);
    window.close();
    expect(ui.top).toBeUndefined();
  });
});
