// Sound captions (mw-e28.14): short bracketed lines such as "[Footsteps, behind left]" with an arrow
// pointing the way the sound came from, stacked at the top of the screen for deaf and hard-of-hearing
// players. A HUD widget: it takes the captions to show as view models (text, bearing) and never reads
// game state; src/game/captions works out which captions and where they point.
//
// - A polite live region that announces additions only, so a screen reader reads each new caption
//   once and does not repeat it when its arrow turns with the camera. The arrow is decoration
//   (aria-hidden); the direction is in the words.
// - Light text on a near-opaque ink panel (contrast well over 7:1), at one of three sizes that scale
//   with the text size setting; lines wrap, so it holds at phone width.
// - Hidden while captions are off or nothing is showing. Ignores the pointer.

import { h } from './components/dom';
import { WriteCache, type HudWidget } from './hud';

export const CAPTION_SIZES = ['small', 'medium', 'large'] as const;
export type CaptionSize = (typeof CAPTION_SIZES)[number];

export const SOUND_CAPTION_TEXT = Object.freeze({ region: 'Sound captions' });

/** One caption line. */
export interface SoundCaptionView {
  /** Stable identity (source and sound): the same key keeps its line while its arrow turns. */
  readonly key: string;
  /** The words, e.g. "[Footsteps, behind left]". */
  readonly text: string;
  /** Arrow angle in degrees clockwise from pointing up (the way the camera faces). */
  readonly bearingDeg: number;
}

export interface SoundCaptionsModel {
  readonly enabled: boolean;
  readonly size: CaptionSize;
  readonly captions: readonly SoundCaptionView[];
}

/** Arrow rotation is written in steps this wide, so a slowly turning camera is not a write per frame. */
const ARROW_STEP_DEG = 5;

interface Line {
  readonly cache: WriteCache;
  readonly element: HTMLElement;
  readonly arrow: HTMLElement;
  readonly label: HTMLElement;
}

export class SoundCaptions implements HudWidget<SoundCaptionsModel> {
  readonly element: HTMLElement;
  readonly #cache = new WriteCache();
  readonly #lines = new Map<string, Line>();

  constructor() {
    this.element = h('div', {
      className: 'vb-captions',
      attrs: {
        role: 'log',
        'aria-live': 'polite',
        'aria-relevant': 'additions',
        'aria-label': SOUND_CAPTION_TEXT.region,
        hidden: '',
      },
      data: { testid: 'sound-captions', uiComponent: 'sound-captions', size: 'medium' },
    });
  }

  update(model: SoundCaptionsModel): void {
    const shown = model.enabled ? model.captions : [];
    this.#cache.set('size', model.size, (size) => {
      this.element.dataset['size'] = size;
    });
    this.#cache.set('shown', String(shown.length > 0), (v) => {
      this.element.hidden = v === 'false';
    });
    const keep = new Set(shown.map((c) => c.key));
    for (const [key, line] of this.#lines) {
      if (keep.has(key)) continue;
      line.element.remove();
      this.#lines.delete(key);
    }
    shown.forEach((caption, index) => {
      let line = this.#lines.get(caption.key);
      if (line === undefined) {
        line = this.#create(caption.key);
        this.#lines.set(caption.key, line);
      }
      line.cache.set('text', caption.text, (text) => {
        line.label.textContent = text;
      });
      const step = Math.round(caption.bearingDeg / ARROW_STEP_DEG) * ARROW_STEP_DEG;
      line.cache.set('arrow', String(step), (deg) => {
        line.arrow.style.transform = `rotate(${deg}deg)`;
        line.element.dataset['bearing'] = deg;
      });
      // Keep the lines in priority order (the model's order) without recreating them.
      if (this.element.children[index] !== line.element) {
        this.element.insertBefore(line.element, this.element.children[index] ?? null);
      }
    });
  }

  #create(key: string): Line {
    const arrow = h('span', {
      className: 'vb-caption-arrow',
      text: '▲',
      attrs: { 'aria-hidden': 'true' },
    });
    const label = h('span', { className: 'vb-caption-text' });
    const element = h('div', { className: 'vb-caption', data: { caption: key } }, arrow, label);
    return { cache: new WriteCache(), element, arrow, label };
  }
}
