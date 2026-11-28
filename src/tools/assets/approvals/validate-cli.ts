// Entry point: pnpm assets:validate. Today it runs the approvals rule (mw-e37.3); the asset validator
// (mw-e37.2: naming, budgets, licences) adds its rules to this command.
import { run } from './cli.ts';

process.exitCode = run('validate', process.argv.slice(2));
