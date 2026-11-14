// mw-e39.40: the epilogue.preview console command.
import { describe, expect, it, vi } from 'vitest';
import type { ConsoleHost } from '../console/builtins';
import { CommandRegistry } from '../console/registry';
import { registerEpilogueCommands } from './commands';

function setup() {
  const preview = vi.fn<(ending: string) => void>();
  const registry = new CommandRegistry<ConsoleHost>({} as unknown as ConsoleHost);
  registerEpilogueCommands(registry, { preview });
  return { registry, preview };
}

describe('epilogue.preview (mw-e39.40)', () => {
  it('AC-5: queues the chosen headline ending', () => {
    const { registry, preview } = setup();
    const result = registry.execute('epilogue.preview last-warden');
    expect(result).toMatchObject({
      ok: true,
      lines: ['the last-warden epilogue plays when the console closes'],
    });
    expect(preview).toHaveBeenCalledExactlyOnceWith('last-warden');
  });

  it('AC-5: refuses an unknown ending and a missing one', () => {
    const { registry, preview } = setup();
    expect(registry.execute('epilogue.preview happy-ever-after').ok).toBe(false);
    expect(registry.execute('epilogue.preview').ok).toBe(false);
    expect(preview).not.toHaveBeenCalled();
  });

  it('AC-5: Tab completes the ending names', () => {
    const { registry } = setup();
    expect(registry.complete('epilogue.preview l').options).toEqual([
      'last-warden',
      'long-vespers',
    ]);
    // Only the first argument completes: there is nothing to offer after the ending.
    expect(registry.complete('epilogue.preview last-warden ').options).toEqual([]);
  });
});
