// The epilogue slideshow (mw-e39.40): the ending card, then the epilogue slides, one at a time on a
// full-screen black ground, built like the reader window (src/ui/reader-window.ts) on the kit's tokens.
//
// - Shows a title (the ending card has one), one slide of text and a "Slide 2 of 5" line.
// - Advances with the interact key (E on a keyboard, X on a pad: the UI's `tabNext` and `secondary`
//   intents), Right, Space and Enter (the focused Next button), or the Next button; the last slide's
//   button reads "Finish". Left goes back a slide.
// - Skippable at any time with Esc or B (the UI's `back`) or the Skip button.
// - Pauses the sim and captures input while open. It never changes game state: it reports each
//   slide shown, and how it ended (`finished` after the last slide, `skipped` otherwise), and the
//   game decides what that means.

import { button } from './components/controls';
import { h } from './components/dom';
import { UI_INTENT_GLYPHS } from './components/overlays';
import type { Screen, UiRoot } from './screens';

/** `data-screen` of the slideshow. */
export const EPILOGUE_SCREEN = 'epilogue';

export const EPILOGUE_TEXT = Object.freeze({
  next: 'Next',
  finish: 'Finish',
  skip: 'Skip',
  hint: `${UI_INTENT_GLYPHS.keyboard.tabNext} or ${UI_INTENT_GLYPHS.gamepad.secondary}: Next. ${UI_INTENT_GLYPHS.keyboard.back} or ${UI_INTENT_GLYPHS.gamepad.back}: Skip.`,
});

/** One card or slide. */
export interface EpilogueSlideModel {
  /** Content-side id: `ending-<ending>` or the slide's objective id. */
  readonly id: string;
  readonly title?: string | undefined;
  readonly text: string;
}

/** How the slideshow ended. */
export type EpilogueEnd = 'finished' | 'skipped';

export interface EpilogueSlideshowOptions {
  /** The slides in order, at least one. */
  readonly slides: readonly EpilogueSlideModel[];
  /** `data-screen` of the window; the epilogue's by default (the class-arrival narration passes its own). */
  readonly screenId?: string;
  /** The window's accessible label; "Epilogue" by default. */
  readonly label?: string;
  /** What one slide is called in the counter: "Slide 2 of 5" by default, "Page 2 of 5" for narration. */
  readonly unit?: string;
  /** A slide came up (index from 0), including the first. */
  readonly onSlide?: (slide: EpilogueSlideModel, index: number) => void;
  /** The slideshow ended, once. */
  readonly onEnd?: (end: EpilogueEnd, shown: number) => void;
}

export interface EpilogueSlideshow {
  readonly screen: Screen;
  /** The slide showing, from 0. */
  readonly index: number;
  advance(): void;
  skip(): void;
}

/** "Slide 2 of 5" (or "Page 2 of 5" for another unit). */
export const slideLabel = (index: number, total: number, unit = 'Slide'): string =>
  `${unit} ${String(index + 1)} of ${String(total)}`;

/** Opens the slideshow on `ui`. */
export function openEpilogueSlideshow(
  ui: UiRoot,
  options: EpilogueSlideshowOptions,
): EpilogueSlideshow {
  const { slides } = options;
  const last = slides.length - 1;
  let index = 0;
  let ended = false;

  const title = h('h1', { data: { testid: 'epilogue-title' } });
  const body = h('div', {
    className: 'vb-stack vb-epilogue-body',
    attrs: { role: 'document' },
    data: { testid: 'epilogue-body' },
  });
  const counter = h('p', {
    className: 'vb-epilogue-counter',
    attrs: { role: 'status' },
    data: { testid: 'epilogue-counter' },
  });
  const next = button({
    label: EPILOGUE_TEXT.next,
    autofocus: true,
    onPress: () => {
      advance();
    },
  });
  next.dataset['action'] = 'next';
  const skipButton = button({
    label: EPILOGUE_TEXT.skip,
    onPress: () => {
      skip();
    },
  });
  skipButton.dataset['action'] = 'skip';
  const content = h(
    'div',
    { className: 'vb-panel vb-stack vb-epilogue', data: { testid: 'epilogue-slideshow' } },
    title,
    body,
    counter,
    h('div', { className: 'vb-row vb-epilogue-actions' }, next, skipButton),
    h('p', { className: 'vb-epilogue-hint', text: EPILOGUE_TEXT.hint }),
  );

  function show(): void {
    for (const slide of slides.slice(index, index + 1)) {
      title.textContent = slide.title ?? '';
      title.hidden = slide.title === undefined;
      body.replaceChildren(
        ...slide.text.split(/\n\s*\n/).map((paragraph) => h('p', { text: paragraph.trim() })),
      );
      counter.textContent = slideLabel(index, slides.length, options.unit);
      next.textContent = index === last ? EPILOGUE_TEXT.finish : EPILOGUE_TEXT.next;
      options.onSlide?.(slide, index);
    }
  }

  function end(how: EpilogueEnd): void {
    if (ended) return;
    ended = true;
    options.onEnd?.(how, index + 1);
    screen.close();
  }

  function advance(): void {
    if (index === last) end('finished');
    else {
      index += 1;
      show();
    }
  }

  function skip(): void {
    end('skipped');
  }

  const screen = ui.push({
    id: options.screenId ?? EPILOGUE_SCREEN,
    label: options.label ?? 'Epilogue',
    content,
    pausesSim: true,
    onIntent: (intent) => {
      if (intent === 'back') {
        skip();
        return true;
      }
      if (intent === 'tabNext' || intent === 'secondary' || intent === 'right') {
        advance();
        return true;
      }
      if (intent === 'tabPrev' || intent === 'left') {
        if (index > 0) {
          index -= 1;
          show();
        }
        return true;
      }
      return false;
    },
    // Closed from outside (the UI cleared): the slideshow ends as a skip.
    onClose: () => {
      if (!ended) {
        ended = true;
        options.onEnd?.('skipped', index + 1);
      }
    },
  });
  show();

  return {
    screen,
    get index() {
      return index;
    },
    advance,
    skip,
  };
}
