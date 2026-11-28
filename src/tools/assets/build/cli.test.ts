import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultIo, main, USAGE, type CliIo } from './cli.ts';
import { writeFixture } from './fixture.ts';

async function run(args: string[], root = mkdtempSync(join(tmpdir(), 'build-cli-'))) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { root, log: (l) => out.push(l), error: (l) => err.push(l) };
  return { code: await main(args, io), out, err, root };
}

describe('assets:build CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('prints usage', async () => {
    expect((await run(['--help'])).out).toEqual([USAGE]);
  });

  it('builds the source models and summarises; a failure exits 1', async () => {
    const root = mkdtempSync(join(tmpdir(), 'build-cli-'));
    const path = join(root, 'assets/source/model/model-prop-a-01/model-prop-a-01.glb');
    mkdirSync(dirname(path), { recursive: true });
    await writeFixture(path);
    const ok = await run([], root);
    expect(ok.code).toBe(0);
    expect(ok.out.at(-1)).toMatch(/^assets:build: 1 built, 0 cached, 0 failed in \d+ ms$/);
    mkdirSync(join(root, 'assets/source/model/model-prop-b-01'), { recursive: true });
    await writeFixture(join(root, 'assets/source/model/model-prop-b-01/model-prop-b-01.glb'), {
      quads: 3000,
    });
    const failed = await run([], root);
    expect(failed.code).toBe(1);
    expect(failed.err[0]).toMatch(/^model-prop-b-01: 6000 triangles exceeds/);
  });

  it('builds a candidate, and reports errors and bad options', async () => {
    const root = mkdtempSync(join(tmpdir(), 'build-cli-'));
    const file = 'assets/_incoming/model-prop-a-01/v1.glb';
    mkdirSync(join(root, dirname(file)), { recursive: true });
    await writeFixture(join(root, file));
    expect((await run(['--candidate', file], root)).out).toHaveLength(2);
    expect((await run(['--candidate', 'nope/v1.glb'])).err[0]).toMatch(/^assets:build: nope: /);
    expect((await run(['--wat'])).code).toBe(1);
  });

  it('default io and the entry point', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    defaultIo.log('a');
    defaultIo.error('b');
    expect(log).toHaveBeenCalledWith('a');
    expect(error).toHaveBeenCalledWith('b');
    const argv = process.argv;
    process.argv = ['node', 'build-cli.ts', '--help'];
    try {
      await import('./build-cli.ts');
    } finally {
      process.argv = argv;
    }
    expect(process.exitCode).toBe(0);
  });
});
