// Headless Chromium for the asset pipeline's command-line tools (texture-cli, crop-cli, turntable-cli):
// decodes images into RGBA, encodes RGBA back to PNG, JPEG or WebP (resizing on the way), and hands a
// page to the turntable renderer. The project has no image library; Playwright's Chromium is already
// installed for the e2e suite and reads and writes every format the pipeline needs.
//
// Only the CLIs load this file (browsers are not installed in the unit-test jobs); the pixel decisions
// it carries out are in pixels.ts, which is unit tested.

import { existsSync, readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from '@playwright/test';
import type { Rgba } from './pixels.ts';

/** Where this repo's cloud sessions keep Chromium; elsewhere Playwright's own install is used. */
const KNOWN_CHROMIUM = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';

/** Launches Chromium with software WebGL (for turntables) and runs `fn` on a fresh page. */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const executablePath =
    process.env['CHROMIUM_PATH'] ?? (existsSync(KNOWN_CHROMIUM) ? KNOWN_CHROMIUM : undefined);
  const browser: Browser = await chromium.launch({
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

/** Decodes the image file at `path` into RGBA. */
export async function decodeImage(page: Page, path: string): Promise<Rgba> {
  const base64 = readFileSync(path).toString('base64');
  const { width, height, pixels } = await page.evaluate(
    async ([data, mime]) => {
      const blob = await (await fetch(`data:${mime};base64,${data}`)).blob();
      const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
      if (ctx === null) throw new Error('no 2d context');
      ctx.drawImage(bitmap, 0, 0);
      const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      let binary = '';
      const bytes = image.data;
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return { width: bitmap.width, height: bitmap.height, pixels: btoa(binary) };
    },
    [base64, mimeFor(path)] as const,
  );
  return { width, height, data: new Uint8ClampedArray(Buffer.from(pixels, 'base64')) };
}

/** Encodes `img` (resized to `width` × `height` when given) for `path`'s type; returns the bytes. */
export async function encodeImage(
  page: Page,
  img: Rgba,
  path: string,
  options: { width?: number; height?: number; quality?: number } = {},
): Promise<Buffer> {
  const out = await page.evaluate(
    async ([data, w, h, ow, oh, mime, quality]) => {
      const bytes = Uint8ClampedArray.from(atob(data), (c) => c.charCodeAt(0));
      const source = new OffscreenCanvas(w, h);
      const sctx = source.getContext('2d');
      if (sctx === null) throw new Error('no 2d context');
      sctx.putImageData(new ImageData(bytes, w, h), 0, 0);
      const target = new OffscreenCanvas(ow, oh);
      const tctx = target.getContext('2d');
      if (tctx === null) throw new Error('no 2d context');
      tctx.imageSmoothingEnabled = true;
      tctx.imageSmoothingQuality = 'high';
      tctx.drawImage(source, 0, 0, ow, oh);
      const blob = await target.convertToBlob({ type: mime, quality });
      const buffer = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < buffer.length; i += 0x8000) {
        binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
      }
      return btoa(binary);
    },
    [
      Buffer.from(img.data).toString('base64'),
      img.width,
      img.height,
      options.width ?? img.width,
      options.height ?? img.height,
      mimeFor(path),
      options.quality ?? 0.88,
    ] as const,
  );
  return Buffer.from(out, 'base64');
}
