// Load-time dialogue checks (mw-e22.3): what a dialogue file can't check alone. A `jump` that names
// a node of another dialogue must name one that exists (the dialogue itself is a `ref`, which the
// loader checks). Issues name the file, the JSON pointer and the missing node.

import type { ContentCheck, ContentIssue } from './loader.ts';
import type { DialogueDef } from './types/dialogue.ts';

/** The content check for dialogues: jump targets name real nodes. */
export const checkDialogues: ContentCheck = (entries) => {
  const dialogues = entries.filter((entry) => entry.type === 'dialogue');
  const nodes = new Map(
    dialogues.map(({ value }) => [
      value.id,
      new Set((value as DialogueDef).nodes.map((node) => node.id)),
    ]),
  );
  const issues: ContentIssue[] = [];
  for (const { file, value } of dialogues) {
    (value as DialogueDef).nodes.forEach((node, n) => {
      if (node.kind !== 'jump' || node.node === undefined) return;
      if (nodes.get(node.dialogue.id)?.has(node.node) !== true) {
        issues.push({
          file,
          pointer: `/nodes/${String(n)}/node`,
          message: `jump "${node.id}" names unknown node "${node.node}" of dialogue ${String(node.dialogue)}`,
        });
      }
    });
  }
  return issues;
};
