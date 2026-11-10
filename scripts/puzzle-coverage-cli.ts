// Entry point: pnpm puzzle:coverage [--write|--check|--summary] (mw-e15.8). Like puzzle-validate-cli.ts,
// it loads the tool in src/ through Vite's module runner (path aliases, Rapier's wasm).
import wasm from 'vite-plugin-wasm';
import { runnerImport } from 'vite';
import type { Plugin } from 'vite';
import type * as PuzzleCoverageCli from '../src/tools/puzzle/coverage-cli.ts';

const { module } = await runnerImport<typeof PuzzleCoverageCli>(
  './src/tools/puzzle/coverage-cli.ts',
  {
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
  },
);
process.exitCode = module.main(process.argv.slice(2));
