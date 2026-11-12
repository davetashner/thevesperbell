// Entry point: pnpm dialogue:validate (mw-e22.8). The validator lives in src/ and loads content
// through import.meta.glob and Vite path aliases, which plain Node cannot do, so this loads
// src/tools/dialogue/cli.ts through Vite's module runner (same resolution as the app and Vitest).
import { runnerImport } from 'vite';
import type * as DialogueCli from '../src/tools/dialogue/cli.ts';

const { module } = await runnerImport<typeof DialogueCli>('./src/tools/dialogue/cli.ts', {
  configFile: false,
  resolve: { tsconfigPaths: true },
  logLevel: 'error',
});
process.exitCode = module.main(process.argv.slice(2));
