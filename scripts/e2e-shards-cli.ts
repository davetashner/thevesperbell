// Entry points (mw-e41.1), logic in e2e-shards.ts:
//   node scripts/e2e-shards-cli.ts files <shard> <count>     spec paths for one chromium shard (1-based)
//   node scripts/e2e-shards-cli.ts regenerate <report.json>...  rewrite e2e/shards.json from Playwright
//                                                            JSON reports (CI's e2e-report artifacts), averaged
import { main } from './e2e-shards.ts';

process.exitCode = main(process.argv.slice(2));
