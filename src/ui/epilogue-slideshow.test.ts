// @vitest-environment happy-dom
// The epilogue slideshow window (mw-e39.40): the card and slides one at a time, advancing, skipping,
// and reporting how it ended.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EPILOGUE_SCREEN,
  EPILOGUE_TEXT,
  openEpilogueSlideshow,
  slideLabel,
  type EpilogueEnd,
  type EpilogueSlideModel,
} from '@ui/epilogue-slideshow';
import { UiRoot } from '@ui/screens';
import { find, rectFromData } from '@ui/testing/layout';

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
});

const SLIDES: EpilogueSlideModel[] = [
  { id: 'ending-x', title: 'The Bell', text: 'First card.' },
  { id: 'a', text: 'Slide a.\n\nSecond paragraph.' },
  { id: 'b', text: 'Slide b.' },
];

function open(slides: readonly EpilogueSlideModel[] = SLIDES) {
  const onSlide = vi.fn<(slide: EpilogueSlideModel, index: number) => void>();
  const onEnd = vi.fn<(end: EpilogueEnd, shown: number) => void>();
  const window = openEpilogueSlideshow(ui, { slides, onSlide, onEnd });
  return { window, onSlide, onEnd };
}

const title = () => find('[data-testid="epilogue-title"]');
const body = () => find('[data-testid="epilogue-body"]');
const nextButton = () => find('[data-action="next"]');

describe('epilogue slideshow window (mw-e39.40)', () => {
  it('AC-1: opens on the first card with its title, pausing the sim', () => {
    const t = open();
    expect(ui.top?.id).toBe(EPILOGUE_SCREEN);
    expect(ui.pausesSim).toBe(true);
    expect(title().textContent).toBe('The Bell');
    expect(title().hidden).toBe(false);
    expect(body().textContent).toBe('First card.');
    expect(find('[data-testid="epilogue-counter"]').textContent).toBe(slideLabel(0, 3));
    expect(t.onSlide).toHaveBeenCalledExactlyOnceWith(SLIDES[0], 0);
  });

  it('AC-1: a slide without a title hides the heading and splits paragraphs', () => {
    const t = open();
    t.window.advance();
    expect(title().hidden).toBe(true);
    expect([...body().querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'Slide a.',
      'Second paragraph.',
    ]);
  });

  it('AC-2: Next, the interact key and Right advance; the last slide offers Finish', () => {
    const t = open();
    expect(nextButton().textContent).toBe(EPILOGUE_TEXT.next);
    (nextButton() as HTMLButtonElement).click();
    expect(t.window.index).toBe(1);
    ui.intent('tabNext', 'keyboard');
    expect(t.window.index).toBe(2);
    expect(nextButton().textContent).toBe(EPILOGUE_TEXT.finish);
    expect(t.onSlide).toHaveBeenCalledTimes(3);
    expect(t.onEnd).not.toHaveBeenCalled();
  });

  it('AC-2: advancing on the last slide ends the slideshow as finished, once', () => {
    for (const press of [
      () => ui.intent('secondary', 'gamepad'),
      () => ui.intent('right', 'keyboard'),
      () => {
        (nextButton() as HTMLButtonElement).click();
      },
    ]) {
      const t = open();
      t.window.advance();
      t.window.advance();
      press();
      expect(ui.top).toBeUndefined();
      expect(t.onEnd).toHaveBeenCalledExactlyOnceWith('finished', 3);
      t.window.skip();
      expect(t.onEnd).toHaveBeenCalledTimes(1);
    }
  });

  it('AC-3: Esc, B and Skip end it as skipped at any slide', () => {
    for (const press of [
      () => ui.intent('back', 'keyboard'),
      () => ui.intent('back', 'gamepad'),
      () => {
        find('[data-action="skip"]').click();
      },
    ]) {
      const t = open();
      t.window.advance();
      press();
      expect(ui.top).toBeUndefined();
      expect(t.onEnd).toHaveBeenCalledExactlyOnceWith('skipped', 2);
    }
  });

  it('AC-4: Left and the previous-tab intent go back a slide, never before the first', () => {
    const t = open();
    ui.intent('left', 'keyboard');
    expect(t.window.index).toBe(0);
    t.window.advance();
    t.window.advance();
    ui.intent('left', 'gamepad');
    expect(t.window.index).toBe(1);
    ui.intent('tabPrev', 'gamepad');
    expect(t.window.index).toBe(0);
  });

  it('AC-4: Next is focused on open and other intents are left to the UI', () => {
    open();
    expect(document.activeElement).toBe(nextButton());
    ui.intent('up', 'keyboard');
    expect(ui.top?.id).toBe(EPILOGUE_SCREEN);
  });

  it('AC-3: a UI that is cleared under it ends it as skipped, and callbacks are optional', () => {
    const t = open();
    ui.clear();
    expect(t.onEnd).toHaveBeenCalledExactlyOnceWith('skipped', 1);
    const bare = openEpilogueSlideshow(ui, { slides: [{ id: 'z', text: 'Z' }] });
    ui.clear();
    bare.skip();
    expect(ui.top).toBeUndefined();
    const again = openEpilogueSlideshow(ui, { slides: [{ id: 'z', text: 'Z' }] });
    again.advance();
    expect(ui.top).toBeUndefined();
  });
});
