// Load-time condition checks (mw-e27.5): a condition is only as good as the facts it names. After
// every file has parsed, each condition in content is checked against the fact registry: every fact
// it tests is declared (exactly or by an `entity:*` template), every count pattern names a declared
// bool template, and every operator suits the fact's type (a bare test or `true`/`false` needs a
// bool, `gte` an int or tick, an enum value is one of its values). Issues name the file, the JSON
// pointer and the problem. Each content type with condition fields registers where they are in
// CONDITION_USAGES: named conditions, puzzle goals (mw-e15.1), unlock requirements (mw-e19.3) and
// loot-table entry conditions (mw-e18.1) and respawn rules (mw-e01.8) today; dialogue (mw-e22) and quests (mw-e23) add a line.

import { factIndex, lookupFact, type FactIndex } from './fact-checks.ts';
import type { ContentCheck, ContentIssue, Frozen } from './loader.ts';
import { CONTENT_ID_PATTERN } from './schema.ts';
import {
  CONDITION_OPERATORS,
  COUNT_PATTERN,
  type Condition,
  SIGNAL_REF,
  type CountCondition,
  type FactCondition,
  type SignalCondition,
  type NamedCondition,
} from './types/condition.ts';
import type { FactDef, FactGroup } from './types/fact.ts';
import type { LootTable } from './types/loot-table.ts';
import type { Puzzle } from './types/puzzle.ts';
import type { RespawnRules } from './types/respawn-rules.ts';
import type { SceneDef } from './types/scene.ts';
import { signalPorts, type SignalGraphEntry } from './types/signal-graph.ts';
import type { UnlockGroup } from './types/unlock.ts';
import type { WorldMap } from './types/world.ts';

/** One condition in a content entry. */
export interface ConditionUsage {
  /** JSON pointer to the condition in the entry's file. */
  readonly pointer: string;
  readonly condition: Frozen<Condition>;
}

/** Content type → the conditions one of its entries holds. */
export const CONDITION_USAGES: Readonly<
  Record<string, (entry: never) => readonly ConditionUsage[]>
> = {
  condition: (entry: NamedCondition) => [{ pointer: '/when', condition: entry.when }],
  'loot-table': (entry: LootTable) =>
    entry.entries.flatMap(({ conditions }, i) =>
      conditions?.when === undefined
        ? []
        : [{ pointer: `/entries/${String(i)}/conditions/when`, condition: conditions.when }],
    ),
  puzzle: (entry: Puzzle) => [{ pointer: '/goal', condition: entry.goal }],
  // A rule's conditions, and each fact it writes as `{ fact, eq: value }` (declared, value fits).
  'respawn-rules': (entry: RespawnRules) =>
    entry.rules.flatMap(({ conditions, factsToSet }, i) => [
      ...(conditions === undefined
        ? []
        : [{ pointer: `/rules/${String(i)}/conditions`, condition: conditions }]),
      ...factsToSet.map(({ fact, value }, f) => ({
        pointer: `/rules/${String(i)}/factsToSet/${String(f)}`,
        condition: { fact, eq: value },
      })),
    ]),
  // A spawn's gates and variants (mw-e27.8).
  scene: (entry: SceneDef) =>
    entry.spawns.flatMap((spawn, i) => {
      const base = `/spawns/${String(i)}`;
      return [
        ...(spawn.spawnIf === undefined
          ? []
          : [{ pointer: `${base}/spawnIf`, condition: spawn.spawnIf }]),
        ...(spawn.despawnIf === undefined
          ? []
          : [{ pointer: `${base}/despawnIf`, condition: spawn.despawnIf }]),
        ...(spawn.variant?.when === undefined
          ? []
          : [{ pointer: `${base}/variant/when`, condition: spawn.variant.when }]),
      ];
    }),
  world: (entry: WorldMap) =>
    entry.edges.flatMap(({ unlock }, i) =>
      unlock === undefined ? [] : [{ pointer: `/edges/${String(i)}/unlock`, condition: unlock }],
    ),
  unlock: (entry: UnlockGroup) =>
    entry.unlocks.flatMap(({ requirements }, i) =>
      requirements === undefined
        ? []
        : [{ pointer: `/unlocks/${String(i)}/requirements`, condition: requirements }],
    ),
};

/** A problem in a condition, at a JSON pointer relative to the condition. */
export interface ConditionProblem {
  readonly pointer: string;
  readonly message: string;
}

/** A value known to be present by construction (noUncheckedIndexedAccess can't see it). */
const known = <T>(value: T | null | undefined): T => value as T;

const NUMERIC_TYPES = new Set(['int', 'tick']);

/** What is wrong with testing `def` the way `leaf` does, if anything. */
function factProblem(leaf: Frozen<FactCondition>, def: Frozen<FactDef>): string | undefined {
  const op = CONDITION_OPERATORS.find((o) => leaf[o] !== undefined);
  const { type } = def;
  if (op === undefined) {
    return leaf.has !== undefined || type === 'bool'
      ? undefined
      : `a bare fact test needs a bool fact; "${leaf.fact}" is ${type}: add an operator`;
  }
  const value = leaf[op];
  if (op !== 'eq' && op !== 'neq') {
    return NUMERIC_TYPES.has(type)
      ? undefined
      : `"${op}" needs an int or tick fact; "${leaf.fact}" is ${type}`;
  }
  const fits =
    type === 'bool'
      ? typeof value === 'boolean'
      : NUMERIC_TYPES.has(type)
        ? typeof value === 'number' && (type === 'int' || value >= 0)
        : type === 'enum'
          ? def.values.includes(value as string)
          : typeof value === 'string' && CONTENT_ID_PATTERN.test(value);
  const expected = type === 'enum' ? `one of ${def.values.join(', ')}` : `a ${type}`;
  return fits
    ? undefined
    : `"${leaf.fact}" is ${type}: ${JSON.stringify(value)} is not ${expected}`;
}

function countProblem(leaf: Frozen<CountCondition>, index: FactIndex): string | undefined {
  const name = known(known(COUNT_PATTERN.exec(leaf.count))[2]);
  const template = `entity:*.${name}`;
  const def = index.get(template);
  if (def === undefined) {
    return `counts undeclared fact template "${template}": declare it in src/content/data/fact/`;
  }
  return def.type === 'bool' ? undefined : `counts "${template}", which is ${def.type}, not bool`;
}

/** Signal graph id → its node ids → their output ports, for checking `signal` conditions. */
export type SignalIndex = ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;

/** The signal graphs of `graphs` as a `SignalIndex`. */
export function signalIndex(graphs: readonly Frozen<SignalGraphEntry>[]): SignalIndex {
  return new Map(
    graphs.map((graph) => [
      graph.id,
      new Map(graph.nodes.map((node) => [node.id, signalPorts(node).outputs])),
    ]),
  );
}

/** What is wrong with a `signal` leaf, if anything (checked only when a signal index is given). */
function signalProblem(leaf: Frozen<SignalCondition>, signals: SignalIndex | undefined) {
  if (signals === undefined) return undefined;
  const [graph, node] = known(SIGNAL_REF.exec(leaf.signal)).slice(1) as [string, string];
  const nodes = signals.get(graph);
  if (nodes === undefined) {
    return `reads signal graph "${graph}", which does not exist: add it to src/content/data/signal-graph/`;
  }
  const ports = nodes.get(node);
  if (ports === undefined)
    return `reads node "${node}", which signal graph "${graph}" does not have`;
  if (leaf.port !== undefined && !ports.includes(leaf.port)) {
    return `reads port "${leaf.port}", which node "${graph}/${node}" does not have (${ports.join(', ')})`;
  }
  return undefined;
}

/**
 * Every problem with `condition` against the fact registry `index`, with JSON pointers relative to
 * the condition (walked without recursion; the schema already capped the depth).
 */
export function conditionProblems(
  condition: Frozen<Condition>,
  index: FactIndex,
  signals?: SignalIndex,
): ConditionProblem[] {
  const problems: ConditionProblem[] = [];
  const stack: { node: Frozen<Condition>; pointer: string }[] = [{ node: condition, pointer: '' }];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { node, pointer } = item;
    if ('fact' in node) {
      const def = lookupFact(index, node.fact);
      const message =
        def === undefined
          ? `names undeclared fact "${node.fact}": declare it in src/content/data/fact/`
          : factProblem(node, def);
      if (message !== undefined) problems.push({ pointer: `${pointer}/fact`, message });
    } else if ('count' in node) {
      const message = countProblem(node, index);
      if (message !== undefined) problems.push({ pointer: `${pointer}/count`, message });
    } else if ('entities' in node) {
      // Property, tag and element predicates are checked by the schema; nothing reads facts.
    } else if ('signal' in node) {
      const message = signalProblem(node, signals);
      if (message !== undefined) problems.push({ pointer: `${pointer}/signal`, message });
    } else if ('sustained' in node) {
      stack.push({ node: node.sustained, pointer: `${pointer}/sustained` });
    } else if ('not' in node) {
      stack.push({ node: node.not, pointer: `${pointer}/not` });
    } else {
      const [kind, children] = 'all' in node ? ['all', node.all] : ['any', node.any];
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({
          node: known(children[i]),
          pointer: `${pointer}/${kind}/${String(i)}`,
        });
      }
    }
  }
  return problems;
}

/** Every scene spawn an `entities` leaf names (`entities.entity`), with its JSON pointer. */
export function conditionEntityRefs(
  condition: Frozen<Condition>,
): { readonly pointer: string; readonly entity: string }[] {
  const refs: { pointer: string; entity: string }[] = [];
  const stack: { node: Frozen<Condition>; pointer: string }[] = [{ node: condition, pointer: '' }];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { node, pointer } = item;
    if ('entities' in node) {
      const { entity } = node.entities;
      if (entity !== undefined) refs.push({ pointer: `${pointer}/entities/entity`, entity });
    } else if ('sustained' in node) {
      stack.push({ node: node.sustained, pointer: `${pointer}/sustained` });
    } else if ('not' in node) {
      stack.push({ node: node.not, pointer: `${pointer}/not` });
    } else if ('all' in node || 'any' in node) {
      const [kind, children] = 'all' in node ? ['all', node.all] : ['any', node.any];
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ node: known(children[i]), pointer: `${pointer}/${kind}/${String(i)}` });
      }
    }
  }
  return refs;
}

/** The content check for conditions: every condition in content names declared facts, used right. */
export const checkConditions: ContentCheck = (entries) => {
  const index = factIndex(
    entries.filter((entry) => entry.type === 'fact').map((entry) => entry.value as FactGroup),
  );
  const signals = signalIndex(
    entries
      .filter((entry) => entry.type === 'signal-graph')
      .map((entry) => entry.value as SignalGraphEntry),
  );
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    const usages = Object.hasOwn(CONDITION_USAGES, type) ? CONDITION_USAGES[type] : undefined;
    for (const usage of usages?.(value as never) ?? []) {
      for (const { pointer, message } of conditionProblems(usage.condition, index, signals)) {
        issues.push({
          file,
          pointer: `${usage.pointer}${pointer}`,
          message: `${type}:${value.id} ${message}`,
        });
      }
    }
  }
  return issues;
};
