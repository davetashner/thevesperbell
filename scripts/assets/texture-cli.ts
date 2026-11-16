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
import { makeTileable, periodCrop, repeatTile, type Rgba } from './pixels.ts';

const USAGE =
  'usage: texture-cli.ts <source image> <runtime .webp> [--mode both|x|alpha] [--size WxH] [--ratio R] [--preview PATH]';

/** The seamless tile for `mode`. */
export function tileFor(img: Rgba, mode: string, ratio: number): Rgba {
  if (mode === 'x') return makeTileable(img, 'x', ratio);
  if (mode === 'alpha') return makeTileable(periodCrop(img), 'both', 0.015);
  if (mode === 'both') return makeTileable(img, 'both', ratio);
  throw new Error(`unknown --mode ${mode}`);
}

/** Runs the CLI; returns the exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
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
    console.error(USAGE);
    return 2;
  }
  const [width = 1024, height = 1024] = values.size.split('x').map(Number);
  await withPage(async (page) => {
    const img = await decodeImage(page, source);
    const tile = tileFor(img, values.mode, Number(values.ratio));
    writeFileSync(target, await encodeImage(page, tile, target, { width, height }));
    console.log(
      `${target}: ${String(width)}×${String(height)} from ${String(img.width)}×${String(img.height)} (${values.mode})`,
    );
    if (values.preview !== undefined) {
      const sheet = repeatTile(tile, 2, values.mode === 'x' ? 1 : 2);
      writeFileSync(values.preview, await encodeImage(page, sheet, values.preview, { quality: 0.85 }));
      console.log(`${values.preview}: seam check`);
    }
  });
  return 0;
}

if (process.argv[1]?.endsWith('texture-cli.ts') === true) {
  process.exitCode = await main(process.argv.slice(2));
}
