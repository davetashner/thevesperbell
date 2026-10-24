import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveRegistry } from '@game/save/format';
import { replayScenarios } from '@sim/index';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defaultIo, main, USAGE, type CliIo } from './cli';

let root: string;
let logs: string[];
let errors: string[];
let schema: z.ZodType;

function io(): CliIo {
  return {
    cwd: root,
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    registry: () =>
      new SaveRegistry().register({
        id: 'inventory',
        version: 1,
        schema,
        serialize: () => ({ items: [] }),
        deserialize: () => undefined,
      }),
    worlds: [{ name: 'tiny', description: 'tiny', scenario: 'core', seed: 2, ticks: 3 }],
    scenarios: replayScenarios,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'save-cli-'));
  logs = [];
  errors = [];
  schema = z.strictObject({ items: z.array(z.string()) });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pnpm save:fixture / save:check', () => {
  it('prints usage for --help, and exits 2 for anything else', () => {
    expect(main(['--help'], io())).toBe(0);
    expect(main(['-h'], io())).toBe(0);
    expect(logs).toEqual([USAGE, USAGE]);
    expect(main([], io())).toBe(2);
    expect(main(['check', 'extra'], io())).toBe(2);
    expect(main(['generate', 'extra'], io())).toBe(2);
    expect(errors).toEqual([USAGE, USAGE, USAGE]);
  });

  it('generate writes revision 1 and checks it; a second run writes nothing', () => {
    expect(main(['generate'], io())).toBe(0);
    expect(logs).toEqual([
      'wrote tests/save-fixtures/1/tiny.json',
      'revision 1 recorded in tests/save-fixtures/save-schema.lock.json; commit both',
      'save schema lock OK; 1 fixtures load under the current build',
    ]);
    expect(main(['generate'], io())).toBe(0);
    expect(logs.at(-1)).toBe('save fixtures are up to date (revision 1); nothing written');
    expect(errors).toEqual([]);
  });

  it('AC-2: generate refuses an unversioned schema change and check fails with the fix', () => {
    main(['generate'], io());
    schema = z.strictObject({ items: z.array(z.string()), gold: z.number() });
    expect(main(['generate'], io())).toBe(1);
    expect(errors.at(-1)).toBe('No fixtures written.');
    errors = [];
    expect(main(['check'], io())).toBe(1);
    expect(errors[0]).toContain('Bump the section');
  });

  it('AC-4: check reports a fixture that fails to load, naming its path', () => {
    main(['generate'], io());
    writeFileSync(join(root, 'tests/save-fixtures/1/broken.json'), '{');
    expect(main(['check'], io())).toBe(1);
    expect(errors).toEqual([expect.stringMatching(/^tests\/save-fixtures\/1\/broken\.json: /)]);
  });

  it('defaultIo writes to the console and uses the game registry', () => {
    const real = defaultIo('/repo');
    expect(real.cwd).toBe('/repo');
    expect(real.registry().sections.map((s) => s.id)).toEqual([
      'world',
      'inventory',
      'creatures',
      'world-facts',
      'level-deltas',
      'merchants',
      'game-clock',
    ]);
    expect(real.worlds.length).toBeGreaterThan(0);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    real.log('out');
    real.error('err');
    expect(log).toHaveBeenCalledWith('out');
    expect(error).toHaveBeenCalledWith('err');
    vi.restoreAllMocks();
  });
});
