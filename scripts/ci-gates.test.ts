// Tiered CI gates (mw-e41.5): docs/ci-gates.md classifies every job and project, slow gates stay off
// pull requests and run nightly with an issue on failure, and the contract DoD names the tiers.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const WORKFLOWS = '.github/workflows';
const read = (path: string): string => readFileSync(path, 'utf8');
const docs = read('docs/ci-gates.md');

/** Top-level job ids of a workflow file. */
function jobsOf(yaml: string): string[] {
  const body = yaml.slice(yaml.search(/^jobs:/m));
  return [...body.matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gm)].map((m) => String(m[1]));
}

/** The text of one job in a workflow file. */
function jobText(yaml: string, id: string): string {
  const start = yaml.search(new RegExp(`^ {2}${id}:\\s*$`, 'm'));
  const rest = yaml.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][a-z0-9-]*:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('CI gate tiers', () => {
  it('AC-1: docs/ci-gates.md lists every workflow job with a tier and a reason', () => {
    for (const file of readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml'))) {
      for (const id of jobsOf(read(`${WORKFLOWS}/${file}`))) {
        const rows = docs.split('\n').filter((l) => l.startsWith('|') && l.includes(`(${file})`));
        const row = rows.find((l) => l.includes(`\`${id}\``) || l.includes(`\`${id}\` `));
        expect(row, `${id} (${file})`).toBeDefined();
        const cells = (row ?? '').split('|').map((c) => c.trim());
        expect(cells[2], `${id} tier`).toMatch(/per-PR|nightly|release|manual/);
        expect(cells[3]?.length, `${id} reason`).toBeGreaterThan(10);
      }
    }
  });

  it('AC-1: docs/ci-gates.md lists every Playwright project', () => {
    for (const file of ['playwright.config.ts', 'playwright.perf.config.ts']) {
      for (const [, name] of read(file).matchAll(/name: '([a-z-]+)'/g)) {
        expect(docs, `${String(name)} (${file})`).toContain(`\`${String(name)}\` (${file})`);
      }
    }
  });

  it('AC-2: pull requests do not run perf-budget, bench, or the Firefox and WebKit audio project', () => {
    const ci = read(`${WORKFLOWS}/ci.yml`);
    expect(ci).not.toMatch(/--project=(firefox|webkit)/);
    expect(ci).not.toMatch(/pnpm bench|pnpm perf\b/);
    expect(jobsOf(ci)).not.toContain('e2e-audio');
    // The perf job survives only to publish the baseline on pushes to main.
    expect(jobText(ci, 'perf-budget')).toMatch(/if: github\.event_name == 'push'/);
    expect(jobText(ci, 'e2e-smoke')).not.toContain('e2e-audio');
  });

  it('AC-2: the required check names are still produced by ci.yml', () => {
    const ci = read(`${WORKFLOWS}/ci.yml`);
    for (const id of [
      'lint',
      'typecheck',
      'unit',
      'coverage-gate',
      'coverage-ratchet',
      'e2e-smoke',
      'build',
      'beads-validate',
    ])
      expect(jobsOf(ci)).toContain(id);
  });

  it('AC-3: the nightly workflow runs the slow gates on main and files one issue on failure', () => {
    const nightly = read(`${WORKFLOWS}/nightly.yml`);
    expect(nightly).toMatch(/^ {2}schedule:/m);
    expect(nightly).toMatch(/^ {2}workflow_dispatch:/m);
    expect(nightly).toContain('uses: ./.github/workflows/slow-gates.yml');
    expect(nightly).toMatch(/issues: write/);
    expect(nightly).toContain("const label = 'nightly-failure'");
    // One issue: an open one is commented on rather than a second being created.
    expect(nightly).toContain('createComment');

    const slow = read(`${WORKFLOWS}/slow-gates.yml`);
    expect(slow).toMatch(/^ {2}workflow_call:/m);
    expect(jobsOf(slow)).toEqual(['bench', 'e2e-audio', 'perf-budget']);
    expect(slow).toContain('--project=firefox --project=webkit');
    expect(slow).toContain('pnpm perf');
    expect(slow).toContain('pnpm bench');
  });

  it('AC-4: the contract DoD items 3 and 4 name the tiers', () => {
    const contract = read('docs/backlog-contract.md');
    const item = (n: number): string =>
      contract.split('\n').find((l) => l.startsWith(`${String(n)}. `)) ?? '';
    expect(item(3)).toMatch(/per-PR tier/i);
    expect(item(4)).toMatch(/nightly tier/i);
    expect(item(4)).toMatch(/release tier/i);
    expect(item(4)).not.toMatch(/once `e32` budgets exist/);
  });
});
