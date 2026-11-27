import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyPath, formatOutputs, main, parsePaths, planFor } from './ci-changes.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function listFile(...paths: string[]): string {
  const d = mkdtempSync(join(tmpdir(), 'ci-changes-'));
  dirs.push(d);
  const file = join(d, 'changed.txt');
  writeFileSync(file, paths.join('\n') + '\n');
  return file;
}

describe('classifyPath', () => {
  it('AC-1: backlog, plan, site and changelog paths are light', () => {
    for (const p of [
      '.beads/issues.jsonl',
      'plan/core.json',
      'site/index.html',
      'CHANGELOG.md',
      './site/404.html',
    ]) {
      expect(classifyPath(p)).toBe('light');
    }
  });

  it('docs, scripts and root markdown only need the unit tier', () => {
    for (const p of ['docs/ci-gates.md', 'scripts/ci-changes.ts', 'README.md', 'AGENTS.md']) {
      expect(classifyPath(p)).toBe('unit');
    }
  });

  it('AC-2: everything else, including unknown paths, is full', () => {
    for (const p of [
      'src/main.ts',
      'e2e/boot.spec.ts',
      'tests/integration/a.test.ts',
      'package.json',
      'pnpm-lock.yaml',
      'vite.config.ts',
      'playwright.config.ts',
      '.github/workflows/ci.yml',
      'tsconfig.json',
      'eslint.config.js',
      'public/assets/a.png',
      'assets/a.png',
      'index.html',
      'something/new.txt',
      'docs',
      'sub/README.md',
    ]) {
      expect(classifyPath(p)).toBe('full');
    }
  });
});

describe('planFor', () => {
  it('AC-1: a light diff runs neither tier', () => {
    expect(planFor(['.beads/issues.jsonl', 'plan/core.json'])).toEqual({ unit: false, app: false });
  });

  it('a scripts or docs diff runs the unit tier but not the app jobs', () => {
    expect(planFor(['scripts/a.ts', '.beads/issues.jsonl'])).toEqual({ unit: true, app: false });
    expect(planFor(['docs/a.md'])).toEqual({ unit: true, app: false });
  });

  it('AC-2: one full path, or no paths, runs everything', () => {
    expect(planFor(['docs/a.md', 'src/sim/a.ts', 'scripts/a.ts'])).toEqual({
      unit: true,
      app: true,
    });
    expect(planFor([])).toEqual({ unit: true, app: true });
  });
});

describe('parsePaths and formatOutputs', () => {
  it('splits a name-only listing and drops blanks', () => {
    expect(parsePaths('a.ts\n\n  b/c.ts \n')).toEqual(['a.ts', 'b/c.ts']);
  });

  it('writes GITHUB_OUTPUT lines', () => {
    expect(formatOutputs({ unit: true, app: false })).toBe('unit=true\napp=false\n');
  });
});

describe('main', () => {
  it('narrows a pull request to its changed paths', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main([listFile('.beads/issues.jsonl')], { GITHUB_EVENT_NAME: 'pull_request' })).toBe(0);
    expect(log).toHaveBeenCalledWith('unit=false\napp=false');
  });

  it('AC-2: pushes and manual runs always run the full pipeline', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    for (const ev of ['push', 'workflow_dispatch', undefined]) {
      main([listFile('.beads/issues.jsonl')], { GITHUB_EVENT_NAME: ev });
    }
    expect(log).toHaveBeenCalledTimes(3);
    for (const call of log.mock.calls) expect(call).toEqual(['unit=true\napp=true']);
  });

  it('runs everything when the list is missing or unreadable', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(main([], { GITHUB_EVENT_NAME: 'pull_request' })).toBe(0);
    expect(main(['/nonexistent/changed.txt'], { GITHUB_EVENT_NAME: 'pull_request' })).toBe(0);
    expect(log).toHaveBeenLastCalledWith('unit=true\napp=true');
    expect(err).toHaveBeenCalledTimes(2);
  });

  it('the CLI reads argv and the environment and sets the process exit code', async () => {
    const argv = process.argv;
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request');
    process.argv = ['node', 'ci-changes-cli.ts', listFile('scripts/a.ts')];
    try {
      await import('./ci-changes-cli.ts');
      expect(process.exitCode).toBe(0);
      expect(log).toHaveBeenCalledWith('unit=true\napp=false');
    } finally {
      process.argv = argv;
      process.exitCode = undefined;
    }
  });
});
