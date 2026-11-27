// Entry point: GITHUB_EVENT_NAME=pull_request node scripts/ci-changes-cli.ts <changed-files.txt> >> "$GITHUB_OUTPUT"
import { main } from './ci-changes.ts';

process.exitCode = main(process.argv.slice(2), process.env);
