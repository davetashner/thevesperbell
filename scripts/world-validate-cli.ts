// Entry point: pnpm world:validate (mw-e24.1). The validator lives in src/ and loads content through
// import.meta.glob and Vite path aliases, which plain Node cannot do, so this loads
// src/tools/world/cli.ts through Vite's module runner (same resolution as the app and Vitest).
import { runnerImport } from 'vite';
import type * as WorldCli from '../src/tools/world/cli.ts';

const { module } = await runnerImport<typeof WorldCli>('./src/tools/world/cli.ts', {
  configFile: false,
  resolve: { tsconfigPaths: true },
  logLevel: 'error',
});
process.exitCode = module.main(process.argv.slice(2));
