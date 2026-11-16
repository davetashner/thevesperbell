// Pixel operations of the asset pipeline (style bible §17): the steps Claude runs between a generated
// image and a runtime file, as pure functions over RGBA buffers so they are deterministic and tested.
// Decoding and encoding happen in headless Chromium (the *-cli.ts entry points); everything that
// decides what a pixel becomes lives here.
//
// - `makeTileable`: overlap-blends the far edge of an image into its near edge on one or both axes,
//   so the result repeats without a seam (tileables both ways, trims left to right).
// - `periodCrop`: crops an alpha cut-out (a net) to whole repeats of its pattern, found from the
//   opaque lines' positions, so the tile repeats without a doubled or missing line.
// - `isolateFigure`: keeps only the largest shape on a plain background (one prop or one character
//   cropped from a sheet), blanking neighbours that crept into the crop.
// - `removeThinVerticalLines`: erases one-pixel-wide guide lines (a sheet's 1.8 m scale line) that
//   touch a figure, which isolation alone cannot separate.

/** An RGBA image, row-major, 4 bytes per pixel. */
export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** A blank image of the given size. */
export function blank(width: number, height: number): Rgba {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

const at = (img: Rgba, x: number, y: number): number => (y * img.width + x) * 4;
/** `a[i]` for an index the caller keeps in range (typed arrays and lists sized by the image). */
const get = <T>(a: ArrayLike<T>, i: number): T => a[i] as T;

/** The image cropped to `[x0, x1) × [y0, y1)`. */
export function crop(img: Rgba, x0: number, y0: number, x1: number, y1: number): Rgba {
  if (x0 < 0 || y0 < 0 || x1 > img.width || y1 > img.height || x1 <= x0 || y1 <= y0) {
    throw new RangeError(`crop ${String(x0)},${String(y0)}–${String(x1)},${String(y1)} is outside ${String(img.width)}×${String(img.height)}`);
  }
  const out = blank(x1 - x0, y1 - y0);
  for (let y = y0; y < y1; y++) {
    const from = at(img, x0, y);
    out.data.set(img.data.subarray(from, from + out.width * 4), (y - y0) * out.width * 4);
  }
  return out;
}

/** Blends the last `overlap` columns (axis x) or rows (axis y) into the first ones and drops them. */
function blendAxis(img: Rgba, axis: 'x' | 'y', overlap: number): Rgba {
  const length = axis === 'x' ? img.width : img.height;
  if (overlap < 1 || overlap * 2 > length) {
    throw new RangeError(`overlap ${String(overlap)} must be between 1 and half the ${axis} size ${String(length)}`);
  }
  const out =
    axis === 'x' ? crop(img, 0, 0, img.width - overlap, img.height) : crop(img, 0, 0, img.width, img.height - overlap);
  for (let i = 0; i < overlap; i++) {
    // t runs 0 → 1 across the band: the first column is all far edge, the last all near edge.
    const t = overlap === 1 ? 1 : i / (overlap - 1);
    const across = axis === 'x' ? img.height : img.width;
    for (let j = 0; j < across; j++) {
      const near = axis === 'x' ? at(img, i, j) : at(img, j, i);
      const far = axis === 'x' ? at(img, length - overlap + i, j) : at(img, j, length - overlap + i);
      const dest = axis === 'x' ? at(out, i, j) : at(out, j, i);
      for (let c = 0; c < 4; c++) {
        out.data[dest + c] = get(img.data, far + c) * (1 - t) + get(img.data, near + c) * t;
      }
    }
  }
  return out;
}

/** The image made seamless on `axes` by an overlap blend of `ratio` of its size (default 10%). */
export function makeTileable(img: Rgba, axes: 'both' | 'x' | 'y', ratio = 0.1): Rgba {
  let out = img;
  if (axes !== 'y') out = blendAxis(out, 'x', Math.max(1, Math.round(img.width * ratio)));
  if (axes !== 'x') out = blendAxis(out, 'y', Math.max(1, Math.round(img.height * ratio)));
  return out;
}

/**
 * Centres of the runs where `profile` stays at or above `threshold`, merging runs closer than `gap`.
 * Used to find the opaque lines of a cut-out along one axis.
 */
export function peaks(profile: readonly number[], threshold: number, gap: number): number[] {
  const runs: [number, number][] = [];
  let start = -1;
  profile.forEach((v, i) => {
    if (v >= threshold && start < 0) start = i;
    if ((v < threshold || i === profile.length - 1) && start >= 0) {
      const end = v >= threshold ? i : i - 1;
      const last = runs[runs.length - 1];
      if (last !== undefined && start - last[1] < gap) last[1] = end;
      else runs.push([start, end]);
      start = -1;
    }
  });
  return runs.map(([a, b]) => (a + b) / 2);
}

/** Mean alpha (0–1) of each column (axis x) or row (axis y). */
export function alphaProfile(img: Rgba, axis: 'x' | 'y'): number[] {
  const length = axis === 'x' ? img.width : img.height;
  const across = axis === 'x' ? img.height : img.width;
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let j = 0; j < across; j++) sum += get(img.data, (axis === 'x' ? at(img, i, j) : at(img, j, i)) + 3);
    out.push(sum / across / 255);
  }
  return out;
}

/**
 * An alpha cut-out cropped to whole repeats of its pattern on both axes: from the midpoint between
 * its first two opaque lines to the midpoint between its last two, so the tile's seams fall halfway
 * between lines and the spacing across a seam matches the spacing inside.
 */
export function periodCrop(img: Rgba, threshold = 0.6, gap = 20): Rgba {
  const bounds = (axis: 'x' | 'y'): [number, number] => {
    const lines = peaks(alphaProfile(img, axis), threshold, gap);
    if (lines.length < 3) throw new RangeError(`found ${String(lines.length)} lines along ${axis}; need 3`);
    const mid = (a: number, b: number): number => Math.round((a + b) / 2);
    const n = lines.length;
    return [mid(get(lines, 0), get(lines, 1)), mid(get(lines, n - 2), get(lines, n - 1))];
  };
  const [x0, x1] = bounds('x');
  const [y0, y1] = bounds('y');
  return crop(img, x0, y0, x1, y1);
}

/**
 * The background colour: the median of the image's border pixels (a sheet crop's frame is always
 * the parchment ground; a figure wider than half a row would fool a per-row median).
 */
function background(img: Rgba): [number, number, number] {
  const border: number[] = [];
  for (let x = 0; x < img.width; x++) border.push(at(img, x, 0), at(img, x, img.height - 1));
  for (let y = 1; y < img.height - 1; y++) border.push(at(img, 0, y), at(img, img.width - 1, y));
  const channel = (c: number): number => {
    const values = border.map((p) => get(img.data, p + c)).sort((a, b) => a - b);
    return get(values, Math.floor(values.length / 2));
  };
  return [channel(0), channel(1), channel(2)];
}

/** Which pixels differ from the background by more than `tolerance` (summed RGB). */
function foreground(img: Rgba, tolerance: number): Uint8Array {
  const row = background(img);
  const mask = new Uint8Array(img.width * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const p = at(img, x, y);
      let d = 0;
      for (let c = 0; c < 3; c++) d += Math.abs(get(img.data, p + c) - get(row, c));
      mask[y * img.width + x] = d > tolerance ? 1 : 0;
    }
  }
  return mask;
}

/** `img` with the pixels where `keep` is false set to the background. */
function blankOutside(img: Rgba, keep: (x: number, y: number) => boolean): Rgba {
  const row = background(img);
  const out: Rgba = { width: img.width, height: img.height, data: img.data.slice() };
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (keep(x, y)) continue;
      const p = at(out, x, y);
      out.data[p] = row[0];
      out.data[p + 1] = row[1];
      out.data[p + 2] = row[2];
    }
  }
  return out;
}

/**
 * Keeps only the largest connected shape that stands out from the background (the border's median colour,
 * `tolerance` summed RGB), found on a grid of `cell`-pixel blocks so thin gaps inside the figure do
 * not split it; everything else becomes background.
 */
export function isolateFigure(img: Rgba, tolerance = 30, cell = 4): Rgba {
  const mask = foreground(img, tolerance);
  const w = Math.ceil(img.width / cell);
  const h = Math.ceil(img.height / cell);
  const grid = new Uint8Array(w * h);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (mask[y * img.width + x]) grid[Math.floor(y / cell) * w + Math.floor(x / cell)] = 1;
    }
  }
  const label = new Int32Array(w * h);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (!grid[start] || label[start]) continue;
    next += 1;
    label[start] = next;
    const queue = [start];
    let size = 0;
    for (let head = 0; head < queue.length; head++) {
      const i = get(queue, head);
      size += 1;
      const x = i % w;
      const y = Math.floor(i / w);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * w + nx;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && grid[j] && !label[j]) {
          label[j] = next;
          queue.push(j);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  if (best === 0) return img;
  return blankOutside(img, (x, y) => label[Math.floor(y / cell) * w + Math.floor(x / cell)] === best);
}

/**
 * Erases thin vertical guide lines (at most `maxWidth` px wide, covering at least `minCover` of the
 * height) that stand out from their neighbours, even where they touch a figure.
 */
export function removeThinVerticalLines(
  img: Rgba,
  tolerance = 45,
  maxWidth = 4,
  minCover = 0.35,
): Rgba {
  const mask = foreground(img, tolerance);
  const count = (x: number): number => {
    let n = 0;
    for (let y = 0; y < img.height; y++) n += get(mask, y * img.width + x);
    return n;
  };
  const counts = Array.from({ length: img.width }, (_, x) => count(x));
  const line = new Set<number>();
  for (let x = 0; x < img.width; x++) {
    if (get(counts, x) < minCover * img.height) continue;
    const side = (dx: number): number => get(counts, Math.min(img.width - 1, Math.max(0, x + dx)));
    const left = Math.max(side(-maxWidth - 1), side(-maxWidth - 2));
    const right = Math.max(side(maxWidth + 1), side(maxWidth + 2));
    if (get(counts, x) > 2 * Math.max(left, right) + 10) line.add(x);
  }
  return blankOutside(img, (x, y) => !(line.has(x) && mask[y * img.width + x]));
}

/** `img` centred on a square canvas `margin` px wider than its longer side, padded with `colour`. */
export function padSquare(img: Rgba, margin: number, colour: readonly [number, number, number]): Rgba {
  const size = Math.max(img.width, img.height) + margin * 2;
  const out = blank(size, size);
  for (let i = 0; i < size * size; i++) {
    out.data[i * 4] = colour[0];
    out.data[i * 4 + 1] = colour[1];
    out.data[i * 4 + 2] = colour[2];
    out.data[i * 4 + 3] = 255;
  }
  const ox = Math.floor((size - img.width) / 2);
  const oy = Math.floor((size - img.height) / 2);
  for (let y = 0; y < img.height; y++) {
    const from = at(img, 0, y);
    out.data.set(img.data.subarray(from, from + img.width * 4), at(out, ox, oy + y));
  }
  return out;
}

/** The image repeated `nx` × `ny` times: the seam check of a tileable. */
export function repeatTile(img: Rgba, nx: number, ny: number): Rgba {
  const out = blank(img.width * nx, img.height * ny);
  for (let ty = 0; ty < ny; ty++) {
    for (let y = 0; y < img.height; y++) {
      const from = at(img, 0, y);
      for (let tx = 0; tx < nx; tx++) {
        out.data.set(img.data.subarray(from, from + img.width * 4), at(out, tx * img.width, ty * img.height + y));
      }
    }
  }
  return out;
}
