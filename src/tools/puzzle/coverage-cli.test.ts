import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameContent, type GameContent } from '@content/index';
import { defaultIo, main, REPORT_PATH, USAGE, type CliIo } from './coverage-cli';

const content = loadGameContent();

/** An io over an in-memory file system; `content` can be swapped to break the gate. */
function memoryIo(files: Map<string, string>, lines: string[], game: GameContent = content): CliIo {
  return {
    ...defaultIo,
    log: (line) => lines.push(line),
    error: (line) => lines.push(`error: ${line}`),
    content: () => game,
    readFile: (path) => files.get(path),
    writeFile: (path, text) => {
      files.set(path, text);
    },
  };
}

/** The shipped content with every capability-free solution dropped: only classes with the spells pass. */
const classOnly: GameContent = {
  ...content,
  all: ((type: string) =>
    type === 'puzzle'
      ? content.all('puzzle').map((p) => ({
          ...p,
          solutions: p.solutions.filter((s) => s.capabilities.length > 0),
        }))
      : content.all(type as 'class')) as GameContent['all'],
};

describe('pnpm puzzle:coverage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints its usage for --help and -h', () => {
    const lines: string[] = [];
    expect(main(['--help'], memoryIo(new Map(), lines))).toBe(0);
    expect(main(['-h'], memoryIo(new Map(), lines))).toBe(0);
    expect(lines).toEqual([USAGE, USAGE]);
  });

  it('refuses --out without a file', () => {
    const lines: string[] = [];
    expect(main(['--out'], memoryIo(new Map(), lines))).toBe(2);
    expect(main(['--out', '--write'], memoryIo(new Map(), lines))).toBe(2);
    expect(main(['--base'], memoryIo(new Map(), lines))).toBe(2);
    expect(lines[0]).toContain('--out and --base need a file path');
  });

  it(
    'AC-1: writes a report listing every puzzle with yes, no or inconclusive per class, and --check agrees',
    { timeout: 120_000 },
    () => {
      const files = new Map<string, string>();
      const lines: string[] = [];
      expect(main(['--write', '--summary', '--out', 'r.md'], memoryIo(files, lines))).toBe(0);
      const report = files.get('r.md') ?? '';
      for (const puzzle of content.all('puzzle')) {
        expect(report).toContain(`## \`${puzzle.id}\``);
        const row = new RegExp(
          `\\| \`${puzzle.id}\` \\| (yes|no) \\| \\d+ \\| \\d+ \\| ((yes|no|inconclusive) \\| ){4}(yes|no|inconclusive) \\|`,
        );
        expect(report).toMatch(row);
      }
      expect(lines.join('\n')).toContain('### Puzzle coverage');
      expect(lines.join('\n')).toContain('Changed from the committed report:');
      expect(lines).toContain('puzzle:coverage: wrote r.md');
      const again: string[] = [];
      expect(main(['--check', '--summary', '--out', 'r.md'], memoryIo(files, again))).toBe(0);
      expect(again.join('\n')).toContain('No change from the committed report.');
      // The summary diffs against the base branch's report when given one (a missing one: all new).
      const newer: string[] = [];
      files.set('base.md', report.replace('| knight | yes (carry-flame)', '| knight | no'));
      main(['--summary', '--out', 'r.md', '--base', 'base.md'], memoryIo(files, newer));
      expect(newer.join('\n')).toContain('- `brazier-hall`: changed');
      const fresh: string[] = [];
      main(['--summary', '--out', 'r.md', '--base', 'none.md'], memoryIo(files, fresh));
      expect(fresh.join('\n')).toContain('- `brazier-hall`: new');
    },
  );

  it(
    'AC-2: exits 1 naming each mvp puzzle that fewer than 3 classes can solve, and flags a stale report',
    { timeout: 120_000 },
    () => {
      const lines: string[] = [];
      const files = new Map([['r.md', 'stale']]);
      expect(main(['--check', '--out', 'r.md'], memoryIo(files, lines, classOnly))).toBe(1);
      expect(lines).toContain(
        'error: puzzle scales-room: solvable by 1 of 4 classes at MVP capability levels, needs 3; missing: knight, archer, thief',
      );
      expect(lines).toContain(
        'error: puzzle frozen-channel: 1 distinct validated solution(s), needs 2',
      );
      expect(lines).toContain(
        'error: puzzle:coverage: r.md is out of date; run pnpm puzzle:coverage --write',
      );
      expect(files.get('r.md')).toBe('stale');
    },
  );

  it(
    'AC-1: the committed docs/design/puzzle-coverage.md is up to date (run pnpm puzzle:coverage --write if this fails)',
    { timeout: 120_000 },
    () => {
      const lines: string[] = [];
      expect(main(['--check'], { ...defaultIo, log: (l) => lines.push(l) })).toBe(0);
      expect(lines.at(-1)).toMatch(/gate passing/);
    },
  );

  it('reads and writes files, and the console, by default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'puzzle-coverage-'));
    try {
      const file = join(dir, 'nested', 'r.md');
      expect(defaultIo.readFile(file)).toBeUndefined();
      defaultIo.writeFile(file, 'text');
      expect(defaultIo.readFile(file)).toBe('text');
      expect(readFileSync(file, 'utf8')).toBe('text');
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      defaultIo.log('a');
      defaultIo.error('b');
      expect(log).toHaveBeenCalledWith('a');
      expect(error).toHaveBeenCalledWith('b');
      expect(REPORT_PATH).toBe('docs/design/puzzle-coverage.md');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
