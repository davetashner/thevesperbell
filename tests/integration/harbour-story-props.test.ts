// The harbour story-prop models (owner-approved turntables, 2026-11-16): the bay nine heist pieces and
// the breakwater's serpent figurehead and sea-door. They are not placed yet (the interiors are later
// beads), so this checks what can be checked now: each is shipped, credited and approved, and stays
// within the large-prop budget once optimised (style bible §13.2: one material, a small file).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MODELS = [
  'model-prop-bay-door-seal-01',
  'model-prop-relic-crate-01',
  'model-prop-ballast-crate-01',
  'model-prop-cargo-scale-01',
  'model-prop-strongroom-door-01',
  'model-prop-shelf-cray-01',
  'model-prop-figurehead-serpent-01',
  'model-prop-sea-door-01',
] as const;
const credits = readFileSync('assets/CREDITS.md', 'utf8');

describe('harbour story-prop models', () => {
  it('every model is shipped, credited and owner-approved', () => {
    for (const id of MODELS) {
      const runtime = `public/assets/model/${id}.glb`;
      expect(existsSync(runtime), `${id} runtime file`).toBe(true);
      expect(statSync(runtime).size, `${id} size`).toBeLessThan(256 * 1024);
      expect(credits, `${id} CREDITS row`).toContain(`| ${id} | model |`);
      expect(readFileSync(`assets/prompts/model/${id}.md`, 'utf8')).toContain(
        '**Status: owner-approved model**',
      );
    }
  });

  it('the relic crate and its ballast twin are separate models from the same approved sheet', () => {
    const relic = readFileSync('assets/prompts/model/model-prop-relic-crate-01.md', 'utf8');
    const ballast = readFileSync('assets/prompts/model/model-prop-ballast-crate-01.md', 'utf8');
    for (const text of [relic, ballast]) expect(text).toContain('prop-harbour-story-set-01');
  });
});
