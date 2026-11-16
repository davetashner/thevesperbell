// Headless Chromium for the asset pipeline's command-line tools (texture-cli, crop-cli, turntable-cli):
// decodes images into RGBA, encodes RGBA back to PNG, JPEG or WebP (resizing on the way), and hands a
// page to the turntable renderer. The project has no image library; Playwright's Chromium is already
// installed for the e2e suite and reads and writes every format the pipeline needs.
//
// The code that runs inside the page is kept as source text (it uses browser-only APIs), so the Node
// side here is unit tested against a stand-in page; the pixel decisions are in pixels.ts.

import { existsSync, readFileSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';
import type { Rgba } from './pixels.ts';

/** Where this repo's cloud sessions keep Chromium; elsewhere Playwright's own install is used. */
export const KNOWN_CHROMIUM = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';

/** The executable to launch: CHROMIUM_PATH, else the known cloud path if present, else Playwright's. */
export function chromiumPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  return env['CHROMIUM_PATH'] ?? (exists(KNOWN_CHROMIUM) ? KNOWN_CHROMIUM : undefined);
}

/** Launches Chromium with software WebGL (for turntables) and runs `fn` on a fresh page. */
export async function withPage<T>(
  fn: (page: Page) => Promise<T>,
  executablePath: string | undefined = chromiumPath(),
): Promise<T> {
  const browser = await chromium.launch({
    ...(executablePath === undefined ? {} : { executablePath }),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    return await fn(page);
  } finally {
    await browser.close();
  }
}

const MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** The MIME type for a file path's extension. */
export function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const mime = MIME[ext];
  if (mime === undefined) throw new Error(`unsupported image type: ${path}`);
  return mime;
}

/** In-page: bytes to base64 in chunks (String.fromCharCode cannot take a whole image at once). */
const TO_BASE64 = `(bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}`;

/** In-page: decode a base64 image of a MIME type into { width, height, pixels (base64 RGBA) }. */
export const DECODE_SOURCE = `async ([data, mime]) => {
  const toBase64 = ${TO_BASE64};
  const blob = await (await fetch('data:' + mime + ';base64,' + data)).blob();
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { width: bitmap.width, height: bitmap.height, pixels: toBase64(image.data) };
}`;

/** In-page: encode base64 RGBA (w × h), resized to ow × oh, as a MIME type; returns base64 bytes. */
export const ENCODE_SOURCE = `async ([data, w, h, ow, oh, mime, quality]) => {
  const toBase64 = ${TO_BASE64};
  const bytes = Uint8ClampedArray.from(atob(data), (c) => c.charCodeAt(0));
  const source = new OffscreenCanvas(w, h);
  source.getContext('2d').putImageData(new ImageData(bytes, w, h), 0, 0);
  const target = new OffscreenCanvas(ow, oh);
  const ctx = target.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, ow, oh);
  const blob = await target.convertToBlob({ type: mime, quality });
  return toBase64(new Uint8Array(await blob.arrayBuffer()));
}`;

/** The slice of a Playwright page the codecs use (a stand-in in tests). */
export interface EvaluatingPage {
  evaluate<R>(expression: string): Promise<R>;
}

/** Runs in-page `source` (a function's text) on `arg` (JSON). */
async function run<R>(page: EvaluatingPage, source: string, arg: unknown): Promise<R> {
  return page.evaluate<R>(`(${source})(${JSON.stringify(arg)})`);
}

/** Decodes the image file at `path` into RGBA. */
export async function decodeImage(page: EvaluatingPage, path: string): Promise<Rgba> {
  const base64 = readFileSync(path).toString('base64');
  const { width, height, pixels } = await run<{ width: number; height: number; pixels: string }>(page, DECODE_SOURCE, [base64, mimeFor(path)]);
  return { width, height, data: new Uint8ClampedArray(Buffer.from(pixels, 'base64')) };
}

/** Encodes `img` (resized to `width` × `height` when given) for `path`'s type; returns the bytes. */
export async function encodeImage(
  page: EvaluatingPage,
  img: Rgba,
  path: string,
  options: { width?: number; height?: number; quality?: number } = {},
): Promise<Buffer> {
  const out = await run<string>(
    page,
    ENCODE_SOURCE,
    [
      Buffer.from(img.data).toString('base64'),
      img.width,
      img.height,
      options.width ?? img.width,
      options.height ?? img.height,
      mimeFor(path),
      options.quality ?? 0.88,
    ],
  );
  return Buffer.from(out, 'base64');
}
