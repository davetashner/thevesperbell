// Entry point: node scripts/assets/crop-cli.ts <sheet image> <out .png> --box x0,y0,x1,y1 [options]
//
// Cuts one prop or character out of an approved sheet as the image-to-3D input (style bible §17.2):
// the box in sheet pixels, then (by default) only the largest shape kept so a neighbour that crept into
// the box is blanked, the sheet's thin scale lines erased, and the result padded square on the sheet's
// own background. Always check the output by eye: one figure, nothing else, before spending credits.
//   --box x0,y0,x1,y1   crop rectangle in sheet pixels (required)
//   --keep-all          skip the isolation and line removal (props with deliberate separate parts)
//   --margin N          padding around the figure, px (default 40)
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decodeImage, encodeImage, withPage } from './chromium.ts';
import { crop, isolateFigure, padSquare, removeThinVerticalLines, type Rgba } from './pixels.ts';

const USAGE = 'usage: crop-cli.ts <sheet> <out.png> --box x0,y0,x1,y1 [--keep-all] [--margin N]';

/** The image-to-3D input cut from `sheet`: crop, clean (unless `keepAll`), pad square. */
export function cutFigure(
  sheet: Rgba,
  box: readonly [number, number, number, number],
  keepAll: boolean,
  margin: number,
): Rgba {
  let figure = crop(sheet, ...box);
  if (!keepAll) figure = isolateFigure(removeThinVerticalLines(figure));
  // Pad with the crop's top-left pixel: the sheet's own parchment there.
  return padSquare(figure, margin, Array.from(figure.data.subarray(0, 3)) as [number, number, number]);
}

/** Runs the CLI; returns the exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      box: { type: 'string' },
      'keep-all': { type: 'boolean', default: false },
      margin: { type: 'string', default: '40' },
    },
  });
  const [source, target] = positionals;
  const box = values.box?.split(',').map(Number);
  if (source === undefined || target === undefined || box?.length !== 4) {
    console.error(USAGE);
    return 2;
  }
  await withPage(async (page) => {
    const padded = cutFigure(
      await decodeImage(page, source),
      box as [number, number, number, number],
      values['keep-all'],
      Number(values.margin),
    );
    writeFileSync(target, await encodeImage(page, padded, target));
    console.log(`${target}: ${String(padded.width)}×${String(padded.height)} from ${source}`);
  });
  return 0;
}

if (process.argv[1]?.endsWith('crop-cli.ts') === true) {
  process.exitCode = await main(process.argv.slice(2));
}
