// Entry point: node scripts/size/size-budget-cli.ts [--dist dist] [--baseline <size-report.json>] ...
// Logic lives in size-budget.ts (mw-e32.3).
import { main } from './size-budget.ts';

process.exitCode = main(process.argv.slice(2), {
  log: (line) => {
    console.log(line);
  },
  env: process.env,
});
