// The river prop models (mw-e37.434): Briar Glen Quay, the Millweir and Kestrel Lock, generated from two
// approved prop sheets and passed at the turntable gate (Claude, delegated by owner 2026-11-07). The
// quay and lock scenes place them; this checks what holds for every one of them: shipped, credited,
// approved, traced to its sheet and within the prop budget once optimised (style bible §13.2).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SHEETS = {
  'prop-river-quay-weir-set-01': [
    'model-prop-stone-barge-01',
    'model-prop-mooring-bollard-01',
    'model-prop-glenstone-cradle-01',
    'model-prop-quay-toll-shed-01',
    'model-prop-weir-sluice-gate-01',
    'model-prop-weir-keystone-01',
  ],
  'prop-river-kestrel-lock-set-01': [
    'model-prop-lock-gate-01',
    'model-prop-lock-paddle-gear-01',
    'model-prop-lock-toll-board-01',
    'model-prop-lock-cottage-01',
    'model-prop-lock-coping-stack-01',
  ],
} as const;
const credits = readFileSync('assets/CREDITS.md', 'utf8');

describe('river prop models', () => {
  it('AC-1: every model is shipped, credited, approved and traced to its approved sheet', () => {
    for (const [sheet, models] of Object.entries(SHEETS)) {
      expect(existsSync(`assets/source/prop/${sheet}/${sheet}.png`), sheet).toBe(true);
      expect(credits, `${sheet} CREDITS row`).toContain(`| \`${sheet}\` | concept |`);
      for (const id of models) {
        expect(credits, `${id} CREDITS row`).toContain(`| ${id} | model |`);
        const record = readFileSync(`assets/prompts/model/${id}.md`, 'utf8');
        expect(record).toContain('**Status: approved model**');
        expect(record).toContain(`assets/source/prop/${sheet}/${sheet}.png`);
        expect(record).toMatch(/\| turntable \| v1 \| approved \|/);
      }
    }
  });

  it('AC-2: every runtime model is optimised and within the prop file budget', () => {
    for (const id of Object.values(SHEETS).flat()) {
      const runtime = `public/assets/model/${id}.glb`;
      expect(existsSync(runtime), `${id} runtime file`).toBe(true);
      expect(statSync(runtime).size, `${id} size`).toBeLessThan(256 * 1024);
    }
  });
});
