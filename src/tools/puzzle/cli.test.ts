import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultIo, main, USAGE, type CliIo } from './cli';

describe('pnpm puzzle:validate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ioWith = (lines: string[]): CliIo => ({
    ...defaultIo,
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
  });

  it('prints its usage for --help and -h', () => {
    const lines: string[] = [];
    expect(main(['--help'], ioWith(lines))).toBe(0);
    expect(main(['-h'], ioWith(lines))).toBe(0);
    expect(lines).toEqual([USAGE, USAGE]);
  });

  it('validates the shipped puzzles without the headless runs for --abstract-only', () => {
    const lines: string[] = [];
    expect(main(['--abstract-only'], ioWith(lines))).toBe(0);
    expect(lines.join('\n')).toContain('abstract: goal reachable in 3 action(s)');
    expect(lines.join('\n')).not.toContain('concrete:');
  });

  it(
    'AC-4: runs each declared step list in the headless sim by default',
    { timeout: 120_000 },
    () => {
      const lines: string[] = [];
      expect(main(['brazier-hall'], ioWith(lines))).toBe(0);
      expect(lines.join('\n')).toMatch(/concrete: goal true after \d+ ticks/);
    },
  );

  it('reports an unknown puzzle on its error output and exits 2', () => {
    const lines: string[] = [];
    expect(main(['--abstract-only', 'no-such-puzzle'], ioWith(lines))).toBe(2);
    expect(lines[0]).toContain('no puzzle "no-such-puzzle"');
  });

  it('writes to the console, and reads the clock, by default', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    defaultIo.log('a');
    defaultIo.error('b');
    expect(log).toHaveBeenCalledWith('a');
    expect(error).toHaveBeenCalledWith('b');
    expect(defaultIo.now()).toBeGreaterThan(0);
  });
});
