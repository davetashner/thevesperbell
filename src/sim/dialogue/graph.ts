// Static graph validation of a dialogue (mw-e22.8): what the schema (src/content/types/dialogue.ts)
// cannot see because it looks at one node at a time. Every node must be reachable from some entry,
// every step must continue or end, every choice must be answerable by someone, no loop may trap the
// player, and no line may overrun the UI. Findings carry JSON pointers into the dialogue file
// (src/content/dialogue-source.ts turns them into file, node id and line) and a stable `code`.
//
// Satisfiability is deliberately conservative: a condition is "unsatisfiable" only when it is a
// provable contradiction (two different player classes required together, a fact required to equal
// two values, a condition and its own negation, an empty `any`). Anything the checker cannot decide
// counts as satisfiable, so it never rejects a conversation a player could actually have.

import type { DialogueDef, DialogueNode } from '../../content/types/dialogue';
import type { LogicNode } from '../logic';

/** Machine-readable kind of a graph finding. */
export type DialogueGraphCode =
  | 'unreachable-node'
  | 'missing-exit'
  | 'unsatisfiable-choice'
  | 'unsatisfiable-option'
  | 'inescapable-cycle'
  | 'text-too-long';

export interface DialogueGraphIssue {
  /** RFC 6901 pointer into the dialogue file. */
  readonly pointer: string;
  readonly code: DialogueGraphCode;
  readonly message: string;
}

export interface DialogueGraphReport {
  readonly errors: readonly DialogueGraphIssue[];
  readonly warnings: readonly DialogueGraphIssue[];
}

export interface DialogueGraphOptions {
  /** Longest allowed `text` of a line or option, in characters. */
  readonly maxTextLength: number;
}

type Children = readonly LogicNode[];

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );

/** The literals every satisfying world must make true, flattened through nested `all`. */
function required(condition: LogicNode, into: LogicNode[]): void {
  if (condition.kind === 'all') {
    for (const child of condition['of'] as Children) required(child, into);
  } else {
    into.push(condition);
  }
}

/**
 * Why `condition` can never hold, or undefined when it might (or when that is undecidable here).
 * Only provable contradictions are reported.
 */
export function contradiction(condition: LogicNode | undefined): string | undefined {
  if (condition === undefined) return undefined;
  if (condition.kind === 'any') {
    const children = condition['of'] as Children;
    if (children.length === 0) return 'an empty `any` is never true';
    const reasons = children.map(contradiction);
    const first = reasons.find((r) => r !== undefined);
    return first !== undefined && reasons.every((r) => r !== undefined)
      ? `every alternative fails: ${first}`
      : undefined;
  }
  if (condition.kind === 'not') {
    const inner = condition['condition'] as LogicNode;
    return inner.kind === 'all' && (inner['of'] as Children).length === 0
      ? '`not` of an empty `all` is never true'
      : undefined;
  }
  const literals: LogicNode[] = [];
  required(condition, literals);
  const classes = new Set<string>();
  const facts = new Map<string, string>();
  const positives = new Set<string>();
  const negatives = new Set<string>();
  for (const literal of literals) {
    if (literal.kind === 'any' || literal.kind === 'not') {
      const own = contradiction(literal);
      if (own !== undefined) return own;
    }
    if (literal.kind === 'playerClass') classes.add(literal['class'] as string);
    if (literal.kind === 'factCmp' && literal['op'] === 'eq') {
      const fact = literal['fact'] as string;
      const value = JSON.stringify(literal['value']);
      const seen = facts.get(fact);
      if (seen !== undefined && seen !== value) {
        return `fact "${fact}" cannot equal both ${seen} and ${value}`;
      }
      facts.set(fact, value);
    }
    if (literal.kind === 'not') negatives.add(stable(literal['condition']));
    else positives.add(stable(literal));
  }
  if (classes.size > 1) return `requires playerClass ${[...classes].join(' and ')} at once`;
  for (const negative of negatives) {
    if (positives.has(negative)) return 'requires a condition and its own negation';
  }
  return undefined;
}

/** Where a node's player-facing continuation can go: node ids, and whether it can leave the file. */
interface Step {
  readonly targets: readonly string[];
  readonly leaves: boolean;
}

function stepOf(node: DialogueNode): Step {
  const ids = (...items: (string | undefined)[]): string[] =>
    items.filter((t): t is string => t !== undefined);
  switch (node.kind) {
    case 'line':
      return { targets: ids(node.next), leaves: node.end === true };
    case 'effect':
      return { targets: ids(node.next, node.onFail), leaves: node.end === true };
    case 'choice': {
      const live = node.options.filter((o) => contradiction(o.when) === undefined);
      return {
        targets: live.flatMap((o) => ids(o.next, o.onFail)),
        leaves: live.some((o) => o.end === true),
      };
    }
    case 'branch':
      return {
        targets: [
          ...node.routes.filter((r) => contradiction(r.when) === undefined).map((r) => r.next),
          node.else,
        ],
        leaves: false,
      };
    case 'check':
      return { targets: [node.success, node.failure], leaves: false };
    case 'jump':
    case 'end':
      return { targets: [], leaves: true };
  }
}

/** The value of a key every caller has already checked exists. */
function must<V>(map: ReadonlyMap<string, V>, key: string): V {
  return map.get(key) as V;
}

/** Strongly connected components of the graph (Tarjan), each as node ids in file order. */
function components(
  order: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  const visit = (id: string): void => {
    const mine = index.size;
    index.set(id, mine);
    low.set(id, mine);
    stack.push(id);
    onStack.add(id);
    for (const to of must(edges, id)) {
      if (!index.has(to)) {
        visit(to);
        low.set(id, Math.min(must(low, id), must(low, to)));
      } else if (onStack.has(to)) {
        low.set(id, Math.min(must(low, id), must(index, to)));
      }
    }
    if (low.get(id) === mine) {
      const group = stack.splice(stack.lastIndexOf(id));
      for (const member of group) onStack.delete(member);
      found.push(order.filter((n) => group.includes(n)));
    }
  };
  for (const id of order) if (!index.has(id)) visit(id);
  return found;
}

/** A shortest path from `start` back to itself in a loop, as `[start, …, start]`. */
function cyclePath(start: string, edges: ReadonlyMap<string, readonly string[]>): string[] {
  const from = new Map<string, string>();
  const queue = [start];
  let last = start;
  search: for (const id of queue) {
    for (const to of must(edges, id)) {
      if (to === start) {
        last = id;
        break search;
      }
      if (!from.has(to)) {
        from.set(to, id);
        queue.push(to);
      }
    }
  }
  const path: string[] = [];
  for (let at = last; at !== start; at = must(from, at)) path.unshift(at);
  return [start, ...path, start];
}

/**
 * Graph checks of `dialogue`: unreachable nodes, steps that go nowhere, choices nobody can answer,
 * loops with no exit (errors), unsatisfiable single options and over-long text (warnings).
 */
export function validateDialogueGraph(
  dialogue: DialogueDef,
  options: DialogueGraphOptions,
): DialogueGraphReport {
  const errors: DialogueGraphIssue[] = [];
  const warnings: DialogueGraphIssue[] = [];
  const order = dialogue.nodes.map((n) => n.id);
  const steps = new Map(dialogue.nodes.map((n) => [n.id, stepOf(n)]));
  const edges = new Map(
    [...steps].map(([id, step]) => [id, step.targets.filter((to) => steps.has(to))]),
  );

  // AC-1: reachable from some entry (an entry whose condition can never hold starts nothing).
  const seen = new Set<string>();
  const pending = dialogue.entries
    .filter((e) => contradiction(e.when) === undefined)
    .map((e) => e.node);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (seen.has(id) || !steps.has(id)) continue;
    seen.add(id);
    pending.push(...must(edges, id));
  }
  dialogue.nodes.forEach((node, n) => {
    if (!seen.has(node.id)) {
      errors.push({
        pointer: `/nodes/${String(n)}`,
        code: 'unreachable-node',
        message: `node "${node.id}" is not reachable from any entry`,
      });
    }
  });

  dialogue.nodes.forEach((node, n) => {
    const at = `/nodes/${String(n)}`;
    // AC-2: every step continues or ends.
    if (
      (node.kind === 'line' || node.kind === 'effect') &&
      node.next === undefined &&
      node.end !== true
    ) {
      errors.push({
        pointer: at,
        code: 'missing-exit',
        message: `${node.kind} "${node.id}" has no \`next\` and is not marked \`end: true\``,
      });
    }
    if (node.kind === 'choice') {
      node.options.forEach((option, o) => {
        const here = `${at}/options/${String(o)}`;
        if (option.next === undefined && option.end !== true) {
          errors.push({
            pointer: here,
            code: 'missing-exit',
            message: `option "${option.id}" of "${node.id}" has no \`next\` and is not marked \`end: true\``,
          });
        }
        const why = contradiction(option.when);
        if (why !== undefined) {
          warnings.push({
            pointer: `${here}/when`,
            code: 'unsatisfiable-option',
            message: `option "${option.id}" of "${node.id}" can never be offered: ${why}`,
          });
        }
        checkLength(`option "${option.id}" of "${node.id}"`, `${here}/text`, option.text);
      });
      // AC-3: at least one option must be available in some world.
      const reasons = node.options.map((o) => contradiction(o.when));
      const first = reasons.find((r) => r !== undefined);
      if (first !== undefined && reasons.every((r) => r !== undefined)) {
        errors.push({
          pointer: at,
          code: 'unsatisfiable-choice',
          message: `choice "${node.id}" is unsatisfiable: every option has a condition that can never hold (${first})`,
        });
      }
    }
    if (node.kind === 'line') checkLength(`line "${node.id}"`, `${at}/text`, node.text);
  });

  function checkLength(what: string, pointer: string, text: string): void {
    const length = Array.from(text).length;
    if (length > options.maxTextLength) {
      warnings.push({
        pointer,
        code: 'text-too-long',
        message: `${what} is ${String(length)} characters, over the limit of ${String(options.maxTextLength)}`,
      });
    }
  }

  // AC-4: a loop (a component of two nodes or more, or a self-loop) needs a way out: a node that
  // ends or leaves the file, or a step to a node outside the loop.
  for (const group of components(order, edges)) {
    const members = new Set(group);
    const [first] = group as [string, ...string[]];
    const loops = group.length > 1 || must(edges, first).includes(first);
    const escapes = group.some(
      (id) => must(steps, id).leaves || must(edges, id).some((to) => !members.has(to)),
    );
    if (loops && !escapes) {
      const start = group.find((id) => seen.has(id)) ?? first;
      errors.push({
        pointer: `/nodes/${String(order.indexOf(start))}`,
        code: 'inescapable-cycle',
        message: `loop with no way out: ${cyclePath(start, edges).join(' -> ')}`,
      });
    }
  }
  return { errors, warnings };
}
