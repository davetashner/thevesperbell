// Entry point: pnpm narrative:lint (mw-e39.24). The lint lives in src/ and loads content
// through import.meta.glob and Vite path aliases, which plain Node cannot do, so this loads
// src/tools/narrative-lint/cli.ts through Vite's module runner (same resolution as the app and Vitest).
import { runnerImport } from 'vite';
import type * as NarrativeLintCli from '../src/tools/narrative-lint/cli.ts';

const { module } = await runnerImport<typeof NarrativeLintCli>(
  './src/tools/narrative-lint/cli.ts',
  {
    configFile: false,
    resolve: { tsconfigPaths: true },
    logLevel: 'error',
  },
);
process.exitCode = module.main(process.argv.slice(2));
