// Entry point: node scripts/assets/texture-cli.ts <source image> <runtime .webp> [options]
//
// Turns a generated texture into its runtime file (style bible §17.1): seam repair, resize, WebP.
//   --mode both|x|alpha  both: seamless both ways (default); x: a trim, seamless left to right;
//                        alpha: a cut-out cropped to whole repeats of its pattern, then blended
//   --size WxH           runtime size (default 1024x1024; trims usually 1024x256)
//   --ratio R            overlap blend as a share of the image (default 0.1)
//   --preview PATH       also writes a 2×2 (trims 2×1) repeat of the result to check the seams
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decodeImage, encodeImage, withPage } from './chromium.ts';
import { makeTileable, periodCrop, repeatTile } from './pixels.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: 'string', default: 'both' },
    size: { type: 'string', default: '1024x1024' },
    ratio: { type: 'string', default: '0.1' },
    preview: { type: 'string' },
  },
});
const [source, target] = positionals;
if (source === undefined || target === undefined) {
  console.error('usage: texture-cli.ts <source image> <runtime .webp> [--mode both|x|alpha] [--size WxH]');
  process.exit(2);
}
const [width = 1024, height = 1024] = values.size.split('x').map(Number);
const ratio = Number(values.ratio);

await withPage(async (page) => {
  const img = await decodeImage(page, source);
  const tile =
    values.mode === 'x'
      ? makeTileable(img, 'x', ratio)
      : values.mode === 'alpha'
        ? makeTileable(periodCrop(img), 'both', 0.015)
        : makeTileable(img, 'both', ratio);
  writeFileSync(target, await encodeImage(page, tile, target, { width, height }));
  console.log(`${target}: ${String(width)}×${String(height)} from ${String(img.width)}×${String(img.height)} (${values.mode})`);
  if (values.preview !== undefined) {
    const sheet = repeatTile(tile, 2, values.mode === 'x' ? 1 : 2);
    writeFileSync(values.preview, await encodeImage(page, sheet, values.preview, { quality: 0.85 }));
    console.log(`${values.preview}: seam check`);
  }
});
