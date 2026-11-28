import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { format, resolveConfig } from 'prettier';
import { formatLikePrettier, loadScenarios, writeGolden } from './files';
import { MIN_SCENARIOS, scenarioSchema } from './schema';

describe('scenario files (mw-e03.27)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scenarios-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  const real = loadScenarios();
  const first = real[0];
  if (first === undefined) throw new Error('no scenarios');

  it('AC-2: the committed directory holds at least twelve valid scenarios, one file each', () => {
    expect(real.length).toBeGreaterThanOrEqual(MIN_SCENARIOS);
    expect(real.every((s) => s.golden.finalHash !== null)).toBe(true);
  });

  it('reads files in id order and ignores other files', () => {
    writeFileSync(join(dir, 'zz.json'), JSON.stringify({ ...first, id: 'zz' }));
    writeFileSync(join(dir, 'aa.json'), JSON.stringify({ ...first, id: 'aa' }));
    writeFileSync(join(dir, 'notes.txt'), 'not a scenario');
    expect(loadScenarios(dir).map((s) => s.id)).toEqual(['aa', 'zz']);
  });

  it('names the file for unreadable JSON, a schema problem and an id that is not the file name', () => {
    writeFileSync(join(dir, 'bad.json'), '{ nope');
    expect(() => loadScenarios(dir)).toThrow(/bad\.json: cannot read scenario JSON/);
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ ...first, id: 'bad', outcomes: [] }));
    expect(() => loadScenarios(dir)).toThrow(/bad\.json: invalid scenario\n {2}outcomes/);
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ ...first, id: 'other' }));
    expect(() => loadScenarios(dir)).toThrow(/bad\.json: id "other" must match the file name/);
  });

  it('AC-1: a written scenario is exactly what Prettier makes of it, short arrays inline', async () => {
    await writeGolden(first, 'abcdef01', dir);
    const path = join(dir, `${first.id}.json`);
    const text = readFileSync(path, 'utf8');
    const expanded = JSON.stringify({ ...first, golden: { finalHash: 'abcdef01' } }, null, 2);
    expect(text).not.toBe(`${expanded}\n`);
    expect(text).toBe(await format(expanded, { ...(await resolveConfig(path)), filepath: path }));
    expect(await formatLikePrettier(path, text)).toBe(text);
  });

  it('AC-2: a written golden reads back as the same scenario with the new hash', async () => {
    await writeGolden(first, 'abcdef01', dir);
    const written = JSON.parse(readFileSync(join(dir, `${first.id}.json`), 'utf8')) as unknown;
    expect(scenarioSchema.parse(written)).toEqual({ ...first, golden: { finalHash: 'abcdef01' } });
  });

  it('rejects an outcome or input at or after the last tick and an unknown property', () => {
    const late = { ...first, ticks: 5 };
    const issues = scenarioSchema.safeParse(late).error?.issues.map((i) => i.message) ?? [];
    expect(issues).toContain('every outcome tick is before ticks');
    const bad = {
      ...first,
      setup: { ...first.setup, properties: [{ target: 'a', property: 'nope', value: 1 }] },
    };
    expect(scenarioSchema.safeParse(bad).success).toBe(false);
    const lateInput = {
      ...first,
      outcomes: [{ ...first.outcomes[0], tick: 0 }],
      ticks: 5,
      inputs: [{ tick: 5, set: { target: 'a', property: 'hp', value: 1 } }],
    };
    expect(scenarioSchema.safeParse(lateInput).error?.issues.map((i) => i.message)).toContain(
      'every input tick is before ticks',
    );
  });
});
