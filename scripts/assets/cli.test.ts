// The asset CLIs with the Chromium bridge stood in for: argument handling, which pixel steps each
// mode runs, what they write, and the entry-point exit codes. The turntable's file server runs for
// real; only the browser page is a stand-in.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blank, type Rgba } from './pixels';

/** A size×size alpha net: opaque lines every `period` px from period/2 (so periodCrop finds whole repeats). */
function net(size = 40, period = 10): Rgba {
  const img = blank(size, size);
  const half = period / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      img.data.set([180, 140, 90, x % period === half || y % period === half ? 255 : 0], (y * size + x) * 4);
    }
  }
  return img;
}

const decoded: { image: Rgba } = { image: net() };
const encoded: { args: unknown[][] } = { args: [] };
vi.mock('./chromium.ts', () => ({
  withPage: <T>(fn: (page: unknown) => Promise<T>) => fn({}),
  decodeImage: () => Promise.resolve(decoded.image),
  encodeImage: (_page: unknown, img: Rgba, path: string, options?: unknown) => {
    encoded.args.push([img.width, img.height, path, options]);
    return Promise.resolve(Buffer.from('bytes'));
  },
}));

const texture = await import('./texture-cli');
const cropCli = await import('./crop-cli');
const turntable = await import('./turntable-cli');

const dir = mkdtempSync(join(tmpdir(), 'asset-cli-'));
afterEach(() => {
  encoded.args = [];
  vi.restoreAllMocks();
});

describe('texture-cli', () => {
  it('needs a source and a target', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(texture.main(['only-one.png'])).resolves.toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('usage: texture-cli.ts'));
  });

  it('makes a seamless tile both ways at the runtime size, with a 2×2 seam preview', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const out = join(dir, 't.webp');
    const preview = join(dir, 't.jpg');
    await expect(texture.main(['in.png', out, '--size', '512x512', '--preview', preview])).resolves.toBe(0);
    expect(readFileSync(out, 'utf8')).toBe('bytes');
    expect(encoded.args[0]).toEqual([36, 36, out, { width: 512, height: 512 }]);
    expect(encoded.args[1]).toEqual([72, 72, preview, { quality: 0.85 }]);
  });

  it('a trim blends left to right only and previews 2×1; an alpha cut-out is cropped to whole repeats', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await texture.main(['in.png', join(dir, 'trim.webp'), '--mode', 'x', '--preview', join(dir, 'trim.jpg')]);
    expect(encoded.args[0]?.slice(0, 2)).toEqual([36, 40]);
    expect(encoded.args[1]?.slice(0, 2)).toEqual([72, 40]);
    // The CLI's line finder wants lines at least 20 px apart: lines at 15, 45, 75, 105 → 30–90.
    decoded.image = net(120, 30);
    await texture.main(['in.png', join(dir, 'net.webp'), '--mode', 'alpha']);
    decoded.image = net();
    expect(encoded.args[2]?.slice(0, 2)).toEqual([59, 59]);
    expect(encoded.args).toHaveLength(3);
  });

  it('rejects an unknown mode', () => {
    expect(() => texture.tileFor(net(), 'zigzag', 0.1)).toThrow('unknown --mode zigzag');
  });
});

describe('crop-cli', () => {
  it('needs a source, a target and a four-number box', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(cropCli.main(['a.png', 'b.png'])).resolves.toBe(2);
    await expect(cropCli.main(['a.png', 'b.png', '--box', '1,2,3'])).resolves.toBe(2);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('crops the box, cleans it and pads it square on the sheet’s own colour', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const out = join(dir, 'fig.png');
    await expect(cropCli.main(['sheet.png', out, '--box', '0,0,20,10', '--margin', '5'])).resolves.toBe(0);
    expect(encoded.args[0]?.slice(0, 2)).toEqual([30, 30]);
    const kept = cropCli.cutFigure(net(), [0, 0, 20, 10], true, 2);
    expect([kept.width, kept.height]).toEqual([24, 24]);
    expect(Array.from(kept.data.subarray(0, 3))).toEqual([180, 140, 90]);
  });
});

describe('turntable-cli', () => {
  it('needs an output folder and at least one model', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(turntable.main([join(dir, 'tt')])).resolves.toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('usage: turntable-cli.ts'));
  });

  it('serves the page, three.js and the models, renders each and writes a picture and stats', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const model = join(dir, 'model-prop-x-01.glb');
    writeFileSync(model, Buffer.from('glTF'));
    const out = join(dir, 'tt');
    const fetched: Record<string, [number, string | null]> = {};
    let base = '';
    const page = {
      setViewportSize: vi.fn(() => Promise.resolve()),
      goto: async (url: string) => {
        base = url;
        for (const path of ['', 'three/build/three.module.js', 'three/package.json', 'model/0?v=1', 'model/7', 'nope']) {
          const res = await fetch(`${url}${path}`);
          fetched[path] = [res.status, res.headers.get('content-type')];
          await res.arrayBuffer();
        }
      },
      waitForFunction: vi.fn(() => Promise.resolve()),
      evaluate: <R>(expression: string): Promise<R> =>
        Promise.resolve({ expression, tris: 12 } as R),
      screenshot: ({ path }: { path: string }) => {
        writeFileSync(path, 'png');
        return Promise.resolve();
      },
    };
    const open = <T>(fn: (p: typeof page) => Promise<T>): Promise<T> => fn(page);
    await expect(turntable.main([out, model], open)).resolves.toBe(0);
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(fetched['']).toEqual([200, 'text/html']);
    expect(fetched['three/build/three.module.js']).toEqual([200, 'text/javascript']);
    expect(fetched['three/package.json']).toEqual([200, 'application/octet-stream']);
    expect(fetched['model/0?v=1']).toEqual([200, 'model/gltf-binary']);
    expect(fetched['model/7']?.[0]).toBe(404);
    expect(fetched['nope']?.[0]).toBe(404);
    expect(existsSync(join(out, 'model-prop-x-01.png'))).toBe(true);
    expect(JSON.parse(readFileSync(join(out, 'stats.json'), 'utf8'))).toEqual({
      'model-prop-x-01': { expression: "window.render('/model/0')", tris: 12 },
    });
  });
});

describe('entry points', () => {
  it('each CLI sets the exit code from main when run as a script', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scripts = {
      'texture-cli': () => import('./texture-cli'),
      'crop-cli': () => import('./crop-cli'),
      'turntable-cli': () => import('./turntable-cli'),
    };
    for (const [name, load] of Object.entries(scripts)) {
      vi.resetModules();
      process.argv = ['node', `scripts/assets/${name}.ts`];
      process.exitCode = 0;
      await load();
      expect(process.exitCode, name).toBe(2);
    }
    process.exitCode = 0;
  });
});
