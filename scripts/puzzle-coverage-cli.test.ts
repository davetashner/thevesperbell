import { afterEach, describe, expect, it, vi } from 'vitest';

describe('puzzle coverage CLI entry point', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  // Starts Vite to load the CLI and Rapier's wasm: a few seconds, more under a loaded coverage run.
  it(
    'loads the audit through Vite and sets the exit code from main',
    { timeout: 60_000 },
    async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      process.argv = ['node', 'puzzle-coverage-cli.ts', '--help'];
      await import('./puzzle-coverage-cli.ts');
      expect(process.exitCode).toBe(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('pnpm puzzle:coverage'));
    },
  );
});
