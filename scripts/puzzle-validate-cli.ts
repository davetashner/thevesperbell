// Entry point: pnpm puzzle:validate [id] (mw-e15.6). The validator lives in src/ and uses Vite path
// aliases, extensionless imports and Rapier's wasm module, which plain Node cannot load, so this
// loads src/tools/puzzle/cli.ts through Vite's module runner (same resolution as the app and Vitest).
import wasm from 'vite-plugin-wasm';
import { runnerImport } from 'vite';
import type { Plugin } from 'vite';
import type * as PuzzleCli from '../src/tools/puzzle/cli.ts';

const { module } = await runnerImport<typeof PuzzleCli>('./src/tools/puzzle/cli.ts', {
  configFile: false,
  plugins: [wasm() as Plugin],
  resolve: {
    tsconfigPaths: true,
    alias: [
      {
        find: /^@dimforge\/rapier3d-deterministic$/,
        replacement: '@dimforge/rapier3d-deterministic/rapier.js',
      },
    ],
  },
  logLevel: 'error',
});
process.exitCode = module.main(process.argv.slice(2));
