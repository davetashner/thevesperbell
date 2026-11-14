// mw-e12.15: the standard smoke battery for every creature data file (see ./harness.ts). The tests
// are generated: add a creature file under src/content/data/creature (or the frozen fixtures) and its
// `creature:<id> smoke — <step>` tests exist. AC-1 (the count) is proved against fixture creatures in
// ./harness.test.ts and here against the files on disk.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDevContent } from '@content/dev-content';
import { BATTERY, planSmoke, registerSmoke, subjectsOf, type CreatureScenarios } from './harness';

const content = loadDevContent();
const subjects = subjectsOf(content);

/** Creature files opting into extra scenario steps: creature id → steps (none yet). */
const SCENARIOS: CreatureScenarios = {};

const plan = planSmoke(subjects, SCENARIOS);

describe('creature smoke battery (mw-e12.15)', () => {
  it('AC-1: every creature file on disk has its full battery planned', () => {
    const files = [
      ...readdirSync('src/content/data/creature'),
      ...readdirSync('src/content/fixtures/creatures/creature'),
      ...readdirSync('src/content/fixtures/dev/creature'),
    ].filter((name) => name.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    expect(subjects).toHaveLength(files.length);
    expect(plan).toHaveLength(files.length * BATTERY.length);
  });

  registerSmoke(plan);
});
