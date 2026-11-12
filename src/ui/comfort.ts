// Scaling and comfort hooks (mw-e00.23), consumed by the settings beads: text size (mw-e31.4,
// e31-text-scaling) and motion comfort (e31-motion-comfort). The UI kit sizes every font through
// `--ui-text-scale` and every transition through `--ui-motion-scale` (tokens.ts), so these setters are
// the only thing the settings screen has to call.

export const MIN_TEXT_SCALE = 0.8;
export const MAX_TEXT_SCALE = 2;

/** Clamps a text scale to 0.8–2.0; a non-finite value is the default 1. */
export function clampTextScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, scale));
}

/** Sets `--ui-text-scale` on the UI root (clamped); returns the value applied. */
export function setTextScale(root: HTMLElement, scale: number): number {
  const applied = clampTextScale(scale);
  root.style.setProperty('--ui-text-scale', String(applied));
  return applied;
}

/** The text scale set on the UI root (1 when unset). */
export function textScale(root: HTMLElement): number {
  const value = root.style.getPropertyValue('--ui-text-scale');
  return value === '' ? 1 : clampTextScale(Number(value));
}

/** Sets the opacity (0-1, clamped) of the plate behind HUD text; returns the value applied. */
export function setTextBackdrop(root: HTMLElement, opacity: number): number {
  const applied = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0;
  root.style.setProperty('--ui-text-backdrop-opacity', String(applied));
  return applied;
}

/** Switches the dyslexia-friendly font on or off (the stylesheet reads `data-font`). */
export function setDyslexiaFont(root: HTMLElement, on: boolean): void {
  if (on) root.dataset['font'] = 'dyslexia';
  else delete root.dataset['font'];
}

/** Switches high contrast on or off (the stylesheet reads `data-contrast`; the dialogue box follows it). */
export function setHighContrast(root: HTMLElement, on: boolean): void {
  if (on) root.dataset['contrast'] = 'high';
  else delete root.dataset['contrast'];
}

/**
 * Motion preference: `system` follows the OS `prefers-reduced-motion`, `reduce` forces it on, `full`
 * forces full motion even when the OS asks for less.
 */
export type MotionPreference = 'system' | 'reduce' | 'full';

/** Sets the motion preference on the UI root (the stylesheet reads `data-motion`). */
export function setMotionPreference(root: HTMLElement, preference: MotionPreference): void {
  if (preference === 'system') delete root.dataset['motion'];
  else root.dataset['motion'] = preference;
}

/** The `matchMedia` part of `window` this reads. */
export type MediaQuery = (query: string) => { readonly matches: boolean };

/**
 * Whether scripted motion (bar trails, toasts sliding) should be reduced on this root: the root's
 * preference, else the OS setting. Pass `window.matchMedia.bind(window)` (absent → full motion).
 */
export function reducedMotion(root: HTMLElement, matchMedia?: MediaQuery): boolean {
  const preference = root.dataset['motion'];
  if (preference === 'reduce') return true;
  if (preference === 'full') return false;
  return matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
