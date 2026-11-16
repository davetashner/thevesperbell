import { describe, expect, it } from 'vitest';
import {
  alphaProfile,
  blank,
  crop,
  isolateFigure,
  makeTileable,
  padSquare,
  peaks,
  periodCrop,
  removeThinVerticalLines,
  repeatTile,
  type Rgba,
} from './pixels';

/** An image filled by `paint(x, y)` → [r, g, b, a]. */
function image(width: number, height: number, paint: (x: number, y: number) => number[]): Rgba {
  const img = blank(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) img.data.set(paint(x, y), (y * width + x) * 4);
  }
  return img;
}
const px = (img: Rgba, x: number, y: number): number[] =>
  Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const PARCHMENT = [239, 226, 196, 255];
const INK = [30, 27, 46, 255];

describe('asset pipeline pixels', () => {
  it('crop copies a rectangle and refuses one outside the image', () => {
    const img = image(4, 3, (x, y) => [x, y, 0, 255]);
    const out = crop(img, 1, 1, 3, 3);
    expect([out.width, out.height]).toEqual([2, 2]);
    expect(px(out, 0, 0)).toEqual([1, 1, 0, 255]);
    expect(px(out, 1, 1)).toEqual([2, 2, 0, 255]);
    expect(() => crop(img, 0, 0, 5, 1)).toThrow(RangeError);
    expect(() => crop(img, 2, 0, 2, 1)).toThrow(RangeError);
    expect(() => crop(img, -1, 0, 1, 1)).toThrow(RangeError);
  });

  it('makeTileable blends the far edge into the near one so the tile repeats without a seam', () => {
    // A horizontal ramp: column x has value 10x. After the blend the new first column equals the
    // dropped last overlap column, so the wrap-around step matches the steps inside.
    const img = image(20, 4, (x) => [x * 10, 0, 0, 255]);
    const out = makeTileable(img, 'x', 0.1);
    expect([out.width, out.height]).toEqual([18, 4]);
    expect(px(out, 0, 0)[0]).toBe(180); // all far edge
    expect(px(out, 1, 0)[0]).toBe(10); // all near edge (t = 1)
    const both = makeTileable(image(10, 10, (x, y) => [x, y, 0, 255]), 'both');
    expect([both.width, both.height]).toEqual([9, 9]);
    const rows = makeTileable(image(4, 10, (_, y) => [0, y * 10, 0, 255]), 'y', 0.2);
    expect([rows.width, rows.height]).toEqual([4, 8]);
    expect(px(rows, 0, 0)[1]).toBe(80);
    // A one-pixel overlap copies the near edge over (t = 1).
    expect(px(makeTileable(img, 'x', 0.01), 0, 0)[0]).toBe(0);
    expect(() => makeTileable(image(2, 2, () => [0, 0, 0, 0]), 'x', 0.9)).toThrow(RangeError);
  });

  it('peaks finds the centres of the runs over a threshold, merging runs closer than the gap', () => {
    expect(peaks([0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1], 0.5, 2)).toEqual([1.5, 6, 9.5]);
    expect(peaks([1, 0, 1], 0.5, 3)).toEqual([1]); // merged
    expect(peaks([0, 0], 0.5, 1)).toEqual([]);
  });

  it('periodCrop cuts an alpha net to whole repeats so lines keep their spacing across the seam', () => {
    // Opaque lines every 10 px starting at 5 (x and y): 5, 15, 25, 35.
    const net = image(40, 40, (x, y) => [180, 140, 90, x % 10 === 5 || y % 10 === 5 ? 255 : 0]);
    expect(alphaProfile(net, 'x')[5]).toBe(1);
    expect(alphaProfile(net, 'y')[0]).toBeCloseTo(0.1, 5);
    const out = periodCrop(net, 0.6, 3);
    // From the midpoint of lines 5 and 15 (10) to that of 25 and 35 (30): two whole periods.
    expect([out.width, out.height]).toEqual([20, 20]);
    expect(() => periodCrop(image(10, 10, () => [0, 0, 0, 0]))).toThrow(RangeError);
  });

  it('isolateFigure keeps the largest shape and blanks neighbours that crept into the crop', () => {
    const img = image(40, 20, (x, y) => {
      if (x >= 4 && x < 20 && y >= 2 && y < 18) return INK; // the figure
      if (x >= 34 && x < 37 && y >= 8 && y < 11) return INK; // a neighbour's corner
      return PARCHMENT;
    });
    const out = isolateFigure(img, 30, 2);
    expect(px(out, 10, 10)).toEqual(INK);
    expect(px(out, 35, 9)).toEqual(PARCHMENT);
    // A figure wider than half the image (a broad character in a tight crop) still reads as the
    // figure: the background comes from the border, not from each row's median.
    const wide = image(40, 20, (x, y) => (x >= 2 && x < 38 && y >= 2 && y < 18 ? INK : PARCHMENT));
    expect(px(isolateFigure(wide, 30, 2), 20, 10)).toEqual(INK);
    // A plain image has no figure and comes back unchanged.
    const plain = image(8, 8, () => PARCHMENT);
    expect(isolateFigure(plain)).toBe(plain);
  });

  it('removeThinVerticalLines erases a guide line that touches the figure and keeps the figure', () => {
    const img = image(120, 40, (x, y) => {
      if (x === 10) return INK; // the 1.8 m line, full height
      if (x >= 90 && x < 101) return INK; // a wide full-height pillar: tall but not thin
      if (x >= 11 && x < 40 && y >= 15 && y < 25) return INK; // figure touching it
      return PARCHMENT;
    });
    const out = removeThinVerticalLines(img, 45, 2, 0.35);
    expect(px(out, 10, 2)).toEqual(PARCHMENT); // the line above the figure is gone
    expect(px(out, 20, 20)).toEqual(INK); // the figure stays
    expect(px(out, 30, 20)).toEqual(INK);
    expect(px(out, 95, 2)).toEqual(INK); // the pillar is not a guide line
  });

  it('padSquare centres the image on a square of the given colour', () => {
    const out = padSquare(image(4, 2, () => INK), 1, [239, 226, 196]);
    expect([out.width, out.height]).toEqual([6, 6]);
    expect(px(out, 0, 0)).toEqual(PARCHMENT);
    expect(px(out, 1, 2)).toEqual(INK);
    expect(px(out, 1, 1)).toEqual(PARCHMENT);
  });

  it('repeatTile lays the image out nx by ny for a seam check', () => {
    const out = repeatTile(image(2, 1, (x) => [x, 0, 0, 255]), 2, 2);
    expect([out.width, out.height]).toEqual([4, 2]);
    expect(out.data.slice(0, 16)).toEqual(new Uint8ClampedArray([0, 0, 0, 255, 1, 0, 0, 255, 0, 0, 0, 255, 1, 0, 0, 255]));
    expect(px(out, 3, 1)[0]).toBe(1);
  });
});
