// Entry point: node scripts/pr-prechecks-cli.ts [--lead] [--no-changelog] [--body <pr-body.md>]
import { main } from './pr-prechecks.ts';

process.exitCode = main(process.argv.slice(2));
