// pnpm narrative:lint (mw-e39.24), run through scripts/narrative-lint-cli.ts, which loads this file
// through Vite (path aliases and import.meta.glob content loading). See lint.ts for the checks.

import {
  ContentLoadError,
  factIndex,
  gameContentSources,
  loadGameContent,
  lookupFact,
  type ContentSource,
  type GameContent,
} from '@content/index';
import { glossary } from '@content/narrative/glossary';
import { lintNarrative, type LintEnv, type LintIssue } from './lint';

export const USAGE = `Usage: pnpm narrative:lint

Lints the story content (dialogue, quests, rumours, notes, inscriptions, descriptions, facts, NPC
entries) against the canon glossary (src/content/narrative/glossary.json, story bible 11.3).
Errors: near-miss names ("Mirella" for "Mirela"), canon numbers that contradict the bible, and
fact, NPC, item, quest, scene or place ids that do not exist. Warnings: class-gated ids without
the matching playerClass condition, variants maps with no "all" fallback, modern slang and
fourth-wall phrases, American spelling. Errors exit 1; warnings print and exit 0.`;

export interface CliIo {
  log(line: string): void;
  sources(): ContentSource[];
  content(): GameContent;
}

export const defaultIo: CliIo = {
  log: (line) => {
    console.log(line);
  },
  sources: gameContentSources,
  content: loadGameContent,
};

/** The lint's view of loaded game content. */
export function contentEnv(content: GameContent): LintEnv {
  const facts = factIndex(content.all('fact'));
  return {
    glossary,
    fact: (key) => lookupFact(facts, key) !== undefined,
    npc: (id) => content.has('creature', id),
    item: (id) => content.has('item', id),
    quest: (id) => content.has('quest', id),
    scene: (id) => content.has('scene', id),
  };
}

const annotate = (issue: LintIssue): string =>
  `::${issue.level} file=${issue.file},line=${String(issue.line)},title=Narrative (${issue.check})::${issue.message}`;

/** The exit code of `pnpm narrative:lint <args>`. */
export function main(args: readonly string[], io: CliIo = defaultIo): number {
  if (args.includes('--help') || args.includes('-h')) {
    io.log(USAGE);
    return 0;
  }
  let content: GameContent;
  try {
    content = io.content();
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    for (const issue of error.issues) {
      io.log(`::error file=${issue.file},title=Content::${issue.pointer}: ${issue.message}`);
    }
    return 1;
  }
  const report = lintNarrative(io.sources(), contentEnv(content));
  for (const issue of report.errors) io.log(annotate(issue));
  for (const issue of report.warnings) io.log(annotate(issue));
  io.log(
    `Narrative: ${String(report.files)} file(s), ${String(report.errors.length)} error(s), ${String(report.warnings.length)} warning(s).`,
  );
  return report.errors.length > 0 ? 1 : 0;
}
