// pnpm dialogue:validate (mw-e22.8), run through scripts/dialogue-validate-cli.ts, which loads this
// file through Vite (path aliases and import.meta.glob content loading). See validate.ts for checks.

import { DIALOGUE_MAX_TEXT_LENGTH } from '@content/types/dialogue';
import {
  ContentLoadError,
  gameContentSources,
  loadGameContent,
  type ContentSource,
  type GameContent,
} from '@content/index';
import type { DialogueFileIssue } from '@content/dialogue-source';
import { contentReferences, validateDialogues } from './validate';

export const USAGE = `Usage: pnpm dialogue:validate [--max-length <characters>]

Validates every dialogue in src/content/data/dialogue/ (docs/design/dialogue-format.md) and the
persuasion table: schema, logic kinds and content references (items, quests, facts, classes, NPCs),
every node reachable from an entry, every step with an exit, no choice whose options are all
unsatisfiable, no loop with no way out (reported with its path), and line and option text within the
length limit (default ${String(DIALOGUE_MAX_TEXT_LENGTH)}). Errors exit 1; warnings print and exit 0.`;

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

/** The limit `--max-length` asks for, the default when absent, or undefined when it is invalid. */
function maxLength(args: readonly string[]): number | undefined {
  const at = args.indexOf('--max-length');
  if (at < 0) return DIALOGUE_MAX_TEXT_LENGTH;
  const value = Number(args[at + 1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

const annotate = (level: 'error' | 'warning', issue: DialogueFileIssue): string => {
  const node = issue.nodeId === undefined ? '' : `node "${issue.nodeId}": `;
  return `::${level} file=${issue.file},line=${String(issue.line)},title=Dialogue::${node}${issue.message}`;
};

/** The exit code of `pnpm dialogue:validate <args>`. */
export function main(args: readonly string[], io: CliIo = defaultIo): number {
  if (args.includes('--help') || args.includes('-h')) {
    io.log(USAGE);
    return 0;
  }
  const limit = maxLength(args);
  if (limit === undefined) {
    io.log('::error title=Dialogue::--max-length needs a positive whole number');
    return 1;
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
  const report = validateDialogues(io.sources(), {
    maxTextLength: limit,
    references: contentReferences(content),
  });
  for (const issue of report.errors) io.log(annotate('error', issue));
  for (const issue of report.warnings) io.log(annotate('warning', issue));
  io.log(
    `Dialogue: ${String(report.dialogues)} file(s), ${String(report.errors.length)} error(s), ${String(report.warnings.length)} warning(s).`,
  );
  return report.errors.length > 0 ? 1 : 0;
}
