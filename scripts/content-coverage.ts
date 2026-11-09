// Content-coverage check (mw-e00.18, contract §3: every content entry has at least one automated test
// exercising it). Loads all game content, reads the entries passing tests exercised (written by
// scripts/content-coverage-reporter.ts during `pnpm test`) and fails listing every entry no test
// touched. Run through scripts/content-coverage-cli.ts after the full unit suite.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readContentSources } from '../src/content/fs-sources.ts';
import { ContentLoadError, loadContent } from '../src/content/loader.ts';
import { contentChecks, contentTypes, type ContentType } from '../src/content/registry.ts';
import { variantWarnings } from '../src/content/variant-checks.ts';
import { CONTENT_COVERAGE_REPORT } from './content-coverage-reporter.ts';

const TITLE = 'Content coverage';

/** Every `type:id` in `all` that isn't in `exercised`, in `all`'s order. */
export function unexercised(all: readonly string[], exercised: Iterable<string>): string[] {
  const seen = new Set(exercised);
  return all.filter((entry) => !seen.has(entry));
}

/** `--content <dir>` (default src/content/data), `--report <file>`. Returns the exit code. */
export function main(argv: readonly string[], root: string = process.cwd()): number {
  const arg = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return i === -1 ? fallback : (argv[i + 1] ?? fallback);
  };
  const contentDir = arg('--content', 'src/content/data');
  const reportPath = arg('--report', CONTENT_COVERAGE_REPORT);

  let exercised: string[];
  try {
    exercised = (
      JSON.parse(readFileSync(resolve(root, reportPath), 'utf8')) as {
        exercised: string[];
      }
    ).exercised;
  } catch {
    console.log(
      `::error title=${TITLE}::No report at ${reportPath}; run the full pnpm test first.`,
    );
    return 2;
  }

  let all: string[];
  let warnings: string[];
  try {
    const content = loadContent(
      contentTypes,
      readContentSources(resolve(root, contentDir), contentDir),
      contentChecks,
    );
    all = (Object.keys(contentTypes) as ContentType[]).flatMap((type) =>
      content.all(type).map((entry) => `${type}:${entry.id}`),
    );
    warnings = variantWarnings(content.all('scene'));
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    for (const i of error.issues)
      console.log(`::error title=${TITLE}::${i.file}#${i.pointer}: ${i.message}`);
    return 1;
  }

  // Variant groups with no default leave a case uncovered (mw-e27.8): a warning, not a failure.
  for (const warning of warnings) console.log(`::warning title=${TITLE}::${warning}`);
  const missing = unexercised(all, exercised);
  for (const entry of missing) {
    console.log(
      `::error title=${TITLE}::${entry} has no passing test exercising it (use describeContent or markExercised from src/content/testing.ts).`,
    );
  }
  if (missing.length > 0) return 1;
  console.log(`Every content entry (${String(all.length)}) is exercised by a test.`);
  return 0;
}
