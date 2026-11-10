import { afterEach, describe, expect, it, vi } from 'vitest';

describe('size budget CLI entry point', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('sets the exit code from main and logs through console', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.argv = [
      'node',
      'size-budget-cli.ts',
      '--dist',
      '/nonexistent',
      '--chunks',
      '/nonexistent.json',
    ];
    await import('./size-budget-cli.ts');
    expect(process.exitCode).toBe(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Need a production build'));
  });
});
