// mw-e27.6: the world state console tools ship only with the debug console. A release build
// (VESPER_DEBUG_CONSOLE=off) must not contain its code; a normal build must (so the scan below
// looks for something that is really there).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

// Strings only the tools' modules contain (the panel's test id, console commands' error text).
const MARKERS = ['world-state-panel', 'only declared facts can be set', 'state.snapshot first'];

async function bundle(release: boolean): Promise<string> {
  const outDir = mkdtempSync(join(tmpdir(), 'vesper-world-state-'));
  dirs.push(outDir);
  const before = process.env['VESPER_DEBUG_CONSOLE'];
  if (release) process.env['VESPER_DEBUG_CONSOLE'] = 'off';
  else delete process.env['VESPER_DEBUG_CONSOLE'];
  try {
    await build({ root, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  } finally {
    if (before === undefined) delete process.env['VESPER_DEBUG_CONSOLE'];
    else process.env['VESPER_DEBUG_CONSOLE'] = before;
  }
  const files = (readdirSync(outDir, { recursive: true }) as string[]).filter((f) =>
    /\.(js|html)$/.test(f),
  );
  return files.map((f) => readFileSync(join(outDir, f), 'utf8')).join('\n');
}

describe('world state tools in builds', () => {
  it(
    'a release build has no world state tools code; a debug build has it',
    { timeout: 180_000 },
    async () => {
      const debug = await bundle(false);
      for (const marker of MARKERS) expect(debug).toContain(marker);
      const release = await bundle(true);
      for (const marker of MARKERS) expect(release).not.toContain(marker);
    },
  );
});
