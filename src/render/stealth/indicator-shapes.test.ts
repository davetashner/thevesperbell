import { describe, expect, it } from 'vitest';
import { ALERT_STATES } from '@content/index';
import { at } from '../vfx/trail-ribbon';
import {
  colourDistance,
  fillOutline,
  INDICATOR_STYLES,
  insideOutline,
  shapeOutline,
  silhouetteDistance,
  simulateDeuteranopia,
  VISIBLE_STATES,
} from './indicator-shapes';

/** The least two silhouettes may differ by (1 - intersection over union) to count as different. */
const MIN_SHAPE_DISTANCE = 0.3;

describe('awareness indicator shapes (mw-e29.12)', () => {
  it('AC-3: under a deuteranopia filter every state is still told apart by shape alone', () => {
    // Every visible state wears its own shape.
    const shapes = VISIBLE_STATES.map((s) => INDICATOR_STYLES[s].shape);
    expect(new Set(shapes).size).toBe(VISIBLE_STATES.length);
    // Every pair differs in silhouette by a clear margin, whatever the colours are.
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const a = at(shapes, i);
        const b = at(shapes, j);
        expect(silhouetteDistance(a, b), `${a} vs ${b}`).toBeGreaterThanOrEqual(MIN_SHAPE_DISTANCE);
      }
    }
    // The filter really does fold some colours together (so colour alone would not do) ...
    const seen = VISIBLE_STATES.map((s) => simulateDeuteranopia(INDICATOR_STYLES[s].colour));
    let closest = Infinity;
    for (let i = 0; i < seen.length; i++) {
      for (let j = i + 1; j < seen.length; j++) {
        closest = Math.min(closest, colourDistance(at(seen, i), at(seen, j)));
      }
    }
    // ... searching and investigating share a colour outright, and only their shapes differ.
    expect(closest).toBe(0);
    expect(INDICATOR_STYLES.searching.colour).toBe(INDICATOR_STYLES.investigating.colour);
    expect(silhouetteDistance('crescent', 'diamond')).toBeGreaterThanOrEqual(MIN_SHAPE_DISTANCE);
  });

  it('the visible states are every alert state but Unaware', () => {
    expect([...VISIBLE_STATES].sort()).toEqual(ALERT_STATES.filter((s) => s !== 'unaware').sort());
  });

  it('the deuteranopia filter leaves black, white and grey alone and shifts red and green', () => {
    expect(simulateDeuteranopia(0x000000)).toBe(0);
    expect(simulateDeuteranopia(0xffffff)).toBe(0xffffff);
    const grey = simulateDeuteranopia(0x808080);
    expect(colourDistance(grey, 0x808080)).toBeLessThan(4);
    expect(colourDistance(simulateDeuteranopia(0xff0000), 0xff0000)).toBeGreaterThan(60);
    expect(colourDistance(simulateDeuteranopia(0x00ff00), 0x00ff00)).toBeGreaterThan(60);
  });

  it('a shape filled to a fraction keeps the part below that height of its own height', () => {
    const disc = shapeOutline('disc');
    expect(fillOutline(disc, 0)).toEqual([]);
    expect(fillOutline(disc, 1)).toBe(disc);
    expect(fillOutline(disc, -3)).toEqual([]);
    const forty = fillOutline(disc, 0.4);
    const top = Math.max(...forty.map((p) => p.y));
    const [lo, hi] = [Math.min(...disc.map((p) => p.y)), Math.max(...disc.map((p) => p.y))];
    expect(top).toBeCloseTo(lo + (hi - lo) * 0.4, 6);
    expect(Math.min(...forty.map((p) => p.y))).toBeCloseTo(lo, 6);
  });

  it('every shape is a closed polygon around the origin and contains its middle or its body', () => {
    for (const s of VISIBLE_STATES) {
      const outline = shapeOutline(INDICATOR_STYLES[s].shape);
      expect(outline.length).toBeGreaterThanOrEqual(3);
      expect(
        Math.max(...outline.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))),
      ).toBeLessThanOrEqual(1.2);
    }
    expect(insideOutline(shapeOutline('disc'), 0, 0)).toBe(true);
    expect(insideOutline(shapeOutline('disc'), 1.1, 0)).toBe(false);
    // The crescent's bite is hollow.
    expect(insideOutline(shapeOutline('crescent'), 0.5, 0)).toBe(false);
    expect(insideOutline(shapeOutline('crescent'), -0.7, 0)).toBe(true);
  });
});
