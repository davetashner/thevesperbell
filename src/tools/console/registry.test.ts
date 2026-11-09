import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CommandRegistry, ConsoleError } from './registry';

function registry() {
  const host = { said: [] as string[] };
  const r = new CommandRegistry(host);
  r.registerCommand({
    name: 'say',
    summary: 'say words',
    usage: '<word> [times]',
    args: z.tuple([z.string(), z.coerce.number<string>().int().optional()]),
    run: ([word, times = 1], h) => {
      h.said.push(word.repeat(times));
      return undefined;
    },
  });
  r.registerCommand({
    name: 'lines',
    summary: 'two lines',
    usage: '',
    args: z.tuple([]),
    run: () => ['one', 'two'],
  });
  r.registerCommand({
    name: 'boom',
    summary: 'fails',
    usage: '[kind]',
    args: z.tuple([z.string().optional()]),
    run: ([kind]) => {
      if (kind === 'nice') throw new ConsoleError(['a readable failure']);
      throw new Error('bug');
    },
  });
  return { r, host };
}

describe('CommandRegistry', () => {
  it('runs a command with validated, converted arguments (names are case-insensitive)', () => {
    const { r, host } = registry();
    expect(r.execute('SAY ab 2')).toEqual({ ok: true, lines: [] });
    expect(host.said).toEqual(['abab']);
    expect(r.execute('lines')).toEqual({ ok: true, lines: ['one', 'two'] });
    expect(r.execute('   ')).toEqual({ ok: true, lines: [] });
  });

  it('reports invalid arguments with the usage', () => {
    const { r } = registry();
    expect(r.execute('say ab x')).toEqual({
      ok: false,
      lines: [
        expect.stringMatching(/^say: invalid arguments: arg 2: /),
        'usage: say <word> [times]',
      ],
    });
    const tooMany = r.execute('lines extra');
    expect(tooMany.lines[0]).toMatch(/^lines: invalid arguments: [^a]/);
    expect(tooMany.lines[1]).toBe('usage: lines');
  });

  it('suggests the closest commands for an unknown one', () => {
    const { r } = registry();
    expect(r.execute('sya hi').lines).toEqual([
      'unknown command "sya"; did you mean: say, boom, lines?',
      'type help for the list of commands',
    ]);
  });

  it('prints ConsoleErrors as they are and other errors as a failure', () => {
    const { r } = registry();
    expect(r.execute('boom nice')).toEqual({ ok: false, lines: ['a readable failure'] });
    expect(r.execute('boom')).toEqual({ ok: false, lines: ['boom failed: Error: bug'] });
  });

  it('rejects malformed and duplicate names', () => {
    const { r } = registry();
    const spec = { summary: '', usage: '', args: z.tuple([]), run: () => undefined };
    expect(() => {
      r.registerCommand({ ...spec, name: 'Bad Name' });
    }).toThrow(/lower-case/);
    expect(() => {
      r.registerCommand({ ...spec, name: 'say' });
    }).toThrow(/already exists/);
    // A dot groups related commands (mw-e02.3: ctl.get, ctl.set); empty or dangling groups do not.
    r.registerCommand({ ...spec, name: 'ctl.get' });
    expect(r.get('ctl.get')).toBeDefined();
    for (const name of ['ctl.', '.get', 'ctl..get', 'ctl.Get']) {
      expect(() => {
        r.registerCommand({ ...spec, name });
      }).toThrow(/lower-case/);
    }
  });

  it('completes command names, and leaves lines alone when nothing matches', () => {
    const { r } = registry();
    expect(r.complete('sa')).toEqual({ line: 'say ', options: [] });
    expect(r.complete('')).toEqual({ line: '', options: ['boom', 'lines', 'say'] });
    expect(r.complete('zz')).toEqual({ line: 'zz', options: [] });
    expect(r.complete('say x')).toEqual({ line: 'say x', options: [] });
    expect(r.complete('nope x')).toEqual({ line: 'nope x', options: [] });
  });

  it('lists commands by name', () => {
    const { r } = registry();
    expect(r.list().map((c) => c.name)).toEqual(['boom', 'lines', 'say']);
    expect(r.get('say')?.summary).toBe('say words');
  });

  it('hands back a command that is still working as `later` (mw-e27.6)', async () => {
    const r = new CommandRegistry({});
    const spec = { summary: '', usage: '', args: z.tuple([]) };
    r.registerCommand({ ...spec, name: 'slow', run: () => Promise.resolve(['a', 'b']) });
    r.registerCommand({
      ...spec,
      name: 'slow-nice',
      run: () => Promise.reject(new ConsoleError(['no slot'])),
    });
    r.registerCommand({ ...spec, name: 'slow-bug', run: () => Promise.reject(new Error('bug')) });
    const slow = r.execute('slow');
    expect(slow).toMatchObject({ ok: true, lines: [] });
    await expect(slow.later).resolves.toEqual({ ok: true, lines: ['a', 'b'] });
    await expect(r.execute('slow-nice').later).resolves.toEqual({ ok: false, lines: ['no slot'] });
    await expect(r.execute('slow-bug').later).resolves.toEqual({
      ok: false,
      lines: ['slow-bug failed: Error: bug'],
    });
  });
});
