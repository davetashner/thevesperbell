// The screen feedback overlay (mw-e29.5): a red damage vignette and a colour-draining grade for low
// health, in one full-screen layer over the game. A HUD widget like the others: the game hands it the
// two amounts each frame (vignette 0–1 of its maximum, desaturation 0–1) and it never reads sim state.
// It ignores the pointer and is hidden from assistive technology (the health bar carries the words).
// The grade is a CSS backdrop filter, so it costs no extra render pass.

import { h } from './components/dom';
import { WriteCache, type HudWidget } from './hud';

/** Vignette opacity at full intensity. */
export const VIGNETTE_MAX_OPACITY = 0.75;

export interface ScreenFeedbackModel {
  /** Damage vignette, 0–1 of its maximum. */
  readonly vignette: number;
  /** Colour lost, 0 (none) to 1 (grey). */
  readonly desaturation: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export class ScreenFeedback implements HudWidget<ScreenFeedbackModel> {
  readonly element: HTMLElement;
  readonly #cache = new WriteCache();

  constructor() {
    this.element = h('div', {
      className: 'vb-screen-feedback',
      attrs: { 'aria-hidden': 'true', hidden: '' },
      data: { testid: 'screen-feedback', uiComponent: 'screen-feedback' },
    });
    Object.assign(this.element.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      background: 'radial-gradient(ellipse at center, transparent 45%, rgb(150 10 10) 130%)',
      opacity: '0',
    });
  }

  update(model: ScreenFeedbackModel): void {
    const c = this.#cache;
    const vignette = Math.round(clamp01(model.vignette) * 100) / 100;
    const grey = Math.round(clamp01(model.desaturation) * 100) / 100;
    c.set('shown', String(vignette > 0 || grey > 0), (v) => {
      this.element.hidden = v === 'false';
    });
    c.set('vignette', vignette.toFixed(2), (v) => {
      this.element.dataset['vignette'] = v;
      this.element.style.opacity = (Number(v) * VIGNETTE_MAX_OPACITY).toFixed(2);
    });
    c.set('grey', grey.toFixed(2), (v) => {
      this.element.dataset['desaturation'] = v;
      this.element.style.backdropFilter =
        Number(v) > 0 ? `saturate(${(1 - Number(v)).toFixed(2)})` : '';
    });
  }
}
