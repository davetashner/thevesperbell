import { afterEach, describe, expect, it, vi } from 'vitest';

describe('world validator CLI entry point', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  // Starts Vite to load the CLI: a few seconds, more under a loaded coverage run.
  it(
    'loads the validator through Vite and sets the exit code from main',
    { timeout: 120_000 },
    async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      process.argv = ['node', 'world-validate-cli.ts', '--help'];
      await import('./world-validate-cli.ts');
      expect(process.exitCode).toBe(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('pnpm world:validate'));
    },
  );
});
