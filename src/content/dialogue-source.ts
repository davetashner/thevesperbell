// Validates one dialogue file's text and reports problems the way a writer needs them (mw-e22.3,
// AC-2): the file, the node the problem is in and the line. `loadContent` reports a JSON pointer;
// this wraps the dialogue schema, finds the node id from the pointer and the line from the text.
// Logic DSL validation (kinds, references) is src/sim/dialogue/validate.ts; its issues carry the
// same pointers, so callers can pass them through `describeDialogueIssue` as well.

import { lineOf, locateJson } from './json-locate.ts';
import { dottedPath, jsonPointer, withoutSchemaKey } from './loader.ts';
import { dialogueSchema, type DialogueDef } from './types/dialogue.ts';

/** One problem in a dialogue file. */
export interface DialogueFileIssue {
  readonly file: string;
  /** RFC 6901 pointer into the file. */
  readonly pointer: string;
  /** Id of the node the problem is in, when it is inside one. */
  readonly nodeId?: string | undefined;
  /** 1-based line of the offending value. */
  readonly line: number;
  readonly message: string;
}

/** `file:line (node "x"): message`, the one-line form for CLIs and test names. */
export function formatDialogueIssue(issue: DialogueFileIssue): string {
  const node = issue.nodeId === undefined ? '' : ` (node "${issue.nodeId}")`;
  return `${issue.file}:${String(issue.line)}${node}: ${issue.message}`;
}

/** The id of the node `pointer` is inside (`/nodes/3/kind` → nodes[3].id), if any. */
function nodeIdAt(json: unknown, pointer: string): string | undefined {
  const [, section, index] = pointer.split('/');
  if (section !== 'nodes' || index === undefined) return undefined;
  const nodes = (json as { nodes?: unknown }).nodes;
  const node = Array.isArray(nodes)
    ? (nodes[Number(index)] as { id?: unknown } | undefined)
    : undefined;
  return typeof node?.id === 'string' ? node.id : undefined;
}

/**
 * Parses `text` as a dialogue file. Returns the dialogue, or every problem with file, node id and
 * line.
 */
export function validateDialogueText(
  file: string,
  text: string,
):
  | { readonly ok: true; readonly dialogue: DialogueDef }
  | { readonly ok: false; readonly issues: readonly DialogueFileIssue[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const message = (error as Error).message;
    const line = Number(/\(line (\d+)/.exec(message)?.[1] ?? 1);
    return {
      ok: false,
      issues: [{ file, pointer: '', line, message: `invalid JSON: ${message}` }],
    };
  }
  const result = dialogueSchema.safeParse(withoutSchemaKey(json));
  if (result.success) return { ok: true, dialogue: result.data };
  const lines = locateJson(text);
  return {
    ok: false,
    issues: result.error.issues.map((issue) => {
      const pointer = jsonPointer(issue.path);
      const at = issue.path.length > 0 ? ` (at ${dottedPath(issue.path)})` : '';
      return {
        file,
        pointer,
        nodeId: nodeIdAt(json, pointer),
        line: lineOf(lines, pointer),
        message: `${issue.message}${at}`,
      };
    }),
  };
}

/** Locates a pointer-carrying issue from another validator (the sim's logic check) in `text`. */
export function describeDialogueIssue(
  file: string,
  text: string,
  issue: { readonly pointer: string; readonly message: string },
): DialogueFileIssue {
  return {
    file,
    pointer: issue.pointer,
    nodeId: nodeIdAt(JSON.parse(text), issue.pointer),
    line: lineOf(locateJson(text), issue.pointer),
    message: issue.message,
  };
}
