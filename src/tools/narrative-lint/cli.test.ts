import { describe, expect, it } from 'vitest';
import { ContentLoadError, loadGameContent, type ContentSource } from '@content/index';
import { contentEnv, defaultIo, main, USAGE, type CliIo } from './cli';

const FILE = 'src/content/data/dialogue/talk.json';
const dialogue = (text: string): ContentSource => ({
  path: FILE,
  text: JSON.stringify({ id: 'talk', nodes: [{ id: 'hello', kind: 'line', text }] }, null, 2),
});

const run = (args: string[], sources: ContentSource[], content = loadGameContent) => {
  const lines: string[] = [];
  const io: CliIo = { log: (l) => lines.push(l), sources: () => sources, content };
  return { code: main(args, io), lines };
};

describe('pnpm narrative:lint', () => {
  it('prints its usage for --help and -h', () => {
    expect(run(['--help'], []).lines).toEqual([USAGE]);
    expect(run(['-h'], []).code).toBe(0);
  });

  it('AC-5: clean content exits 0 with a summary', () => {
    expect(run([], [dialogue('Hello.')])).toEqual({
      code: 0,
      lines: ['Narrative: 1 file(s), 0 error(s), 0 warning(s).'],
    });
  });

  it('AC-1: errors print as annotations with file and line and exit 1', () => {
    const { code, lines } = run([], [dialogue('Ask Mirella.')]);
    expect(code).toBe(1);
    expect(lines[0]).toBe(
      `::error file=${FILE},line=7,title=Narrative (name)::"Mirella" looks like a misspelling of "Mirela" (canon glossary)`,
    );
    expect(lines.at(-1)).toBe('Narrative: 1 file(s), 1 error(s), 0 warning(s).');
  });

  it('AC-4: warnings print and still exit 0', () => {
    const { code, lines } = run([], [dialogue('Okay then.')]);
    expect(code).toBe(0);
    expect(lines[0]).toMatch(
      /^::warning file=.*,line=7,title=Narrative \(tone\)::modern slang phrase "Okay"/,
    );
  });

  it('reports content that fails to load as errors, and rethrows anything else', () => {
    const broken = (): never => {
      throw new ContentLoadError([{ file: 'a.json', pointer: '/x', message: 'bad' }]);
    };
    expect(run([], [], broken)).toEqual({
      code: 1,
      lines: ['::error file=a.json,title=Content::/x: bad'],
    });
    const crash = (): never => {
      throw new Error('boom');
    };
    expect(() => run([], [], crash)).toThrow('boom');
  });

  it('the default io logs to the console and reads the real content', () => {
    expect(defaultIo.sources().length).toBeGreaterThan(0);
    expect(defaultIo.content().has('creature', 'npc-hale')).toBe(true);
    defaultIo.log('');
  });

  it('contentEnv resolves ids against the loaded content', () => {
    const env = contentEnv(loadGameContent());
    expect(env.npc('npc-hale')).toBe(true);
    expect(env.npc('npc-ghost')).toBe(false);
    expect(env.fact('tansy.saved')).toBe(true);
    expect(env.fact('ghost.fact')).toBe(false);
    expect(env.item('ghost')).toBe(false);
    expect(env.quest('ghost')).toBe(false);
    expect(env.scene('briar-glen-green')).toBe(true);
  });
});
