import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGameContent } from '../src/content/game-content.ts';
import { contentTypes, type ContentType } from '../src/content/registry.ts';
import { main, unexercised } from './content-coverage.ts';

/** `type:id` of every game content entry. */
const everyEntry = (): string[] => {
  const content = loadGameContent();
  return (Object.keys(contentTypes) as ContentType[]).flatMap((type) =>
    content.all(type).map((entry) => `${type}:${entry.id}`),
  );
};

describe('unexercised', () => {
  it('lists entries missing from the exercised set, in order', () => {
    expect(unexercised(['a:1', 'a:2', 'b:1'], ['a:2'])).toEqual(['a:1', 'b:1']);
    expect(unexercised(['a:1'], ['a:1', 'z:9'])).toEqual([]);
  });
});

describe('content-coverage main', () => {
  const cwd = process.cwd();
  const argv = process.argv;
  let dir: string;
  const report = (...exercised: string[]) => {
    writeFileSync(join(dir, 'report.json'), JSON.stringify({ exercised }));
  };
  const run = () => main(['--content', 'data', '--report', 'report.json'], dir);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'content-coverage-'));
    cpSync(join(cwd, 'src/content/data'), join(dir, 'data'), { recursive: true });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(cwd);
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true });
  });

  it('AC-5: fails listing every content entry no passing test exercised', () => {
    report('testprop:crate');
    expect(run()).toBe(1);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/^::error title=Content coverage::testprop:plank has no passing test/),
    );
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('testprop:crate'));
  });

  it('passes when every entry is exercised', () => {
    const entries = everyEntry();
    report(...entries);
    expect(run()).toBe(0);
    expect(console.log).toHaveBeenCalledWith(
      `Every content entry (${String(entries.length)}) is exercised by a test.`,
    );
  });

  it('mw-e27.8 AC-3: warns, without failing, about a variant group with no default', () => {
    const entries = everyEntry();
    report(...entries);
    const file = join(dir, 'data/scene/variant-room.json');
    const room = JSON.parse(readFileSync(file, 'utf8')) as {
      spawns: { id: string; variant?: unknown }[];
    };
    const missing = room.spawns.find((spawn) => spawn.id === 'miller-missing');
    if (missing === undefined) throw new Error('no miller-missing');
    missing.variant = { group: 'miller', when: { fact: 'variants.miller.rescued' } };
    writeFileSync(file, JSON.stringify(room));
    expect(run()).toBe(0);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^::warning title=Content coverage::scene:variant-room variant group "miller" has no default variant/,
      ),
    );
  });

  it('needs the report from a test run (a flag with no value falls back to the default)', () => {
    expect(main(['--report'], dir)).toBe(2);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('No report at coverage/content-coverage.json'),
    );
    expect(run()).toBe(2);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/run the full pnpm test first/));
  });

  it('reports content that fails to load', () => {
    report();
    writeFileSync(join(dir, 'data/testprop/crate.json'), '{"id": "crate"}');
    expect(run()).toBe(1);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^::error title=Content coverage::data\/testprop\/crate\.json#\/name: /,
      ),
    );
  });

  it('rethrows unexpected errors', () => {
    report();
    mkdirSync(join(dir, 'data/testprop/folder.json'));
    expect(run).toThrow(/EISDIR/);
  });

  it('the CLI sets the process exit code from main, reading the default report path', async () => {
    process.chdir(dir);
    process.argv = ['node', 'content-coverage-cli.ts'];
    await import('./content-coverage-cli.ts');
    expect(process.exitCode).toBe(2);
  });
});
