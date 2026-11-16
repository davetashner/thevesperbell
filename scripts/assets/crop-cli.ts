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
import { crop, isolateFigure, padSquare, removeThinVerticalLines } from './pixels.ts';

const { values, positionals } = parseArgs({
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
  console.error('usage: crop-cli.ts <sheet> <out.png> --box x0,y0,x1,y1 [--keep-all] [--margin N]');
  process.exit(2);
}
const [x0, y0, x1, y1] = box as [number, number, number, number];

await withPage(async (page) => {
  const sheet = await decodeImage(page, source);
  let figure = crop(sheet, x0, y0, x1, y1);
  if (!values['keep-all']) figure = isolateFigure(removeThinVerticalLines(figure));
  // Pad with the crop's top-left pixel: the sheet's own parchment there.
  const background: [number, number, number] = [
    figure.data[0] ?? 239,
    figure.data[1] ?? 226,
    figure.data[2] ?? 196,
  ];
  const padded = padSquare(figure, Number(values.margin), background);
  writeFileSync(target, await encodeImage(page, padded, target));
  console.log(`${target}: ${String(padded.width)}×${String(padded.height)} from ${source} box ${String(values.box)}`);
});
