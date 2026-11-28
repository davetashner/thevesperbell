// Entry point: pnpm assets:build [--candidate <path>] (see cli.ts).
import { main } from './cli.ts';

process.exitCode = await main(process.argv.slice(2));
