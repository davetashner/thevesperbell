// Scenario files on disk (mw-e03.27): one JSON file per scenario in tests/scenarios, read and validated
// here, and the golden hash written back when a scenario is blessed.

import { readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
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

/**
 * `text` as Prettier would lay out the file at `path`, using the repo's Prettier config, so a
 * generated file passes `prettier --check` as written.
 */
export async function formatLikePrettier(path: string, text: string): Promise<string> {
  const config = await resolveConfig(path);
  return format(text, { ...config, filepath: path });
}

/** Writes `finalHash` as the scenario's golden, in the file's own layout (Prettier-formatted). */
export async function writeGolden(
  scenario: Scenario,
  finalHash: string,
  dir: string = SCENARIO_DIR,
): Promise<void> {
  const next: Scenario = { ...scenario, golden: { finalHash } };
  const path = join(dir, `${scenario.id}.json`);
  await writeFile(path, await formatLikePrettier(path, JSON.stringify(next, null, 2)));
}
