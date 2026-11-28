// @vitest-environment happy-dom
// The book reader (mw-e07.9): the two-page spread and its paging, torn pages, the Study button and its
// reasons, garbled and forbidden books, reduced motion, and closing.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOOK_READER_SCREEN,
  BOOK_READER_TEXT,
  garble,
  openBookReader,
  spreadLabel,
  studyTimeLabel,
  type BookModel,
  type BookPage,
} from '@ui/book-reader';
import { UiRoot } from '@ui/screens';
import { find, rectFromData } from '@ui/testing/layout';

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
});

const pages = (n: number): BookPage[] =>
  Array.from({ length: n }, (_, i) => ({ text: `Text of page ${String(i + 1)}.` }));

function open(
  model: Partial<BookModel> = {},
  extra?: Parameters<typeof openBookReader>[1]['matchMedia'],
) {
  const onStudy = vi.fn<() => void>();
  const onClose = vi.fn<() => void>();
  const reader = openBookReader(ui, {
    model: { title: 'A Primer', pages: pages(6), ...model },
    onStudy,
    onClose,
    ...(extra !== undefined && { matchMedia: extra }),
  });
  return { reader, onStudy, onClose };
}

const left = (): string => find('[data-testid="book-page-left"]').textContent;
const right = (): string => find('[data-testid="book-page-right"]').textContent;
const label = (): string => find('[data-testid="book-pages"]').textContent;
const action = (name: string): HTMLButtonElement =>
  find(`[data-action="${name}"]`) as HTMLButtonElement;

describe('book reader spread (mw-e07.9)', () => {
  it('AC-1: a book of 6 pages opens on pages 1-2, pauses the sim and names its title and author', () => {
    open({ author: 'Tamsin Reed' });
    expect(ui.top?.id).toBe(BOOK_READER_SCREEN);
    expect(ui.pausesSim).toBe(true);
    expect(find('h1').textContent).toBe('A Primer');
    expect(find('[data-testid="book-byline"]').textContent).toBe('Tamsin Reed');
    expect(left()).toBe('Text of page 1.');
    expect(right()).toBe('Text of page 2.');
    expect(label()).toBe(spreadLabel(0, 6));
    expect(label()).toBe('Pages 1-2 of 6');
  });

  it('AC-1: next and previous keys turn in pairs and stop at the first and last pages', () => {
    const { reader } = open();
    ui.intent('left', 'keyboard');
    expect(reader.spread).toBe(0);
    expect(action('previous').disabled).toBe(true);
    ui.intent('right', 'keyboard');
    expect([left(), right()]).toEqual(['Text of page 3.', 'Text of page 4.']);
    ui.intent('right', 'keyboard');
    expect([left(), right()]).toEqual(['Text of page 5.', 'Text of page 6.']);
    expect(action('next').disabled).toBe(true);
    ui.intent('right', 'keyboard');
    expect(reader.spread).toBe(2);
    ui.intent('tabPrev', 'keyboard');
    expect(reader.spread).toBe(1);
    ui.intent('left', 'keyboard');
    expect(label()).toBe('Pages 1-2 of 6');
  });

  it('AC-1: the Next and Previous buttons turn the spread too', () => {
    const { reader } = open();
    action('next').click();
    expect(reader.spread).toBe(1);
    action('previous').click();
    expect(reader.spread).toBe(0);
    reader.turn(99);
    expect(reader.spread).toBe(2);
    reader.turn(-4);
    expect(reader.spread).toBe(0);
  });

  it('AC-1: an odd page count ends on a blank right page; one spread hides the pager', () => {
    const { reader } = open({ pages: pages(3) });
    reader.turn(1);
    expect(left()).toBe('Text of page 3.');
    expect(right()).toBe('');
    expect(find('[data-testid="book-page-right"]').getAttribute('aria-hidden')).toBe('true');
    expect(label()).toBe('Page 3 of 3');
    reader.turn(0);
    expect(find('[data-testid="book-page-right"]').hasAttribute('aria-hidden')).toBe(false);
    document.body.innerHTML = '';
    ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
    open({ pages: pages(2) });
    expect(find('[data-testid="book-pager"]').hidden).toBe(true);
  });

  it('AC-1: paragraphs split on a blank line and damage markers are kept as written', () => {
    open({ pages: [{ text: 'One [illegible].\n\nTwo.' }, { text: '[missing]' }] });
    expect(
      [...document.querySelectorAll('[data-testid="book-page-left"] p')].map((p) => p.textContent),
    ).toEqual(['One [illegible].', 'Two.']);
    expect(right()).toBe('[missing]');
  });
});

describe('book reader torn pages, garble and warning (mw-e07.9)', () => {
  it('AC-2: a missing page shows a torn-page placeholder reading "Pages missing"', () => {
    open({ pages: [{ text: 'First.' }, { missing: true }] });
    const torn = find('[data-testid="book-page-right"]');
    expect(torn.textContent).toBe('Pages missing');
    expect(BOOK_READER_TEXT.missing).toBe('Pages missing');
    expect(torn.classList.contains('vb-book-torn')).toBe(true);
    expect(find('[data-testid="book-page-left"]').classList.contains('vb-book-torn')).toBe(false);
  });

  it('shows an unreadable language as runes, keeping spaces and punctuation', () => {
    open({ garbled: true, pages: [{ text: 'Sleep, you.' }, { text: '' }] });
    expect(left()).not.toMatch(/[A-Za-z]/);
    expect(left()).toMatch(/^\S+, \S+\.$/);
    expect(find('[data-testid="book-page-left"]').getAttribute('lang')).toBe('x-runic');
    expect(garble('abc 123')).toBe(garble('abc 123'));
    expect(garble('a')).not.toBe('a');
  });

  it('shows a forbidden warning, and hides the warning and byline when there are none', () => {
    open({ warning: BOOK_READER_TEXT.forbidden });
    expect(find('[data-testid="book-warning"]').hidden).toBe(false);
    expect(find('[data-testid="book-warning"]').textContent).toBe(BOOK_READER_TEXT.forbidden);
    document.body.innerHTML = '';
    ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
    open();
    expect(find('[data-testid="book-warning"]').hidden).toBe(true);
    expect(find('[data-testid="book-byline"]').hidden).toBe(true);
  });
});

describe('book reader Study button (mw-e07.9)', () => {
  it('AC-3: shows the sim estimate on the button, and pressing it reports the study', () => {
    const { reader, onStudy } = open({ study: { minutes: 75 } });
    expect(action('study').textContent).toBe('Study (1 h 15 min)');
    expect(action('study').disabled).toBe(false);
    action('study').click();
    expect(onStudy).toHaveBeenCalledOnce();
    reader.setStudy({ minutes: 20 });
    expect(action('study').textContent).toBe('Study (20 min)');
    reader.setStudy({ minutes: 120 });
    expect(action('study').textContent).toBe('Study (2 h)');
    expect([studyTimeLabel(5), studyTimeLabel(60), studyTimeLabel(61)]).toEqual([
      '5 min',
      '1 h',
      '1 h 1 min',
    ]);
  });

  it('AC-4: a blocked study is disabled with the reason as a tooltip and as text', () => {
    const { reader } = open({ study: { minutes: 20, blocked: 'Not with danger so close.' } });
    expect(action('study').disabled).toBe(true);
    expect(action('study').title).toBe('Not with danger so close.');
    const reason = find('[data-testid="book-study-reason"]');
    expect(reason.hidden).toBe(false);
    expect(reason.textContent).toBe('Not with danger so close.');
    expect(action('study').getAttribute('aria-describedby')).toBe(reason.id);
    reader.setStudy({ minutes: 20 });
    expect(action('study').disabled).toBe(false);
    expect(action('study').hasAttribute('title')).toBe(false);
    expect(reason.hidden).toBe(true);
  });

  it('shows "Already known" disabled, and hides Study for a book that teaches nothing', () => {
    const { reader } = open({ study: { minutes: 20, known: true, blocked: 'ignored' } });
    expect(action('study').textContent).toBe('Already known');
    expect(action('study').disabled).toBe(true);
    expect(find('[data-testid="book-study-reason"]').hidden).toBe(true);
    reader.setStudy(undefined);
    expect(find('[data-testid="book-study"]').hidden).toBe(true);
  });

  it('says what studying did on the status line', () => {
    const { reader } = open();
    reader.say('You settle down to study.');
    expect(find('[data-testid="book-status"]').textContent).toBe('You settle down to study.');
  });
});

describe('book reader closing and motion (mw-e07.9)', () => {
  it('closes with the interact key, secondary, Back and the Close button, once each', () => {
    for (const how of ['tabNext', 'secondary', 'back'] as const) {
      const { onClose } = open();
      ui.intent(how, 'keyboard');
      expect(onClose).toHaveBeenCalledOnce();
      expect(ui.top).toBeUndefined();
    }
    const { onClose, reader } = open();
    action('close').click();
    expect(onClose).toHaveBeenCalledOnce();
    open().reader.close();
    expect(ui.top).toBeUndefined();
    expect(reader.screen.id).toBe(BOOK_READER_SCREEN);
  });

  it('leaves other intents alone and focuses Close first', () => {
    open();
    expect(ui.intent('up', 'keyboard')).toBeDefined();
    expect(document.activeElement).toBe(action('close'));
  });

  it('plays a page-turn animation and clears it when it ends', () => {
    const { reader } = open();
    const spread = find('[data-testid="book-spread"]');
    reader.turn(1);
    expect(spread.dataset['turn']).toBe('next');
    spread.dispatchEvent(new Event('animationend'));
    expect(spread.hasAttribute('data-turn')).toBe(false);
    reader.turn(1);
    expect(spread.hasAttribute('data-turn')).toBe(false);
    reader.turn(0);
    expect(spread.dataset['turn']).toBe('prev');
  });

  it('turns without animation when motion is reduced (the setting or the OS)', () => {
    const { reader } = open();
    const spread = find('[data-testid="book-spread"]');
    ui.element.dataset['motion'] = 'reduce';
    reader.turn(1);
    expect(spread.hasAttribute('data-turn')).toBe(false);
    expect(reader.spread).toBe(1);
    delete ui.element.dataset['motion'];
    document.body.innerHTML = '';
    ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
    const os = open({}, () => ({ matches: true })).reader;
    os.turn(1);
    expect(find('[data-testid="book-spread"]').hasAttribute('data-turn')).toBe(false);
  });
});
