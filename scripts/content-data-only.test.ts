import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { main, sourceChanges, testChanges } from './content-data-only.ts';

const run = (args: string[], diff: (base: string) => string[] = () => []) => {
  const lines: string[] = [];
  const code = main(args, (line) => lines.push(line), diff);
  return { code, lines };
};

describe('content data-only check (mw-e15.9)', () => {
  it('AC-3: content JSON, tests, scripts and docs are data-only', () => {
    const files = [
      'src/content/data/puzzle/scales-room.json',
      'src/content/data/scene/scales-room.json',
      'tests/integration/reference-puzzles.test.ts',
      'scripts/content-data-only.ts',
      'docs/design/puzzles.md',
    ];
    expect(sourceChanges(files)).toEqual([]);
    expect(run(['--files', ...files]).code).toBe(0);
  });

  it('AC-3: a .ts or .tsx file under src/ fails the check and is named', () => {
    const files = [
      'src/content/data/puzzle/x.json',
      'src/sim/mechanisms/plates.ts',
      'src/ui/a.tsx',
    ];
    expect(sourceChanges(files)).toEqual(['src/sim/mechanisms/plates.ts', 'src/ui/a.tsx']);
    const { code, lines } = run(['--files', ...files]);
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('src/sim/mechanisms/plates.ts');
  });

  it('a test file under src/ is reported but allowed', () => {
    const files = ['src/game/scene/scene-loader.test.ts'];
    expect(testChanges(files)).toEqual(files);
    const { code, lines } = run(['--files', ...files]);
    expect(code).toBe(0);
    expect(lines[0]).toContain('note: test files');
  });

  it('a base ref reads the diff, and no argument prints usage', () => {
    expect(run(['origin/main'], () => ['src/sim/a.ts']).code).toBe(1);
    expect(run(['origin/main'], () => ['src/content/data/a.json']).code).toBe(0);
    expect(run([]).code).toBe(2);
  });

  it("AC-3: this item's own content files are data-only", () => {
    const own = ['sunbeam-hall', 'frozen-channel', 'scales-room'].flatMap((id) =>
      ['puzzle', 'scene', 'signal-graph', 'fact']
        .map((type) => `src/content/data/${type}/${id}.json`)
        .filter((file) =>
          readdirSync(`src/content/data/${file.split('/')[3] ?? ''}`).includes(`${id}.json`),
        ),
    );
    expect(own).toHaveLength(12);
    expect(sourceChanges(own)).toEqual([]);
  });
});
