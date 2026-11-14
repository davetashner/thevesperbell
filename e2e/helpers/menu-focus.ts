// Playwright helpers for the menu focus audit (mw-e31.11): sweeping the top screen of the real game
// with Tab, checking that every control is reached and that the focus ring is drawn where it can be
// seen, and tapping UI intents on the keyboard or a virtual pad for exactly one animation frame.
// Everything runs inside one evaluate per action, so a runner that draws a frame a second pays one
// round trip, and nothing waits on wall time.
import type { Page } from '@playwright/test';

export interface Sweep {
  /** data-screen of the screen swept. */
  readonly screen: string;
  /** Every control a player can focus in it, in Tab order. */
  readonly controls: readonly string[];
  /** Controls Tab reached. */
  readonly missing: readonly string[];
  /** Steps after which focus was outside the screen. */
  readonly escaped: readonly string[];
  /** Controls whose focus ring was not drawn (no outline, or under 2px). */
  readonly noRing: readonly string[];
  /** Controls whose ring would be cut off by a clipping ancestor, or that are off screen. */
  readonly hidden: readonly string[];
  /** Controls whose ring has neither a contrasting ink nor a contrasting halo on its background. */
  readonly lowContrast: readonly string[];
  /** Whether Tab past the last control came back to the first (the trap wraps). */
  readonly wraps: boolean;
  /** Whether Shift+Tab from the first went to the last. */
  readonly wrapsBack: boolean;
}

/**
 * Tabs through the top screen once round and back, reading focus after each press. The presses are
 * keydown events on the window, which is where the UI input adapter listens, so they take the same
 * path as a key press.
 */
export async function sweep(page: Page): Promise<Sweep> {
  return page.evaluate(() => {
    const screens = [...document.querySelectorAll<HTMLElement>('.vb-menus > [data-screen]')];
    const scope = screens.at(-1);
    if (!scope) throw new Error('no screen is open');
    const selector =
      'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]';
    const controls = [...scope.querySelectorAll<HTMLElement>(selector)].filter(
      (el) =>
        el.tabIndex >= 0 &&
        !(el as HTMLButtonElement).disabled &&
        el.closest('[hidden], [inert]') === null,
    );
    const names = new Map<HTMLElement, string>();
    controls.forEach((el, index) => {
      const text = (el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 28);
      names.set(el, `${String(index)}:${el.tagName.toLowerCase()}[${text}]`);
    });
    const name = (el: Element | null): string =>
      (el instanceof HTMLElement ? names.get(el) : undefined) ?? 'outside';
    // A Tab press is handled synchronously (the UI adapter moves focus inside the keydown), and
    // focus, scroll and computed style are all current when dispatchEvent returns, so a sweep waits
    // on nothing: on a runner drawing a frame a second it costs one evaluate, not two frames a key.
    const press = (shiftKey: boolean): void => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          code: 'Tab',
          key: 'Tab',
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    };

    const parse = (color: string): [number, number, number, number] => {
      const m = /rgba?\(([^)]+)\)/.exec(color);
      if (!m?.[1]) return [0, 0, 0, 0];
      const parts = m[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const lum = ([r, g, b]: [number, number, number, number]): number => {
      const c = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (
      a: [number, number, number, number],
      b: [number, number, number, number],
    ): number => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };

    const noRing: string[] = [];
    const hidden: string[] = [];
    const lowContrast: string[] = [];
    const escaped: string[] = [];
    const visited = new Set<string>();
    const check = (el: HTMLElement): void => {
      const label = name(el);
      const style = getComputedStyle(el);
      const width = parseFloat(style.outlineWidth);
      if (style.outlineStyle === 'none' || !(width >= 2)) {
        noRing.push(label);
        return;
      }
      // The ring plus its offset must fit inside every clipping ancestor, and on the screen.
      const reach = width + parseFloat(style.outlineOffset || '0');
      const box = el.getBoundingClientRect();
      const ring = {
        left: box.left - reach,
        top: box.top - reach,
        right: box.right + reach,
        bottom: box.bottom + reach,
      };
      const room = (r: { left: number; top: number; right: number; bottom: number }): boolean =>
        ring.left >= r.left - 0.5 &&
        ring.top >= r.top - 0.5 &&
        ring.right <= r.right + 0.5 &&
        ring.bottom <= r.bottom + 0.5;
      let fits = box.width > 0 && box.height > 0;
      let by = '';
      for (let p = el.parentElement; p && fits; p = p.parentElement) {
        const overflow = getComputedStyle(p);
        if (overflow.overflowX !== 'visible' || overflow.overflowY !== 'visible') {
          const r = p.getBoundingClientRect();
          // A scroller's focus scroll must leave room for the ring: judged on both axes.
          const bounds = {
            left: r.left + p.clientLeft,
            right: r.left + p.clientLeft + p.clientWidth,
            top: r.top + p.clientTop,
            bottom: r.top + p.clientTop + p.clientHeight,
          };
          if (!room(bounds)) {
            fits = false;
            by = `${p.tagName.toLowerCase()}.${p.className} box ${String(Math.round(box.top))}-${String(Math.round(box.bottom))} cut ${String(Math.round(r.top))}-${String(Math.round(r.bottom))}`;
          }
        }
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (box.right < 0 || box.left > vw || box.bottom < 0 || box.top > vh) fits = false;
      if (!fits) hidden.push(by === '' ? label : `${label} (cut by ${by})`);
      // Two-tone ring: ink outline over a halo drawn by box-shadow. Either tone has to stand out
      // from the background around the control, and the two from each other.
      const ink = parse(style.outlineColor);
      const halo = parse(/rgba?\([^)]+\)/.exec(style.boxShadow)?.[0] ?? 'rgba(0,0,0,0)');
      let bg: [number, number, number, number] = [255, 255, 255, 1];
      for (let p = el.parentElement; p; p = p.parentElement) {
        const c = parse(getComputedStyle(p).backgroundColor);
        if (c[3] > 0.9) {
          bg = c;
          break;
        }
      }
      const inkVsBg = ratio(ink, bg);
      const haloVsBg = halo[3] > 0 ? ratio(halo, bg) : 0;
      const inkVsHalo = halo[3] > 0 ? ratio(ink, halo) : 0;
      if (!(inkVsBg >= 3 || (haloVsBg >= 3 && inkVsHalo >= 3))) lowContrast.push(label);
      if (halo[3] === 0 && inkVsBg < 3) lowContrast.push(label);
    };

    let wraps = false;
    let wrapsBack = false;
    if (controls.length > 0) {
      // Start from nothing focused in the screen, as after the first intent.
      (document.activeElement as HTMLElement | null)?.blur();
      const first = controls.at(0);
      const last = controls.at(-1);
      for (let i = 0; i < controls.length; i++) {
        press(false);
        const el = document.activeElement;
        if (!(el instanceof HTMLElement) || !scope.contains(el)) {
          escaped.push(`tab ${String(i + 1)}: ${name(el)}`);
          continue;
        }
        visited.add(name(el));
        check(el);
      }
      press(false);
      wraps = document.activeElement === first;
      press(true);
      wrapsBack = document.activeElement === last;
      // A Tab past the end never leaves the screen either.
      if (!scope.contains(document.activeElement)) escaped.push('shift+tab at the start');
    }
    return {
      screen: scope.dataset['screen'] ?? '',
      controls: controls.map(name),
      missing: controls.map(name).filter((n) => !visited.has(n)),
      escaped,
      noRing,
      hidden,
      lowContrast,
      wraps,
      wrapsBack,
    };
  });
}

/** One UI intent, as the window's keydown listener takes it (a single dispatch, then two frames). */
export async function tapKey(page: Page, code: string): Promise<void> {
  await page.evaluate(
    (c) =>
      new Promise<void>((resolve) => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { code: c, key: c, bubbles: true, cancelable: true }),
        );
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
    code,
  );
}

/** Presses a standard-mapping pad button for exactly one animation frame (see installVirtualPad). */
export async function tapPad(page: Page, index: number): Promise<void> {
  await page.evaluate(
    (button) =>
      new Promise<void>((resolve) => {
        const pad = (window as unknown as { __pad: { buttons: number[] } }).__pad;
        pad.buttons[button] = 1;
        requestAnimationFrame(() => {
          pad.buttons[button] = 0;
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
    index,
  );
}

export const PAD = {
  a: 0,
  b: 1,
  x: 2,
  lb: 4,
  rb: 5,
  menu: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
};

/** data-screen of every open screen, bottom first, and what holds focus. */
export async function screenStack(
  page: Page,
): Promise<{ screens: string[]; focus: string; inTop: boolean }> {
  return page.evaluate(() => {
    const screens = [...document.querySelectorAll<HTMLElement>('.vb-menus > [data-screen]')];
    const active = document.activeElement as HTMLElement | null;
    const label = active
      ? (active.getAttribute('aria-label') ?? active.textContent).trim().slice(0, 40)
      : '';
    return {
      screens: screens.map((s) => s.dataset['screen'] ?? ''),
      focus: label,
      inTop: screens.at(-1)?.contains(active) ?? false,
    };
  });
}

/** The first problem a sweep found, as a readable string (empty when it is clean). */
export function sweepProblems(s: Sweep): string[] {
  const out: string[] = [];
  if (s.controls.length === 0) out.push('no controls');
  if (s.missing.length > 0) out.push(`unreached: ${s.missing.join(', ')}`);
  if (s.escaped.length > 0) out.push(`escaped: ${s.escaped.join(', ')}`);
  if (s.noRing.length > 0) out.push(`no ring: ${s.noRing.join(', ')}`);
  if (s.hidden.length > 0) out.push(`ring clipped or off screen: ${s.hidden.join(', ')}`);
  if (s.lowContrast.length > 0) out.push(`ring low contrast: ${s.lowContrast.join(', ')}`);
  if (!s.wraps) out.push('Tab does not wrap');
  if (!s.wrapsBack) out.push('Shift+Tab does not wrap');
  return out;
}
