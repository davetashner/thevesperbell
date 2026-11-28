// Entry point: pnpm assets:approve <asset-id> <gate> <version> [--reject] [--note …] (see cli.ts).
import { run } from './cli.ts';

process.exitCode = run('approve', process.argv.slice(2));
