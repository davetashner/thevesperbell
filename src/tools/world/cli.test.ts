import { describe, expect, it } from 'vitest';
import { loadGameContent, type GameContent } from '@content/index';
import { defaultIo, main, USAGE, type CliIo } from './cli';

const run = (args: string[], content: () => GameContent = loadGameContent) => {
  const lines: string[] = [];
  const io: CliIo = { log: (l) => lines.push(l), content };
  return { code: main(args, io), lines };
};

describe('pnpm world:validate', () => {
  it('prints its usage for --help and -h', () => {
    expect(run(['--help']).lines).toEqual([USAGE]);
    expect(run(['-h']).code).toBe(0);
  });

  it('AC-1: validates the shipped map, printing warnings and a summary', () => {
    const { code, lines } = run([]);
    expect(code).toBe(0);
    expect(lines.some((l) => l.startsWith('::warning title=World map::'))).toBe(true);
    expect(lines.at(-1)).toMatch(/^World map "connectivity": \d+ node\(s\).*0 error\(s\)/);
  });

  it('lists planned connections and their beads with --plan', () => {
    const { lines } = run(['--plan']);
    expect(lines).toContain(
      'planned: market-green-briarwood-edge (market-green -> briarwood-edge) mw-e25.22',
    );
  });

  it('exits 1 when the map has an error', () => {
    const content = loadGameContent();
    const broken = {
      ...content,
      all: ((type: string) =>
        type === 'world'
          ? content.all('world').map((w) => ({
              ...w,
              townSpawn: 'the-cradle',
              mainQuest: ['the-cradle', 'wolf-den'],
              loops: [],
              edges: w.edges.map((e) =>
                e.transitions.length === 0 ? { ...e, bead: undefined } : e,
              ),
            }))
          : content.all(type as 'class')) as GameContent['all'],
    } as GameContent;
    const { code, lines } = run(['--plan'], () => broken);
    expect(code).toBe(1);
    expect(lines.some((l) => l.startsWith('planned:') && l.endsWith(' no bead'))).toBe(true);
    expect(lines.some((l) => l.startsWith('::error title=World map::'))).toBe(true);
  });

  it('exits 1 when there is no map at all', () => {
    const content = loadGameContent();
    const empty = {
      ...content,
      all: ((type: string) =>
        type === 'world' ? [] : content.all(type as 'class')) as GameContent['all'],
    } as GameContent;
    expect(run([], () => empty).code).toBe(1);
  });

  it('logs to the console by default', () => {
    expect(typeof defaultIo.content).toBe('function');
    defaultIo.log('');
  });
});
