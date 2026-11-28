// Scenario files on disk (mw-e03.27): one JSON file per scenario in tests/scenarios, read and validated
// here, and the golden hash written back when a scenario is blessed.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scenarioSchema, type Scenario } from './schema';

/** Where the scenarios live, relative to the repo root. */
export const SCENARIO_DIR = 'tests/scenarios';

/**
 * Reads and validates every scenario file in `dir`, ordered by id.
 * @throws Error naming the file for unreadable JSON, a schema problem, or an id that is not its file name.
 */
export function loadScenarios(dir: string = SCENARIO_DIR): Scenario[] {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  return names.map((name) => {
    const path = join(dir, name);
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`${path}: cannot read scenario JSON (${(error as Error).message})`, {
        cause: error,
      });
    }
    const parsed = scenarioSchema.safeParse(data);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new Error(`${path}: invalid scenario\n  ${issues.join('\n  ')}`);
    }
    if (`${parsed.data.id}.json` !== name) {
      throw new Error(`${path}: id "${parsed.data.id}" must match the file name`);
    }
    return parsed.data;
  });
}

/** Writes `finalHash` as the scenario's golden, in the file's own layout. */
export function writeGolden(
  scenario: Scenario,
  finalHash: string,
  dir: string = SCENARIO_DIR,
): void {
  const next: Scenario = { ...scenario, golden: { finalHash } };
  writeFileSync(join(dir, `${scenario.id}.json`), `${JSON.stringify(next, null, 2)}\n`);
}
