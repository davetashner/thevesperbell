// Validation of logic data (mw-e22.2, AC-3): shape per kind through the kind's zod schema, nesting
// depth, unknown kinds named with their path, and the optional content-reference hook. Paths look
// like `of[1].condition`; the root is the empty string.

import { z } from 'zod';
import { CONDITION_MAX_DEPTH } from '../facts/conditions';
import { logicRegistry } from './builtins';
import type { LogicRegistry } from './registry';
import type { LogicNode, LogicRef, LogicRefChecker } from './types';

/** `all`/`any`: every/some of the nested conditions hold. */
export interface LogicAllNode extends LogicNode {
  readonly kind: 'all' | 'any';
  readonly of: readonly LogicNode[];
}

/** `not`: the nested condition does not hold. */
export interface LogicNotNode extends LogicNode {
  readonly kind: 'not';
  readonly condition: LogicNode;
}

export interface LogicIssue {
  /** Where in the data, e.g. `of[1].condition`; empty for the root. */
  readonly path: string;
  readonly message: string;
}

export type LogicResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly LogicIssue[] };

export interface ValidateOptions {
  readonly registry?: LogicRegistry | undefined;
  /** Load-time reference hook: called for every item, quest, NPC, fact... a node names. */
  readonly references?: LogicRefChecker | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const join = (path: string, step: string): string =>
  path === '' || step.startsWith('[') ? `${path}${step}` : `${path}.${step}`;

/** A zod issue path (`['value']`, `['of', 1]`) appended to `path`. */
function zodPath(path: string, steps: readonly PropertyKey[]): string {
  return steps.reduce<string>(
    (acc, step) => join(acc, typeof step === 'number' ? `[${String(step)}]` : String(step)),
    path,
  );
}

class Walk {
  readonly issues: LogicIssue[] = [];

  constructor(
    private readonly registry: LogicRegistry,
    private readonly references: LogicRefChecker | undefined,
  ) {}

  private fail(path: string, message: string): LogicNode | undefined {
    this.issues.push({ path, message });
    return undefined;
  }

  /** Validates `data` against a kind's fields (everything but `kind`); the normalized node or undefined. */
  private fields(
    what: string,
    data: Record<string, unknown>,
    path: string,
    kind: string,
    schema: z.ZodType<object>,
    refs: ((node: never) => readonly LogicRef[]) | undefined,
  ): LogicNode | undefined {
    const rest = Object.fromEntries(Object.entries(data).filter(([name]) => name !== 'kind'));
    const parsed = schema.safeParse(rest);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        this.fail(zodPath(path, issue.path), `${what} "${kind}": ${issue.message}`);
      }
      return undefined;
    }
    const node = { kind, ...parsed.data };
    for (const ref of refs?.(node as never) ?? []) {
      const problem = this.references?.(ref);
      if (problem !== undefined) this.fail(path, `${what} "${kind}": ${problem}`);
    }
    return node;
  }

  condition(data: unknown, path: string, depth: number): LogicNode | undefined {
    if (depth > CONDITION_MAX_DEPTH) {
      return this.fail(path, `conditions nest at most ${String(CONDITION_MAX_DEPTH)} levels deep`);
    }
    if (!isRecord(data) || typeof data['kind'] !== 'string') {
      return this.fail(path, 'expected a condition object with a string "kind"');
    }
    const { kind } = data;
    if (kind === 'all' || kind === 'any') {
      return this.combinator(data, path, depth, kind);
    }
    if (kind === 'not') return this.negation(data, path, depth);
    const definition = this.registry.condition(kind);
    if (definition === undefined) {
      return this.fail(
        path,
        `unknown condition kind "${kind}" at ${path === '' ? 'the root' : path}`,
      );
    }
    return this.fields('condition', data, path, kind, definition.schema, definition.refs);
  }

  private combinator(
    data: Record<string, unknown>,
    path: string,
    depth: number,
    kind: 'all' | 'any',
  ): LogicNode | undefined {
    const extra = Object.keys(data).filter((key) => key !== 'kind' && key !== 'of');
    if (extra.length > 0) {
      return this.fail(path, `condition "${kind}": unrecognized key "${extra.join('", "')}"`);
    }
    const { of } = data;
    if (!Array.isArray(of) || of.length === 0) {
      return this.fail(join(path, 'of'), `condition "${kind}": "of" must be a non-empty list`);
    }
    const children = of.map((child, index) =>
      this.condition(child, join(path, `of[${String(index)}]`), depth + 1),
    );
    return children.every((child) => child !== undefined) ? { kind, of: children } : undefined;
  }

  private negation(
    data: Record<string, unknown>,
    path: string,
    depth: number,
  ): LogicNode | undefined {
    const extra = Object.keys(data).filter((key) => key !== 'kind' && key !== 'condition');
    if (extra.length > 0) {
      return this.fail(path, `condition "not": unrecognized key "${extra.join('", "')}"`);
    }
    const condition = this.condition(data['condition'], join(path, 'condition'), depth + 1);
    return condition === undefined ? undefined : { kind: 'not', condition };
  }

  effect(data: unknown, path: string): LogicNode | undefined {
    if (!isRecord(data) || typeof data['kind'] !== 'string') {
      return this.fail(path, 'expected an effect object with a string "kind"');
    }
    const { kind } = data;
    const definition = this.registry.effect(kind);
    if (definition === undefined) {
      return this.fail(path, `unknown effect kind "${kind}" at ${path}`);
    }
    return this.fields('effect', data, path, kind, definition.schema, definition.refs);
  }
}

function finish<T>(walk: Walk, value: T | undefined): LogicResult<T> {
  return value !== undefined && walk.issues.length === 0
    ? { ok: true, value }
    : { ok: false, issues: walk.issues };
}

/**
 * Validates one condition: shapes, kinds (built-in or registered), depth and, with
 * `options.references`, every content reference. The value is normalized (defaults filled in).
 */
export function validateLogicCondition(
  data: unknown,
  options: ValidateOptions = {},
): LogicResult<LogicNode> {
  const walk = new Walk(options.registry ?? logicRegistry, options.references);
  return finish(walk, walk.condition(data, '', 1));
}

/** Validates a list of effects (the batch applied together); paths start with `[index]`. */
export function validateLogicEffects(
  data: unknown,
  options: ValidateOptions = {},
): LogicResult<readonly LogicNode[]> {
  const walk = new Walk(options.registry ?? logicRegistry, options.references);
  if (!Array.isArray(data)) {
    walk.issues.push({ path: '', message: 'expected a list of effects' });
    return finish<readonly LogicNode[]>(walk, undefined);
  }
  const effects = data.map((item, index) => walk.effect(item, `[${String(index)}]`));
  return finish(walk, effects.every((e) => e !== undefined) ? effects : undefined);
}

/** A zod schema for a condition field of content, delegating to `validateLogicCondition`. */
export function logicConditionSchema(registry?: LogicRegistry, references?: LogicRefChecker) {
  return z.unknown().transform((data, ctx): LogicNode => {
    const result = validateLogicCondition(data, { registry, references });
    if (result.ok) return result.value;
    for (const issue of result.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: stepsOf(issue.path) });
    }
    return z.NEVER;
  });
}

/** A zod schema for an effect-list field of content, delegating to `validateLogicEffects`. */
export function logicEffectsSchema(registry?: LogicRegistry, references?: LogicRefChecker) {
  return z.unknown().transform((data, ctx): readonly LogicNode[] => {
    const result = validateLogicEffects(data, { registry, references });
    if (result.ok) return result.value;
    for (const issue of result.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: stepsOf(issue.path) });
    }
    return z.NEVER;
  });
}

/** `of[1].condition` → `['of', 1, 'condition']`. */
function stepsOf(path: string): PropertyKey[] {
  return [...path.matchAll(/\[(\d+)\]|([^.[\]]+)/g)].map((m) =>
    m[1] === undefined ? String(m[2]) : Number(m[1]),
  );
}
