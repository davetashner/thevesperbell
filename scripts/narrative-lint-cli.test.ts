import { afterEach, describe, expect, it, vi } from 'vitest';

describe('narrative lint CLI entry point', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  // Starts Vite to load the CLI: a few seconds, more under a loaded coverage run.
  it(
    'loads the lint through Vite and sets the exit code from main',
    { timeout: 120_000 },
    async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      process.argv = ['node', 'narrative-lint-cli.ts', '--help'];
      await import('./narrative-lint-cli.ts');
      expect(process.exitCode).toBe(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('pnpm narrative:lint'));
    },
  );
});
