// The look of the world-space awareness indicator (mw-e29.12): which silhouette and colour each
// alert state wears, as plain data. Pure and renderer-free, so the rule that matters most is unit
// tested: every state is told apart by its silhouette alone, with no help from colour, including
// under a deuteranopia filter (style bible §8, colour-blind safety: every cue pairs colour with
// shape). Colours follow the stealth feedback line of §8, parchment, then hearth, then ember as
// alertness rises; the debug overlay's own tints (src/tools/ai-debug) are for developers and
// unrelated.
//
// Shapes are solid polygons in a unit square (x right, y up, about the origin, radius 1). The
// indicator draws one as an ink-edged backdrop and fills it from the bottom: Suspicious fills with
// suspicion, every other state is full.

import type { AlertState } from '@content/index';
import { at } from '../vfx/trail-ribbon';

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

/** The states that show an indicator; Unaware shows none. */
export type VisibleAlertState = Exclude<AlertState, 'unaware'>;

/** The visible states, from the calmest to the most alarmed. */
export const VISIBLE_STATES: readonly VisibleAlertState[] = Object.freeze([
  'suspicious',
  'investigating',
  'searching',
  'alerted',
  'combat',
]);

export type IndicatorShape = 'disc' | 'diamond' | 'crescent' | 'triangle' | 'star';

/** What one visible state looks like. */
export interface IndicatorStyle {
  readonly shape: IndicatorShape;
  /** Fill colour, 0xRRGGBB. */
  readonly colour: number;
}

/** Style bible §2.1 palette: parchment, hearth and ember, plus a brighter ember for combat. */
export const INDICATOR_STYLES: Readonly<Record<VisibleAlertState, IndicatorStyle>> = Object.freeze({
  suspicious: Object.freeze({ shape: 'disc', colour: 0xefe2c4 }),
  investigating: Object.freeze({ shape: 'diamond', colour: 0xe8a24a }),
  searching: Object.freeze({ shape: 'crescent', colour: 0xe8a24a }),
  alerted: Object.freeze({ shape: 'triangle', colour: 0xc8553d }),
  combat: Object.freeze({ shape: 'star', colour: 0xe23b2a }),
});

/** The dark edge and backdrop every indicator is drawn on, so it reads on bright and dark ground. */
export const INDICATOR_INK = 0x1b1713;
export const INDICATOR_BACKDROP = 0x3a322a;

const DISC_SEGMENTS = 28;
const STAR_POINTS = 5;

function polar(radius: number, angle: number): Point2 {
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

function buildOutline(shape: IndicatorShape): readonly Point2[] {
  const out: Point2[] = [];
  switch (shape) {
    case 'disc':
      for (let i = 0; i < DISC_SEGMENTS; i++) out.push(polar(1, (2 * Math.PI * i) / DISC_SEGMENTS));
      break;
    case 'diamond':
      out.push({ x: 0, y: 1.1 }, { x: 0.8, y: 0 }, { x: 0, y: -1.1 }, { x: -0.8, y: 0 });
      break;
    case 'triangle':
      out.push({ x: 0, y: 1.05 }, { x: 1, y: -0.85 }, { x: -1, y: -0.85 });
      break;
    case 'star':
      for (let i = 0; i < STAR_POINTS * 2; i++) {
        out.push(polar(i % 2 === 0 ? 1.15 : 0.5, Math.PI / 2 + (Math.PI * i) / STAR_POINTS));
      }
      break;
    case 'crescent': {
      // A disc with a bite taken out of its right side: the outer arc, then the bite's arc back.
      const steps = 14;
      for (let i = 0; i <= steps; i++) out.push(polar(1, Math.PI / 2 + (Math.PI * i) / steps));
      for (let i = 0; i <= steps; i++) {
        const p = polar(0.8, (3 * Math.PI) / 2 - (Math.PI * i) / steps);
        out.push({ x: p.x * 0.8 + 0.28, y: p.y });
      }
      break;
    }
  }
  return Object.freeze(out);
}

const OUTLINES: Readonly<Record<IndicatorShape, readonly Point2[]>> = Object.freeze({
  disc: buildOutline('disc'),
  diamond: buildOutline('diamond'),
  crescent: buildOutline('crescent'),
  triangle: buildOutline('triangle'),
  star: buildOutline('star'),
});

/** The shape's outline, counter-clockwise, in the unit square. */
export function shapeOutline(shape: IndicatorShape): readonly Point2[] {
  return OUTLINES[shape];
}

/** The lowest and highest y of an outline. */
function yRange(points: readonly Point2[]): { readonly min: number; readonly max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    min = Math.min(min, p.y);
    max = Math.max(max, p.y);
  }
  return { min, max };
}

/**
 * The part of `outline` below the line that is `fill` (0–1) of the way up its height: a shape
 * filling like a cup. Fully empty is an empty list, full is the outline itself.
 */
export function fillOutline(outline: readonly Point2[], fill: number): readonly Point2[] {
  const f = Math.min(1, Math.max(0, fill));
  if (f <= 0) return [];
  if (f >= 1) return outline;
  const { min, max } = yRange(outline);
  const level = min + (max - min) * f;
  const out: Point2[] = [];
  outline.forEach((a, i) => {
    const b = at(outline, (i + 1) % outline.length);
    const aIn = a.y <= level;
    const bIn = b.y <= level;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (level - a.y) / (b.y - a.y);
      out.push({ x: a.x + (b.x - a.x) * t, y: level });
    }
  });
  return out;
}

/** Whether (x, y) is inside the polygon (even-odd rule). */
export function insideOutline(outline: readonly Point2[], x: number, y: number): boolean {
  let inside = false;
  outline.forEach((a, i) => {
    const b = at(outline, (i + 1) % outline.length);
    if (a.y > y !== b.y > y && x < a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
  });
  return inside;
}

/** Cells per side of the silhouette bitmap. */
export const SILHOUETTE_CELLS = 32;

/** The shape's silhouette as a bitmap over [-1.25, 1.25]²: what a distant player sees of it. */
export function silhouette(shape: IndicatorShape): boolean[] {
  const outline = shapeOutline(shape);
  const bits: boolean[] = [];
  for (let row = 0; row < SILHOUETTE_CELLS; row++) {
    for (let col = 0; col < SILHOUETTE_CELLS; col++) {
      const x = ((col + 0.5) / SILHOUETTE_CELLS) * 2.5 - 1.25;
      const y = 1.25 - ((row + 0.5) / SILHOUETTE_CELLS) * 2.5;
      bits.push(insideOutline(outline, x, y));
    }
  }
  return bits;
}

/** How different two silhouettes are, 0 (identical) to 1 (no overlap): one minus intersection over union. */
export function silhouetteDistance(a: IndicatorShape, b: IndicatorShape): number {
  const sa = silhouette(a);
  const sb = silhouette(b);
  let both = 0;
  let either = 0;
  sa.forEach((bit, i) => {
    if (bit && sb[i] === true) both++;
    if (bit || sb[i] === true) either++;
  });
  return 1 - both / either;
}

/**
 * Deuteranopia as seen by a viewer without green cones (Machado, Oliveira and Fernandes 2009, severity
 * 1.0, on linear light), as 0xRRGGBB. The accessibility test uses it to show colour alone is not
 * enough and the shapes are.
 */
export function simulateDeuteranopia(colour: number): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const enc = (v: number): number => {
    const c = Math.min(1, Math.max(0, v));
    return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
  };
  const r = lin((colour >> 16) & 0xff);
  const g = lin((colour >> 8) & 0xff);
  const b = lin(colour & 0xff);
  const R = 0.367322 * r + 0.860646 * g - 0.227968 * b;
  const G = 0.280085 * r + 0.672501 * g + 0.047413 * b;
  const B = -0.01182 * r + 0.04294 * g + 0.968881 * b;
  return (enc(R) << 16) | (enc(G) << 8) | enc(B);
}

/** Straight RGB distance between two 0xRRGGBB colours, 0–441. */
export function colourDistance(a: number, b: number): number {
  const d = (shift: number): number => ((a >> shift) & 0xff) - ((b >> shift) & 0xff);
  return Math.hypot(d(16), d(8), d(0));
}
