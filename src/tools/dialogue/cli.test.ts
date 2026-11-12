import { describe, expect, it, vi } from 'vitest';
import { ContentLoadError, loadGameContent, type ContentSource } from '@content/index';
import { defaultIo, main, USAGE, type CliIo } from './cli';

const FILE = 'src/content/data/dialogue/talk.json';
const dialogue = (text: string, extra: Record<string, unknown> = {}): ContentSource => ({
  path: FILE,
  text: JSON.stringify({
    id: 'talk',
    speakers: [{ id: 'host', name: 'The Host' }],
    entries: [{ id: 'main', node: 'hello' }],
    nodes: [{ id: 'hello', kind: 'line', speaker: 'host', text, end: true }],
    ...extra,
  }),
});

const run = (args: string[], sources: ContentSource[], content = loadGameContent) => {
  const lines: string[] = [];
  const io: CliIo = { log: (l) => lines.push(l), sources: () => sources, content };
  return { code: main(args, io), lines };
};

describe('pnpm dialogue:validate', () => {
  it('prints its usage for --help and -h', () => {
    expect(run(['--help'], []).lines).toEqual([USAGE]);
    expect(run(['-h'], []).code).toBe(0);
  });

  it('AC-6: exits 0 with a summary when every dialogue is valid, or there are none', () => {
    const none = run([], []);
    expect(none).toEqual({ code: 0, lines: ['Dialogue: 0 file(s), 0 error(s), 0 warning(s).'] });
    expect(run([], [dialogue('Hello.')]).lines).toEqual([
      'Dialogue: 1 file(s), 0 error(s), 0 warning(s).',
    ]);
  });

  it('AC-5: warnings print as annotations and still exit 0', () => {
    const { code, lines } = run(['--max-length', '5'], [dialogue('Hello there.')]);
    expect(code).toBe(0);
    expect(lines[0]).toMatch(
      /^::warning file=src\/content\/data\/dialogue\/talk\.json,line=\d+,title=Dialogue::node "hello": line "hello" is 12 characters, over the limit of 5$/,
    );
    expect(lines.at(-1)).toBe('Dialogue: 1 file(s), 0 error(s), 1 warning(s).');
  });

  it('AC-1: errors print with node id and exit 1', () => {
    const orphan = dialogue('Hello.', {
      nodes: [
        { id: 'hello', kind: 'line', speaker: 'host', text: 'Hi.', end: true },
        { id: 'orphan', kind: 'line', speaker: 'host', text: 'Hm.', end: true },
      ],
    });
    const { code, lines } = run([], [orphan]);
    expect(code).toBe(1);
    expect(lines[0]).toMatch(
      /^::error file=src\/content\/data\/dialogue\/talk\.json,line=\d+,title=Dialogue::node "orphan": node "orphan" is not reachable from any entry$/,
    );
  });

  it('prints file-level problems without a node prefix', () => {
    const { code, lines } = run([], [{ path: FILE, text: '{' }]);
    expect(code).toBe(1);
    expect(lines[0]).toMatch(/^::error file=.*,title=Dialogue::invalid JSON/);
  });

  it('rejects a bad --max-length', () => {
    for (const args of [['--max-length'], ['--max-length', 'x'], ['--max-length', '0']]) {
      const { code, lines } = run(args, []);
      expect(code).toBe(1);
      expect(lines).toEqual(['::error title=Dialogue::--max-length needs a positive whole number']);
    }
  });

  it('reports content that fails to load, and rethrows anything else', () => {
    const failing = () => {
      throw new ContentLoadError([{ file: 'a.json', pointer: '/x', message: 'bad' }]);
    };
    expect(run([], [], failing)).toEqual({
      code: 1,
      lines: ['::error file=a.json,title=Content::/x: bad'],
    });
    expect(() =>
      run([], [], () => {
        throw new Error('disk');
      }),
    ).toThrow('disk');
  });

  it('the default io logs to the console and reads the game content', () => {
    expect(defaultIo.sources().length).toBeGreaterThan(0);
    expect(defaultIo.content().all('persuasion')).toHaveLength(1);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    defaultIo.log('x');
    expect(log).toHaveBeenCalledWith('x');
    log.mockRestore();
  });
});
