// Entry point: PR_AUTHOR=… node scripts/dco-check-cli.ts <commits.txt>
import { main } from './dco-check.ts';

process.exitCode = main(process.argv.slice(2), process.env);
