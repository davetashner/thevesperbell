// mw-e02.8 AC-3: the input latency probe is for the dev server and the perf suite's build only. A
// production build (no VESPER_LATENCY_PROBE) must not contain it; a build made with
// VESPER_LATENCY_PROBE=on must (so the scan looks for something that is really there).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { PROBE_GLOBAL } from '@tools/perf/latency-probe';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function bundle(probe: boolean): Promise<string> {
  const outDir = mkdtempSync(join(tmpdir(), 'vesper-latency-probe-'));
  dirs.push(outDir);
  const before = process.env['VESPER_LATENCY_PROBE'];
  // Vitest runs with NODE_ENV=test, which makes import.meta.env.DEV true in a build; a production
  // build is made with NODE_ENV=production, as `vite build` does.
  const nodeEnv = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'production';
  if (probe) process.env['VESPER_LATENCY_PROBE'] = 'on';
  else delete process.env['VESPER_LATENCY_PROBE'];
  try {
    await build({ root, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  } finally {
    process.env['NODE_ENV'] = nodeEnv;
    if (before === undefined) delete process.env['VESPER_LATENCY_PROBE'];
    else process.env['VESPER_LATENCY_PROBE'] = before;
  }
  const files = (readdirSync(outDir, { recursive: true }) as string[]).filter((f) =>
    /\.(js|html)$/.test(f),
  );
  return files.map((f) => readFileSync(join(outDir, f), 'utf8')).join('\n');
}

describe('latency probe in builds', () => {
  it(
    'AC-3: a production build has no probe symbol; a perf build has it',
    { timeout: 180_000 },
    async () => {
      expect(PROBE_GLOBAL).toBe('mwLatencyProbe');
      const perf = await bundle(true);
      expect(perf).toContain(PROBE_GLOBAL);
      const production = await bundle(false);
      expect(production).not.toContain(PROBE_GLOBAL);
      expect(production).not.toContain('mwLatency');
      expect(production).not.toContain('latency-probe');
    },
  );
});
