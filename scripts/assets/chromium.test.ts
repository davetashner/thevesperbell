import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const launch = vi.fn();
vi.mock('@playwright/test', () => ({ chromium: { launch } }));
// No browser install here, whatever the machine running the tests has.
vi.mock('node:fs', async (original) => ({ ...(await original<typeof import('node:fs')>()), existsSync: () => false }));
delete process.env['CHROMIUM_PATH'];

const { chromiumPath, decodeImage, DECODE_SOURCE, encodeImage, ENCODE_SOURCE, KNOWN_CHROMIUM, mimeFor, withPage } =
  await import('./chromium');

describe('asset pipeline Chromium bridge', () => {
  it('picks CHROMIUM_PATH, else the known cloud path when present, else Playwright’s own', () => {
    expect(chromiumPath({ CHROMIUM_PATH: '/x/chrome' }, () => true)).toBe('/x/chrome');
    expect(chromiumPath({}, (p) => p === KNOWN_CHROMIUM)).toBe(KNOWN_CHROMIUM);
    expect(chromiumPath({}, () => false)).toBeUndefined();
    expect(chromiumPath()).toBeUndefined();
  });

  it('withPage launches with software WebGL, runs on a fresh page and always closes the browser', async () => {
    const close = vi.fn();
    const page = { setContent: vi.fn() };
    launch.mockResolvedValue({ newPage: () => Promise.resolve(page), close });
    await expect(withPage(() => Promise.resolve(7), '/x/chrome')).resolves.toBe(7);
    expect(launch).toHaveBeenLastCalledWith(
      expect.objectContaining({ executablePath: '/x/chrome' }),
    );
    expect((launch.mock.lastCall?.[0] as { args: string[] }).args).toContain('--use-angle=swiftshader');
    await expect(withPage(() => Promise.reject(new Error('boom')), undefined)).rejects.toThrow('boom');
    // Left out, with no CHROMIUM_PATH and no known install, Playwright picks its own browser.
    expect(launch.mock.lastCall?.[0]).not.toHaveProperty('executablePath');
    expect(close).toHaveBeenCalledTimes(2);
    expect(page.setContent).toHaveBeenCalled();
  });

  it('knows the image types the pipeline writes', () => {
    expect(mimeFor('a/b.PNG')).toBe('image/png');
    expect(mimeFor('x.jpg')).toBe('image/jpeg');
    expect(mimeFor('x.jpeg')).toBe('image/jpeg');
    expect(mimeFor('x.webp')).toBe('image/webp');
    expect(() => mimeFor('x.gif')).toThrow('unsupported image type');
  });

  it('decodes and encodes through the page, passing the in-page code and its arguments', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chromium-'));
    const file = join(dir, 'in.png');
    writeFileSync(file, Buffer.from([1, 2, 3]));
    const seen: string[] = [];
    const page = {
      evaluate: <R>(expression: string): Promise<R> => {
        seen.push(expression);
        return Promise.resolve(
          expression.startsWith(`(${DECODE_SOURCE})`)
            ? { width: 1, height: 1, pixels: Buffer.from([9, 8, 7, 255]).toString('base64') }
            : Buffer.from('webp').toString('base64'),
        ) as Promise<R>;
      },
    };
    const img = await decodeImage(page, file);
    expect(img).toEqual({ width: 1, height: 1, data: new Uint8ClampedArray([9, 8, 7, 255]) });
    expect(seen[0]).toContain(Buffer.from([1, 2, 3]).toString('base64'));
    expect(seen[0]).toContain('image/png');
    const out = await encodeImage(page, img, join(dir, 'out.webp'));
    expect(out.toString()).toBe('webp');
    expect(seen[1]?.startsWith(`(${ENCODE_SOURCE})`)).toBe(true);
    expect(seen[1]).toContain(',1,1,1,1,"image/webp",0.88]');
    await encodeImage(page, img, join(dir, 'out.jpg'), { width: 4, height: 2, quality: 0.5 });
    expect(seen[2]).toContain(',1,1,4,2,"image/jpeg",0.5]');
  });
});
