import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assignShards,
  averageDurations,
  durationsFromReport,
  fileIo,
  listShardSpecs,
  main,
  type ShardIo,
  SHARD_EXCLUDED,
  weightOf,
} from './e2e-shards.ts';

const total = (shard: string[], durations: Record<string, number>): number =>
  shard.reduce((sum, spec) => sum + (durations[spec] ?? 0), 0);

describe('mw-e41.1 e2e shard planning', () => {
  it('AC-2: shards are within 20% of the mean when durations are known', () => {
    const durations: Record<string, number> = {
      'a.spec.ts': 300,
      'b.spec.ts': 280,
      'c.spec.ts': 150,
      'd.spec.ts': 140,
      'e.spec.ts': 120,
      'f.spec.ts': 100,
      'g.spec.ts': 60,
      'h.spec.ts': 50,
    };
    const shards = assignShards(Object.keys(durations), durations, 3);
    const totals = shards.map((shard) => total(shard, durations));
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    for (const t of totals) expect(Math.abs(t - mean) / mean).toBeLessThanOrEqual(0.2);
  });

  it('puts every spec in exactly one shard', () => {
    const specs = ['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'd.spec.ts', 'e.spec.ts'];
    const shards = assignShards(specs, { 'a.spec.ts': 9 }, 4);
    expect(shards.flat().sort()).toEqual(specs);
  });

  it('is deterministic and keeps each shard sorted', () => {
    const specs = ['z.spec.ts', 'y.spec.ts', 'x.spec.ts', 'w.spec.ts'];
    const first = assignShards(specs, {}, 2);
    expect(assignShards([...specs].reverse(), {}, 2)).toEqual(first);
    for (const shard of first) expect(shard).toEqual([...shard].sort());
  });

  it('gives specs with no recorded duration the median weight', () => {
    const durations = { 'a.spec.ts': 10, 'b.spec.ts': 30, 'c.spec.ts': 50 };
    expect(weightOf('new.spec.ts', durations, 30)).toBe(30);
    expect(weightOf('a.spec.ts', durations, 30)).toBe(10);
    expect(weightOf('zero.spec.ts', { 'zero.spec.ts': 0 }, 7)).toBe(7);
    // With an even number of known durations the median is the mean of the middle two.
    const shards = assignShards(
      ['a.spec.ts', 'b.spec.ts', 'new.spec.ts'],
      { 'a.spec.ts': 10, 'b.spec.ts': 30 },
      2,
    );
    expect(shards.flat()).toContain('new.spec.ts');
  });

  it('falls back to weight 1 when nothing is known', () => {
    expect(assignShards(['a.spec.ts', 'b.spec.ts'], {}, 2)).toEqual([['a.spec.ts'], ['b.spec.ts']]);
  });

  it('leaves surplus shards empty rather than failing', () => {
    expect(assignShards(['a.spec.ts'], {}, 3)).toEqual([['a.spec.ts'], [], []]);
  });

  it('rejects a bad shard count', () => {
    expect(() => assignShards(['a.spec.ts'], {}, 0)).toThrow(/positive integer/);
    expect(() => assignShards(['a.spec.ts'], {}, 1.5)).toThrow(/positive integer/);
  });

  it('lists spec files except the playthrough', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shards-'));
    for (const name of ['b.spec.ts', 'a.spec.ts', 'helper.ts', ...SHARD_EXCLUDED])
      writeFileSync(join(dir, name), '');
    expect(listShardSpecs(dir)).toEqual(['a.spec.ts', 'b.spec.ts']);
  });

  it('sums the final attempt of each chromium test per spec file from a Playwright JSON report', () => {
    const report = {
      suites: [
        {
          file: 'audio.spec.ts',
          specs: [
            {
              file: 'audio.spec.ts',
              tests: [
                { projectName: 'chromium', results: [{ duration: 90_000 }, { duration: 1500 }] },
                { projectName: 'chromium', results: [{ duration: 500 }] },
                { projectName: 'firefox', results: [{ duration: 9000 }] },
              ],
            },
          ],
          suites: [
            {
              specs: [
                { file: 'e2e/nested.spec.ts', tests: [{ results: [{}, { duration: 2250 }] }] },
              ],
            },
          ],
        },
        { specs: [{ tests: [{ results: [{ duration: 1 }] }] }] },
      ],
    };
    expect(durationsFromReport(report)).toEqual({ 'audio.spec.ts': 2, 'nested.spec.ts': 2.3 });
  });

  it('AC-2: averages a spec across the reports that contain it', () => {
    expect(averageDurations([{ 'a.spec.ts': 10, 'b.spec.ts': 3 }, { 'a.spec.ts': 20 }])).toEqual({
      'a.spec.ts': 15,
      'b.spec.ts': 3,
    });
  });

  it('tolerates a report with no suites', () => {
    expect(durationsFromReport({})).toEqual({});
  });

  it('reads a report whose suites, specs, tests or results are missing, and falls back to the suite file', () => {
    const report = {
      suites: [
        {},
        { file: 'suite-file.spec.ts', specs: [{ tests: [{ results: [{ duration: 4000 }] }] }] },
        {
          specs: [
            { file: 'no-tests.spec.ts' },
            { file: 'no-results.spec.ts', tests: [{}] },
            { file: 'no-duration.spec.ts', tests: [{ results: [{}] }] },
          ],
        },
      ],
    };
    expect(durationsFromReport(report)).toEqual({
      'no-duration.spec.ts': 0,
      'suite-file.spec.ts': 4,
    });
  });
});

describe('mw-e41.1 e2e shard CLI', () => {
  const fakeIo = (files: Record<string, string>): ShardIo & { out: string[]; err: string[] } => {
    const out: string[] = [];
    const err: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), 'shards-cli-'));
    for (const name of ['a.spec.ts', 'b.spec.ts', 'c.spec.ts']) writeFileSync(join(dir, name), '');
    return {
      e2eDir: dir,
      shardsFile: 'shards.json',
      readText: (path) => files[path] ?? '',
      writeText: (path, text) => {
        files[path] = text;
      },
      log: (line) => out.push(line),
      error: (line) => err.push(line),
      out,
      err,
    };
  };

  it('prints one shard of spec paths from the stored durations', () => {
    const io = fakeIo({
      'shards.json': JSON.stringify({
        durations: { 'a.spec.ts': 100, 'b.spec.ts': 10, 'c.spec.ts': 10 },
      }),
    });
    expect(main(['files', '1', '2'], io)).toBe(0);
    expect(main(['files', '2', '2'], io)).toBe(0);
    expect(io.out).toEqual([
      `${io.e2eDir}/a.spec.ts`,
      `${io.e2eDir}/b.spec.ts ${io.e2eDir}/c.spec.ts`,
    ]);
  });

  it('prints an empty line for a shard with no specs', () => {
    const io = fakeIo({ 'shards.json': JSON.stringify({ durations: {} }) });
    expect(main(['files', '4', '4'], io)).toBe(0);
    expect(io.out).toEqual(['']);
  });

  it('rejects a shard outside 1..count', () => {
    const io = fakeIo({});
    expect(main(['files', '0', '4'], io)).toBe(2);
    expect(main(['files', '5', '4'], io)).toBe(2);
    expect(main(['files', 'x', '4'], io)).toBe(2);
    expect(main(['files', '1', '2.5'], io)).toBe(2);
    expect(io.err).toHaveLength(4);
  });

  it('regenerates shards.json from a Playwright report', () => {
    const files: Record<string, string> = {
      'report.json': JSON.stringify({
        suites: [{ specs: [{ file: 'a.spec.ts', tests: [{ results: [{ duration: 12_340 }] }] }] }],
      }),
    };
    const io = fakeIo(files);
    expect(main(['regenerate', 'report.json'], io)).toBe(0);
    expect(JSON.parse(files['shards.json'] ?? '{}')).toMatchObject({
      durations: { 'a.spec.ts': 12.3 },
    });
    expect(files['shards.json']).toMatch(/\n$/);
    expect(io.out).toEqual(['Wrote shards.json (1 specs).']);
  });

  it('prints usage for a missing report path or an unknown command', () => {
    const io = fakeIo({});
    expect(main(['regenerate'], io)).toBe(2);
    expect(main(['nope'], io)).toBe(2);
    expect(main([], io)).toBe(2);
    expect(io.err).toHaveLength(3);
  });

  describe('real file system and the CLI entry point', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      process.exitCode = undefined;
    });

    it('lists real specs, writes a real file, and the entry point sets the exit code', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(main(['files', '1', '1'])).toBe(0);
      expect(log).toHaveBeenLastCalledWith(expect.stringContaining('e2e/smoke.spec.ts'));
      expect(log).toHaveBeenLastCalledWith(expect.not.stringContaining('slice-playthrough'));

      const dir = mkdtempSync(join(tmpdir(), 'shards-real-'));
      const report = join(dir, 'report.json');
      writeFileSync(report, '{}');
      expect(main(['regenerate', report], { ...fileIo, shardsFile: join(dir, 'out.json') })).toBe(
        0,
      );
      expect(JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'))).toMatchObject({
        durations: {},
      });

      process.argv = ['node', 'e2e-shards-cli.ts'];
      await import('./e2e-shards-cli.ts');
      expect(process.exitCode).toBe(2);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('usage:'));
    });
  });
});
