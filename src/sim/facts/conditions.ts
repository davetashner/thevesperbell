// World-fact conditions (mw-e27.5): the one predicate language every system gates on — dialogue
// lines, quest stages, puzzle goals, shops, AI and level variants all ask "is the minotaur
// befriended and the cellar still open?" the same way, instead of each inventing its own.
//
// A condition is plain JSON (validated by the content schema, src/content/types/condition.ts, and
// again here so code-built conditions fail just as clearly):
//   { "fact": "horn.befriended" }                      a bool fact is true
//   { "fact": "quest.miller.stage", "gte": 3 }          compare: eq, neq, gt, gte, lt, lte
//   { "fact": "bell.rung-by", "has": true }             the fact holds a value (set or defaulted)
//   { "count": "entity:mine/*.looted", "gte": 3 }       how many entity facts matching are true
//   { "all": [...] }, { "any": [...] }, { "not": {...} } combinators
// and, for puzzle goals and anything else that reads the live world (mw-e15.2):
//   { "entities": { "tag": "brazier" }, "where": [{ "test": "element", "element": "fire" }],
//     "match": "all" }                                  property predicates over entities (all/any/none)
//   { "entities": {}, "where": [...], "inside": <shape>, "gte": 2 }   how many pass, and where they are
//   { "signal": "vault/gate", "port": "out" }           a signal graph node output is on
//   { "sustained": {...}, "seconds": 3 }                the condition has held for that long
// Compiling checks the shape, rejects nesting deeper than CONDITION_MAX_DEPTH, and extracts the
// condition's dependencies (the exact fact keys and count patterns it reads) so a watcher
// (`onConditionChanged`) only re-evaluates it when one of those facts changes. `explain` reports why
// a condition holds or not, node by node, for debug tools and designer error messages. Evaluation
// only reads the fact store, so it is deterministic and needs no clock or randomness. The language
// guide is docs/design/conditions.md.

import { factChanged, factTemplateOf, isFactKey, type FactChange, type FactValue } from './store';
import type { EntityId } from '../core/component';
import type { EventHandler, EventType } from '../core/events';
import { propertyChanged } from '../properties/components';
import { isWorldPropertyKey, PROPERTY_ID_PATTERN, type WorldPropertyKey } from '../properties/spec';
import {
  PREDICATE_OPS,
  FACINGS,
  SIGNAL_ELEMENTS,
  type SignalPredicate,
  type VolumeShape,
} from '../signals/graph';
import { predicateProperties, tagsChanged } from '../signals/filter';

/** The deepest a condition may nest (a lone leaf is depth 1; each all/any/not adds one). */
export const CONDITION_MAX_DEPTH = 64;

const SEGMENT = '[a-z0-9]+(?:-[a-z0-9]+)*';

/**
 * A count pattern: `entity:<level>/*.<fact>` counts one level's entities, `entity:*\/*.<fact>` every
 * level's. The content layer mirrors it (checked by tests/contracts/conditions.test.ts).
 */
export const COUNT_PATTERN = new RegExp(
  `^entity:(${SEGMENT}|\\*)/\\*\\.(${SEGMENT}(?:\\.${SEGMENT})*)$`,
);

/** Comparison operators, shared by fact and count conditions. */
export const CONDITION_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** A fact test. With no operator the fact must be `true`; with one, that comparison must hold. */
export interface FactCondition {
  readonly fact: string;
  readonly eq?: FactValue | undefined;
  readonly neq?: FactValue | undefined;
  readonly gt?: number | undefined;
  readonly gte?: number | undefined;
  readonly lt?: number | undefined;
  readonly lte?: number | undefined;
  /** True: the fact holds a value (set, or declared with a default); false: it holds none. */
  readonly has?: boolean | undefined;
}

/** How many entity facts matching `count` hold `true`, compared with exactly one operator. */
export interface CountCondition {
  readonly count: string;
  readonly eq?: number | undefined;
  readonly neq?: number | undefined;
  readonly gt?: number | undefined;
  readonly gte?: number | undefined;
  readonly lt?: number | undefined;
  readonly lte?: number | undefined;
}

/** True when every condition holds. */
export interface AllCondition {
  readonly all: readonly Condition[];
}

/** True when at least one condition holds. */
export interface AnyCondition {
  readonly any: readonly Condition[];
}

/** True when the condition does not hold. */
export interface NotCondition {
  readonly not: Condition;
}

/** Which entities an `entities` condition ranges over. Both fields given: both must hold. */
export interface EntitySelector {
  /** Entities carrying this tag (an `entity.tags` tag or a scene spawn's tag). */
  readonly tag?: string | undefined;
  /** The entity of this scene spawn id. */
  readonly entity?: string | undefined;
}

/** How many of the selected entities must pass `where` and `inside`. */
export const ENTITY_MATCHES = ['all', 'any', 'none'] as const;

export type EntityMatch = (typeof ENTITY_MATCHES)[number];

/**
 * Property predicates over entities. The selected entities (no selector fields: every entity with a
 * placement) are tested against every predicate of `where` and, when given, must stand `inside` the
 * volume (world coordinates). Then either `match` (`all`: at least one is selected and every one
 * passes; `any`: one passes; `none`: none passes) or exactly one operator over the number that pass.
 */
export interface EntitiesCondition {
  readonly entities: EntitySelector;
  readonly where?: readonly SignalPredicate[] | undefined;
  readonly inside?: VolumeShape | undefined;
  readonly match?: EntityMatch | undefined;
  readonly eq?: number | undefined;
  readonly neq?: number | undefined;
  readonly gt?: number | undefined;
  readonly gte?: number | undefined;
  readonly lt?: number | undefined;
  readonly lte?: number | undefined;
}

/** True while output `port` (default: the node's first) of node `signal` (`<graph>/<node>`) is on. */
export interface SignalCondition {
  readonly signal: string;
  readonly port?: string | undefined;
}

/** True once the condition has held, without a break, for `seconds` of sim time. */
export interface SustainedCondition {
  readonly sustained: Condition;
  readonly seconds: number;
}

/** A condition over world facts and the live world (see the header and docs/design/conditions.md). */
export type Condition =
  | FactCondition
  | CountCondition
  | AllCondition
  | AnyCondition
  | NotCondition
  | EntitiesCondition
  | SignalCondition
  | SustainedCondition;

/** What a condition reads: a fact store, or anything shaped like one. */
export interface FactReader {
  get(key: string): FactValue | undefined;
  entries(prefix?: string): readonly (readonly [string, FactValue])[];
}

/**
 * What the live leaves (`entities`, `signal`, `sustained`) read beyond facts: the world's entities,
 * signal outputs and clock. `worldLiveReader` (src/sim/facts/live.ts) reads a `World`; tests may pass
 * a stub. Without one those leaves are false.
 */
export interface LiveReader {
  /** The current sim tick and the tick rate. */
  readonly tick: number;
  readonly hz: number;
  /** Counts spawns, despawns and component adds/removes, so watchers can tell that entities changed. */
  readonly structure: number;
  /** Entities matching `selector`, in ascending id order. */
  select(selector: EntitySelector): readonly EntityId[];
  /** Whether `entity` passes every predicate and, if given, stands inside the volume. */
  passes(
    entity: EntityId,
    where: readonly SignalPredicate[],
    inside: VolumeShape | undefined,
  ): boolean;
  /** Whether output `port` (default: the first) of `node` in signal graph `graph` is on; false if absent. */
  signal(graph: string, node: string, port: string | undefined): boolean;
}

/** Per-watcher state of the stateful leaves (`sustained`); see `createConditionMemory`. */
export interface ConditionMemory {
  /** Node → tick its condition began holding, or null while it does not. */
  readonly since: Map<object, number | null>;
  /** The earliest tick a held `sustained` completes, as of the last evaluation (Infinity: none). */
  due: number;
}

/** Fresh memory for one watcher of a condition. */
export function createConditionMemory(): ConditionMemory {
  return { since: new Map(), due: Infinity };
}

/** Thrown for a malformed condition; the message names where in the condition the problem is. */
export class ConditionError extends Error {
  override readonly name = 'ConditionError';

  constructor(
    /** Where in the condition, e.g. `all[1].not`; empty for the root. */
    readonly path: string,
    detail: string,
  ) {
    super(`invalid condition${path === '' ? '' : ` at ${path}`}: ${detail}`);
  }
}

const KINDS = ['fact', 'count', 'all', 'any', 'not', 'entities', 'signal', 'sustained'] as const;

type Check = (value: unknown) => boolean;
const isInt: Check = (value) => Number.isSafeInteger(value);
const isFactValue: Check = (value) =>
  typeof value === 'boolean' || (typeof value === 'string' && value !== '') || isInt(value);

const FACT_OPERANDS: Readonly<Record<string, Check>> = {
  eq: isFactValue,
  neq: isFactValue,
  gt: isInt,
  gte: isInt,
  lt: isInt,
  lte: isInt,
  has: (value) => typeof value === 'boolean',
};

const COUNT_OPERANDS: Readonly<Record<string, Check>> = {
  eq: isInt,
  neq: isInt,
  gt: isInt,
  gte: isInt,
  lt: isInt,
  lte: isInt,
};

/** A graph/node reference of a `signal` condition, e.g. `vault/gate`. */
export const SIGNAL_REF = new RegExp(`^(${SEGMENT})/(${SEGMENT})$`);

/** The most `sustained` may ask for, seconds. */
export const SUSTAINED_MAX_SECONDS = 3600;

/** A value known to be present by construction (noUncheckedIndexedAccess can't see it). */
const known = <T>(value: T | undefined): T => value as T;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const join = (path: string, key: string): string => (path === '' ? key : `${path}.${key}`);

/** Checks a leaf's operators: known, well typed, at most one (exactly one when `required`). */
function checkOperators(
  node: Readonly<Record<string, unknown>>,
  kind: string,
  path: string,
  operands: Readonly<Record<string, Check>>,
  required: boolean,
): void {
  const operators = Object.keys(node).filter((key) => key !== kind);
  for (const op of operators) {
    const check = Object.hasOwn(operands, op) ? operands[op] : undefined;
    if (check === undefined) {
      throw new ConditionError(path, `"${op}" is not an operator of a ${kind} condition`);
    }
    if (!check(node[op])) {
      throw new ConditionError(join(path, op), `invalid operand ${JSON.stringify(node[op])}`);
    }
  }
  if (operators.length > 1) {
    throw new ConditionError(
      path,
      `a ${kind} condition takes one operator, got ${operators.join(', ')}`,
    );
  }
  if (required && operators.length === 0) {
    throw new ConditionError(path, `a ${kind} condition needs an operator (eq, gte…)`);
  }
}

/** Fails unless every key of `node` is one of `allowed`. */
function onlyKeys(
  node: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string,
  what: string,
): void {
  const extra = Object.keys(node).find((key) => !allowed.includes(key));
  if (extra !== undefined) throw new ConditionError(path, `"${extra}" is not a field of ${what}`);
}

const isFiniteNumber: Check = (value) => typeof value === 'number' && Number.isFinite(value);

/** Checks a record of finite numbers (`min` of 0 for sizes) under `path`. */
function checkNumbers(
  value: unknown,
  fields: readonly string[],
  path: string,
  nonNegative: readonly string[] = [],
): void {
  if (!isRecord(value))
    throw new ConditionError(path, `must be an object with ${fields.join(', ')}`);
  onlyKeys(value, fields, path, path.slice(path.lastIndexOf('.') + 1));
  for (const field of fields) {
    const number = value[field];
    if (!isFiniteNumber(number) || (nonNegative.includes(field) && (number as number) < 0)) {
      const kind = nonNegative.includes(field) ? 'a finite number ≥ 0' : 'a finite number';
      throw new ConditionError(join(path, field), `must be ${kind}, got ${JSON.stringify(number)}`);
    }
  }
}

const XYZ = ['x', 'y', 'z'];

/** Checks a volume shape: a box, sphere or capsule in world coordinates. */
function checkShape(shape: unknown, path: string): void {
  if (!isRecord(shape)) throw new ConditionError(path, 'a volume is an object with a kind');
  const kind = shape['kind'];
  const parts: Readonly<Record<string, readonly string[]>> = {
    box: ['center', 'halfExtents'],
    sphere: ['center', 'radius'],
    capsule: ['from', 'to', 'radius'],
  };
  const fields = typeof kind === 'string' && Object.hasOwn(parts, kind) ? parts[kind] : undefined;
  if (fields === undefined) {
    throw new ConditionError(
      join(path, 'kind'),
      `a volume is a box, sphere or capsule, not ${JSON.stringify(kind)}`,
    );
  }
  onlyKeys(shape, ['kind', ...fields], path, `a ${String(kind)} volume`);
  for (const field of fields) {
    const at = join(path, field);
    if (field === 'radius') {
      if (!isFiniteNumber(shape[field]) || (shape[field] as number) < 0) {
        throw new ConditionError(at, 'must be a finite number ≥ 0');
      }
    } else {
      checkNumbers(shape[field], XYZ, at, field === 'halfExtents' ? XYZ : []);
    }
  }
}

/** Checks one predicate of a `where` list. */
function checkPredicate(predicate: unknown, path: string): void {
  if (!isRecord(predicate)) throw new ConditionError(path, 'a predicate must be an object');
  const test = predicate['test'];
  if (test === 'property') {
    onlyKeys(predicate, ['test', 'property', 'op', 'value'], path, 'a property predicate');
    const { property, op, value } = predicate;
    if (typeof property !== 'string' || !isWorldPropertyKey(property)) {
      throw new ConditionError(
        join(path, 'property'),
        `${JSON.stringify(property)} is not a world property`,
      );
    }
    if (!(PREDICATE_OPS as readonly unknown[]).includes(op)) {
      throw new ConditionError(
        join(path, 'op'),
        `${JSON.stringify(op)} is not one of ${PREDICATE_OPS.join(', ')}`,
      );
    }
    const ordering = op !== 'eq' && op !== 'ne';
    const fits = ordering
      ? isFiniteNumber(value)
      : isFiniteNumber(value) || typeof value === 'boolean' || typeof value === 'string';
    if (!fits) {
      throw new ConditionError(join(path, 'value'), `invalid operand ${JSON.stringify(value)}`);
    }
  } else if (test === 'tag') {
    onlyKeys(predicate, ['test', 'tag'], path, 'a tag predicate');
    checkId(predicate['tag'], join(path, 'tag'), 'a tag');
  } else if (test === 'element') {
    onlyKeys(predicate, ['test', 'element'], path, 'an element predicate');
    if (!(SIGNAL_ELEMENTS as readonly unknown[]).includes(predicate['element'])) {
      throw new ConditionError(
        join(path, 'element'),
        `${JSON.stringify(predicate['element'])} is not one of ${SIGNAL_ELEMENTS.join(', ')}`,
      );
    }
  } else if (test === 'facing') {
    onlyKeys(predicate, ['test', 'facing'], path, 'a facing predicate');
    if (!(FACINGS as readonly unknown[]).includes(predicate['facing'])) {
      throw new ConditionError(
        join(path, 'facing'),
        `${JSON.stringify(predicate['facing'])} is not one of ${FACINGS.join(', ')}`,
      );
    }
  } else {
    throw new ConditionError(
      join(path, 'test'),
      `${JSON.stringify(test)} is not a predicate (property, tag, element or facing)`,
    );
  }
}

/** Fails unless `value` is a kebab-case id. */
function checkId(value: unknown, path: string, what: string): void {
  if (typeof value !== 'string' || !PROPERTY_ID_PATTERN.test(value)) {
    throw new ConditionError(path, `${JSON.stringify(value)} is not ${what} (a kebab-case id)`);
  }
}

/** Checks an `entities` leaf. */
function checkEntities(node: Readonly<Record<string, unknown>>, path: string): void {
  const operators = Object.keys(node).filter((key) =>
    (CONDITION_OPERATORS as readonly string[]).includes(key),
  );
  onlyKeys(
    node,
    ['entities', 'where', 'inside', 'match', ...CONDITION_OPERATORS],
    path,
    'an entities condition',
  );
  const selector = node['entities'];
  if (!isRecord(selector)) {
    throw new ConditionError(
      join(path, 'entities'),
      'must be an object: { tag }, { entity } or {}',
    );
  }
  const at = join(path, 'entities');
  onlyKeys(selector, ['tag', 'entity'], at, 'an entity selector');
  for (const key of ['tag', 'entity'] as const) {
    if (Object.hasOwn(selector, key)) checkId(selector[key], join(at, key), `a ${key}`);
  }
  if (Object.hasOwn(node, 'where')) {
    const where = node['where'];
    if (!Array.isArray(where))
      throw new ConditionError(join(path, 'where'), 'must be a list of predicates');
    where.forEach((predicate, i) => {
      checkPredicate(predicate, `${join(path, 'where')}[${String(i)}]`);
    });
  }
  if (Object.hasOwn(node, 'inside')) checkShape(node['inside'], join(path, 'inside'));
  const tests = operators.length + (Object.hasOwn(node, 'match') ? 1 : 0);
  if (tests !== 1) {
    throw new ConditionError(
      path,
      'an entities condition needs exactly one of match (all, any, none) or an operator (eq, gte…)',
    );
  }
  if (
    Object.hasOwn(node, 'match') &&
    !(ENTITY_MATCHES as readonly unknown[]).includes(node['match'])
  ) {
    throw new ConditionError(
      join(path, 'match'),
      `${JSON.stringify(node['match'])} is not one of ${ENTITY_MATCHES.join(', ')}`,
    );
  }
  for (const op of operators) {
    if (!isInt(node[op]))
      throw new ConditionError(join(path, op), `invalid operand ${JSON.stringify(node[op])}`);
  }
}

/** Checks a `signal` leaf. */
function checkSignal(node: Readonly<Record<string, unknown>>, path: string): void {
  onlyKeys(node, ['signal', 'port'], path, 'a signal condition');
  if (typeof node['signal'] !== 'string' || !SIGNAL_REF.test(node['signal'])) {
    throw new ConditionError(
      join(path, 'signal'),
      `${JSON.stringify(node['signal'])} is not a signal reference ("<graph>/<node>")`,
    );
  }
  if (Object.hasOwn(node, 'port')) checkId(node['port'], join(path, 'port'), 'a port');
}

/**
 * Checks a condition's shape without recursion (a hostile input cannot overflow the stack) and
 * returns its depth.
 * @throws ConditionError naming the first problem found.
 */
export function validateCondition(condition: unknown): number {
  const stack: { node: unknown; path: string; depth: number }[] = [
    { node: condition, path: '', depth: 1 },
  ];
  let deepest = 0;
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { node, path, depth } = item;
    if (depth > CONDITION_MAX_DEPTH) {
      throw new ConditionError(
        path,
        `nested more than ${String(CONDITION_MAX_DEPTH)} levels deep; split it into smaller conditions`,
      );
    }
    deepest = Math.max(deepest, depth);
    if (!isRecord(node)) throw new ConditionError(path, 'a condition must be an object');
    const kinds = KINDS.filter((kind) => Object.hasOwn(node, kind));
    const [kind] = kinds;
    if (kind === undefined || kinds.length > 1) {
      throw new ConditionError(
        path,
        `a condition has exactly one of ${KINDS.join(', ')}; got {${Object.keys(node).join(', ')}}`,
      );
    }
    if (kind === 'entities') {
      checkEntities(node, path);
    } else if (kind === 'signal') {
      checkSignal(node, path);
    } else if (kind === 'sustained') {
      onlyKeys(node, ['sustained', 'seconds'], path, 'a sustained condition');
      const { seconds } = node;
      if (
        !isFiniteNumber(seconds) ||
        (seconds as number) <= 0 ||
        (seconds as number) > SUSTAINED_MAX_SECONDS
      ) {
        throw new ConditionError(
          join(path, 'seconds'),
          `must be a number of seconds above 0 and at most ${String(SUSTAINED_MAX_SECONDS)}, got ${JSON.stringify(seconds)}`,
        );
      }
      stack.push({ node: node['sustained'], path: join(path, 'sustained'), depth: depth + 1 });
    } else if (kind === 'fact') {
      if (typeof node['fact'] !== 'string' || !isFactKey(node['fact'])) {
        throw new ConditionError(
          join(path, 'fact'),
          `${JSON.stringify(node['fact'])} is not a fact key`,
        );
      }
      checkOperators(node, kind, path, FACT_OPERANDS, false);
    } else if (kind === 'count') {
      if (typeof node['count'] !== 'string' || !COUNT_PATTERN.test(node['count'])) {
        throw new ConditionError(
          join(path, 'count'),
          `${JSON.stringify(node['count'])} is not a count pattern ("entity:<level>/*.<fact>" or "entity:*/*.<fact>")`,
        );
      }
      checkOperators(node, kind, path, COUNT_OPERANDS, true);
    } else {
      if (Object.keys(node).length > 1) {
        throw new ConditionError(path, `a ${kind} condition has no other fields`);
      }
      const children = node[kind];
      if (kind === 'not') {
        stack.push({ node: children, path: join(path, 'not'), depth: depth + 1 });
      } else if (!Array.isArray(children) || children.length === 0) {
        throw new ConditionError(join(path, kind), 'must be a non-empty list of conditions');
      } else {
        for (let i = children.length - 1; i >= 0; i--) {
          const at = `${join(path, kind)}[${String(i)}]`;
          stack.push({ node: children[i] as unknown, path: at, depth: depth + 1 });
        }
      }
    }
  }
  return deepest;
}

/** A count condition's pattern, parsed. */
interface CountPattern {
  /** Level id, or null for every level. */
  readonly level: string | null;
  /** The governing template, `entity:*.<fact>`. */
  readonly template: string;
}

function parsePattern(pattern: string): CountPattern {
  const [, level, name] = COUNT_PATTERN.exec(pattern) as unknown as [string, string, string];
  return { level: level === '*' ? null : level, template: `entity:*.${name}` };
}

const matches = (pattern: CountPattern, key: string): boolean =>
  factTemplateOf(key) === pattern.template &&
  (pattern.level === null || key.startsWith(`entity:${pattern.level}/`));

/** How many facts matching `pattern` hold `true`. */
function countTrue(facts: FactReader, pattern: CountPattern): number {
  const prefix = pattern.level === null ? 'entity:' : `entity:${pattern.level}/`;
  let count = 0;
  for (const [key, value] of facts.entries(prefix)) {
    if (value === true && matches(pattern, key)) count++;
  }
  return count;
}

const SYMBOLS: Readonly<Record<ConditionOperator, string>> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
};

function compare(
  op: ConditionOperator,
  actual: FactValue | undefined,
  expected: FactValue,
): boolean {
  if (op === 'eq') return actual === expected;
  if (op === 'neq') return actual !== expected;
  if (typeof actual !== 'number') return false;
  const bound = expected as number;
  switch (op) {
    case 'gt':
      return actual > bound;
    case 'gte':
      return actual >= bound;
    case 'lt':
      return actual < bound;
    case 'lte':
      return actual <= bound;
  }
}

/** The operator of a validated leaf, if it has one. */
function operatorOf(
  node: FactCondition | CountCondition | EntitiesCondition,
): ConditionOperator | undefined {
  return CONDITION_OPERATORS.find((op) => node[op] !== undefined);
}

const show = (value: FactValue | undefined): string =>
  value === undefined ? 'unset' : JSON.stringify(value);

const PREDICATE_SYMBOLS: Readonly<Record<(typeof PREDICATE_OPS)[number], string>> = {
  eq: '=',
  ne: '≠',
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
};

/** Readable text of one predicate, e.g. `weight ≥ 40`, `fire`, `tag player`. */
export function predicateText(predicate: SignalPredicate): string {
  switch (predicate.test) {
    case 'tag':
      return `tag ${predicate.tag}`;
    case 'element':
      return predicate.element;
    case 'facing':
      return `facing ${predicate.facing}`;
    case 'property':
      return `${predicate.property} ${PREDICATE_SYMBOLS[predicate.op]} ${String(predicate.value)}`;
  }
}

function shapeText(shape: VolumeShape): string {
  const at = (v: { x: number; y: number; z: number }) =>
    `${String(v.x)},${String(v.y)},${String(v.z)}`;
  switch (shape.kind) {
    case 'box':
      return `box(${at(shape.center)} ±${at(shape.halfExtents)})`;
    case 'sphere':
      return `sphere(${at(shape.center)} r${String(shape.radius)})`;
    case 'capsule':
      return `capsule(${at(shape.from)} → ${at(shape.to)} r${String(shape.radius)})`;
  }
}

function entitiesText(condition: EntitiesCondition): string {
  const { tag, entity } = condition.entities;
  const selector = [
    ...(tag === undefined ? [] : [`tag:${tag}`]),
    ...(entity === undefined ? [] : [`entity:${entity}`]),
  ];
  const where = (condition.where ?? []).map(predicateText);
  const parts = [
    selector.length === 0 ? 'any entity' : selector.join(' '),
    ...(where.length === 0 ? [] : [`where ${where.join(' and ')}`]),
    ...(condition.inside === undefined ? [] : [`inside ${shapeText(condition.inside)}`]),
  ];
  const op = operatorOf(condition);
  const test =
    op === undefined ? known(condition.match) : `count ${SYMBOLS[op]} ${String(condition[op])}`;
  return `entities(${parts.join(', ')}): ${test}`;
}

const seconds = (value: number): string => `${String(Math.round(value * 100) / 100)}s`;

/** Readable text of a condition, e.g. `all(fact(a), fact(b) ≥ 3)`, for logs and debug tools. */
export function conditionText(condition: Condition): string {
  if ('fact' in condition) {
    const op = operatorOf(condition);
    if (op !== undefined) {
      return `fact(${condition.fact}) ${SYMBOLS[op]} ${show(condition[op])}`;
    }
    if (condition.has !== undefined) {
      return `fact(${condition.fact}) is ${condition.has ? 'set' : 'unset'}`;
    }
    return `fact(${condition.fact})`;
  }
  if ('count' in condition) {
    const op = known(operatorOf(condition));
    return `count(${condition.count}) ${SYMBOLS[op]} ${String(condition[op])}`;
  }
  if ('entities' in condition) return entitiesText(condition);
  if ('signal' in condition) {
    return `signal(${condition.signal}${condition.port === undefined ? '' : `.${condition.port}`})`;
  }
  if ('sustained' in condition) {
    return `sustained(${conditionText(condition.sustained)}, ${seconds(condition.seconds)})`;
  }
  if ('not' in condition) return `not(${conditionText(condition.not)})`;
  const [kind, children] = 'all' in condition ? ['all', condition.all] : ['any', condition.any];
  return `${kind}(${children.map(conditionText).join(', ')})`;
}

/** Why a condition holds or not: one node per condition node, children in order. */
export interface ConditionExplanation {
  /** The node's text (see `conditionText`). */
  readonly text: string;
  readonly result: boolean;
  /** For a leaf, what it read, e.g. `horn.fate is "dead"`, `count is 2`. */
  readonly actual?: string;
  readonly children: readonly ConditionExplanation[];
}

/** What one evaluation reads. */
interface Context {
  readonly facts: FactReader;
  readonly live: LiveReader | undefined;
  readonly memory: ConditionMemory | undefined;
}

/** One node's evaluator and explainer. */
interface Node {
  evaluate(context: Context): boolean;
  explain(context: Context): ConditionExplanation;
}

function factNode(condition: FactCondition): Node {
  const { fact, has } = condition;
  const op = operatorOf(condition);
  const text = conditionText(condition);
  const test = (value: FactValue | undefined): boolean =>
    op !== undefined
      ? compare(op, value, known(condition[op]))
      : has !== undefined
        ? (value !== undefined) === has
        : value === true;
  return {
    evaluate: ({ facts }) => test(facts.get(fact)),
    explain: ({ facts }) => {
      const value = facts.get(fact);
      return { text, result: test(value), actual: `${fact} is ${show(value)}`, children: [] };
    },
  };
}

function countNode(condition: CountCondition, pattern: CountPattern): Node {
  const op = known(operatorOf(condition));
  const bound = known(condition[op]);
  const text = conditionText(condition);
  return {
    evaluate: ({ facts }) => compare(op, countTrue(facts, pattern), bound),
    explain: ({ facts }) => {
      const count = countTrue(facts, pattern);
      return {
        text,
        result: compare(op, count, bound),
        actual: `count is ${String(count)}`,
        children: [],
      };
    },
  };
}

const NO_WORLD = 'no live world to read';

function entitiesNode(condition: EntitiesCondition): Node {
  const { entities, inside } = condition;
  const where = condition.where ?? [];
  const op = operatorOf(condition);
  const bound = op === undefined ? 0 : known(condition[op]);
  const text = conditionText(condition);
  const tally = (live: LiveReader) => {
    const selected = live.select(entities);
    const passing = selected.filter((entity) => live.passes(entity, where, inside)).length;
    const holds =
      op !== undefined
        ? compare(op, passing, bound)
        : condition.match === 'all'
          ? selected.length > 0 && passing === selected.length
          : condition.match === 'any'
            ? passing > 0
            : passing === 0;
    return { holds, actual: `${String(passing)} of ${String(selected.length)} pass` };
  };
  return {
    evaluate: ({ live }) => live !== undefined && tally(live).holds,
    explain: ({ live }) => {
      if (live === undefined) return { text, result: false, actual: NO_WORLD, children: [] };
      const { holds, actual } = tally(live);
      return { text, result: holds, actual, children: [] };
    },
  };
}

/** The graph and node ids of a validated signal reference. */
const splitSignal = (ref: string): [string, string] =>
  (SIGNAL_REF.exec(ref) as unknown as [string, string, string]).slice(1) as [string, string];

function signalNode(condition: SignalCondition): Node {
  const [graph, node] = splitSignal(condition.signal);
  const text = conditionText(condition);
  const read = (live: LiveReader | undefined) => live?.signal(graph, node, condition.port) === true;
  return {
    evaluate: ({ live }) => read(live),
    explain: ({ live }) => {
      const on = read(live);
      return {
        text,
        result: on,
        actual: live === undefined ? NO_WORLD : `signal is ${on ? 'on' : 'off'}`,
        children: [],
      };
    },
  };
}

/** Ticks `seconds` last at `hz` (at least one). */
const ticksFor = (value: number, hz: number): number => Math.max(1, Math.round(value * hz));

function sustainedNode(condition: SustainedCondition, child: Node): Node {
  const text = conditionText(condition);
  return {
    evaluate: (context) => {
      const { live, memory } = context;
      // Always evaluated (never skipped by a short circuit), so the hold is tracked without gaps.
      const inner = child.evaluate(context);
      if (live === undefined || memory === undefined) return false;
      if (!inner) {
        memory.since.set(condition, null);
        return false;
      }
      const since = memory.since.get(condition) ?? live.tick;
      memory.since.set(condition, since);
      const due = since + ticksFor(condition.seconds, live.hz);
      if (live.tick >= due) return true;
      memory.due = Math.min(memory.due, due);
      return false;
    },
    explain: (context) => {
      const { live, memory } = context;
      const inner = child.explain(context);
      if (live === undefined || memory === undefined) {
        return { text, result: false, actual: NO_WORLD, children: [inner] };
      }
      const since = memory.since.get(condition);
      const held = inner.result && since !== undefined && since !== null ? live.tick - since : 0;
      const need = ticksFor(condition.seconds, live.hz);
      return {
        text,
        result: held >= need,
        actual: `held ${seconds(held / live.hz)} of ${seconds(need / live.hz)}`,
        children: [inner],
      };
    },
  };
}

function combinatorNode(
  condition: AllCondition | AnyCondition | NotCondition,
  children: Node[],
): Node {
  const text = conditionText(condition);
  const combine =
    'not' in condition
      ? (results: readonly boolean[]) => !results[0]
      : 'all' in condition
        ? (results: readonly boolean[]) => results.every(Boolean)
        : (results: readonly boolean[]) => results.some(Boolean);
  return {
    // No short circuit: every child is read, so a `sustained` below keeps its hold up to date.
    evaluate: (context) => combine(children.map((child) => child.evaluate(context))),
    explain: (context) => {
      // Explain every child, so the report shows all that fail.
      const explained = children.map((child) => child.explain(context));
      return { text, result: combine(explained.map((e) => e.result)), children: explained };
    },
  };
}

/** A signal output a condition reads. */
export interface SignalRef {
  readonly graph: string;
  readonly node: string;
  readonly port: string | undefined;
}

/** What a condition reads beyond facts, so a watcher knows what can change its result. */
export interface LiveDependencies {
  /** World properties its predicates read: a change to one can change the result. */
  readonly properties: readonly WorldPropertyKey[];
  /** Signal outputs it reads (sampled each tick). */
  readonly signals: readonly SignalRef[];
  /** Reads entity tags. */
  readonly tags: boolean;
  /** Depends on which entities exist (an entity selector). */
  readonly structure: boolean;
  /** Depends on where entities stand (an `inside` volume): re-checked every tick. */
  readonly spatial: boolean;
  /** Contains a `sustained`: its result can change as time passes. */
  readonly timed: boolean;
}

/** A validated condition ready to evaluate, with its dependencies. Build with `compileCondition`. */
export class CompiledCondition {
  /** The exact fact keys the condition reads, sorted. */
  readonly facts: readonly string[];
  /** The count patterns the condition reads, sorted. */
  readonly patterns: readonly string[];
  /** What it reads of the live world, if anything (see `LiveDependencies`). */
  readonly live: LiveDependencies;
  private readonly keys: ReadonlySet<string>;
  private readonly parsedPatterns: readonly CountPattern[];

  /** @internal Use `compileCondition`. */
  constructor(
    readonly condition: Condition,
    /** How deeply the condition nests (a leaf is 1). */
    readonly depth: number,
    private readonly root: Node,
    keys: ReadonlySet<string>,
    patterns: ReadonlySet<string>,
    live: LiveDependencies,
  ) {
    this.keys = keys;
    this.facts = Object.freeze([...keys].sort());
    this.patterns = Object.freeze([...patterns].sort());
    this.parsedPatterns = this.patterns.map(parsePattern);
    this.live = live;
  }

  /** True when the condition reads the live world (entities, signals or time), not only facts. */
  get isLive(): boolean {
    const { properties, signals, tags, structure, spatial, timed } = this.live;
    return properties.length > 0 || signals.length > 0 || tags || structure || spatial || timed;
  }

  /**
   * True when the condition holds for `facts` and, for the live leaves, `live`. A `sustained` needs
   * `memory` (one per watcher) to remember how long its condition has held; without it, it is false.
   */
  evaluate(facts: FactReader, live?: LiveReader, memory?: ConditionMemory): boolean {
    if (memory !== undefined) memory.due = Infinity;
    return this.root.evaluate({ facts, live, memory });
  }

  /** Node-by-node account of the result (see `formatExplanation`); reads, never updates, `memory`. */
  explain(facts: FactReader, live?: LiveReader, memory?: ConditionMemory): ConditionExplanation {
    return this.root.explain({ facts, live, memory });
  }

  /**
   * Every `sustained` node of the condition, in a fixed order (the node, then its operand, left to
   * right): the order a watcher saves and restores its holds in.
   */
  holdNodes(): readonly SustainedCondition[] {
    const found: SustainedCondition[] = [];
    const visit = (node: Condition): void => {
      if ('sustained' in node) {
        found.push(node);
        visit(node.sustained);
      } else if ('not' in node) visit(node.not);
      else if ('all' in node) node.all.forEach(visit);
      else if ('any' in node) node.any.forEach(visit);
    };
    visit(this.condition);
    return found;
  }

  /** True when a change to fact `key` can change the result. */
  dependsOn(key: string): boolean {
    return this.keys.has(key) || this.parsedPatterns.some((pattern) => matches(pattern, key));
  }

  /** The condition's readable text. */
  toString(): string {
    return conditionText(this.condition);
  }
}

/**
 * Validates `condition`, builds its evaluator and extracts its dependencies. Content conditions are
 * validated at load, so this only fails for code-built ones.
 * @throws ConditionError for a malformed condition or one nested deeper than CONDITION_MAX_DEPTH.
 */
export function compileCondition(condition: Condition): CompiledCondition {
  const depth = validateCondition(condition);
  const keys = new Set<string>();
  const patterns = new Set<string>();
  const properties = new Set<WorldPropertyKey>();
  const signals = new Map<string, SignalRef>();
  const flags = { tags: false, structure: false, spatial: false, timed: false };
  // Recursion is safe: validation capped the depth.
  const build = (node: Condition): Node => {
    if ('fact' in node) {
      keys.add(node.fact);
      return factNode(node);
    }
    if ('count' in node) {
      patterns.add(node.count);
      return countNode(node, parsePattern(node.count));
    }
    if ('entities' in node) {
      flags.structure = true;
      flags.spatial ||= node.inside !== undefined;
      flags.tags ||= node.entities.tag !== undefined;
      for (const predicate of node.where ?? []) {
        flags.tags ||= predicate.test === 'tag';
        // A body's facing changes with no property event: read it at every poll, like a position.
        flags.spatial ||= predicate.test === 'facing';
        predicateProperties(predicate).forEach((key) => properties.add(key));
      }
      return entitiesNode(node);
    }
    if ('signal' in node) {
      const [graph, name] = splitSignal(node.signal);
      signals.set(`${node.signal}.${node.port ?? ''}`, { graph, node: name, port: node.port });
      return signalNode(node);
    }
    if ('sustained' in node) {
      flags.timed = true;
      return sustainedNode(node, build(node.sustained));
    }
    const children = 'not' in node ? [node.not] : 'all' in node ? node.all : node.any;
    return combinatorNode(node, children.map(build));
  };
  const root = build(condition);
  const live: LiveDependencies = {
    properties: Object.freeze([...properties].sort()),
    signals: Object.freeze([...signals.values()]),
    ...flags,
  };
  return new CompiledCondition(condition, depth, root, keys, patterns, live);
}

/** Plain text of an explanation, one line per node: `✓`/`✗`, the node, what it read; indented. */
export function formatExplanation(explanation: ConditionExplanation, indent = ''): string {
  const actual = explanation.actual === undefined ? '' : ` (${explanation.actual})`;
  const line = `${indent}${explanation.result ? '✓' : '✗'} ${explanation.text}${actual}`;
  return [line, ...explanation.children.map((c) => formatExplanation(c, `${indent}  `))].join('\n');
}

/** What `onConditionChanged` needs from a world. */
export interface ConditionHost {
  readonly facts: FactReader;
  readonly events: {
    on<T>(type: EventType<T>, handler: EventHandler<T>): () => void;
  };
  /** What the live leaves read (`worldLiveReader`); absent: they are false. */
  readonly live?: LiveReader | undefined;
}

/** Called with the condition's new result and the fact change that caused it (null: a live change, `poll` or `refresh`). */
export type ConditionCallback = (value: boolean, cause: FactChange | null) => void;

/** A live watch on a condition (see `onConditionChanged`). */
export interface ConditionSubscription {
  /** The result as of the last evaluation. */
  readonly value: boolean;
  /** The compiled condition being watched. */
  readonly condition: CompiledCondition;
  /**
   * Re-evaluates now and calls back if the result changed. Restoring a snapshot changes facts
   * without events, so call this after `World.restore`. Returns the current result.
   */
  refresh(): boolean;
  /**
   * Node-by-node account of why the condition holds or not now, including how long each `sustained`
   * hold has lasted (what `CompiledCondition.explain` cannot know without the watcher's memory).
   */
  explain(): ConditionExplanation;
  /**
   * The tick each `sustained` hold of the condition began (null: not holding), in
   * `CompiledCondition.holdNodes` order; empty when it has none. Saved with the game so a hold that
   * was half done keeps its progress (mw-e15.3).
   */
  holds(): readonly (number | null)[];
  /**
   * Resumes the holds `holds()` returned, e.g. after `World.restore`; call `refresh` after. Returns
   * false and changes nothing when `saved` does not fit this condition's `sustained` nodes.
   */
  restoreHolds(saved: readonly (number | null)[]): boolean;
  /**
   * Call once per tick after the systems have run. Re-evaluates only what events cannot announce:
   * a signal output it reads changed, entities were spawned or removed, an `inside` volume (checked
   * every tick), or a `sustained` hold came due. Cheap when none applies. Returns the current result.
   */
  poll(): boolean;
  /** Stops watching; the callback is never called again. */
  unsubscribe(): void;
}

/**
 * Watches `condition` on `world`: evaluates it now, then re-evaluates it whenever something it
 * depends on changes and calls `callback` exactly once per change of result. Facts and world
 * properties (and tags) announce changes by event, delivered at the next phase boundary; signal
 * outputs, entity existence, positions and elapsed time are checked by `poll`. Changes batched in a
 * transaction arrive as several events, but the callback runs once, when the result first differs.
 * Unrelated changes never evaluate the condition.
 * @throws ConditionError for a malformed condition.
 */
export function onConditionChanged(
  world: ConditionHost,
  condition: Condition | CompiledCondition,
  callback: ConditionCallback,
): ConditionSubscription {
  const compiled = condition instanceof CompiledCondition ? condition : compileCondition(condition);
  const { live } = world;
  const { live: needs } = compiled;
  const memory = needs.timed ? createConditionMemory() : undefined;
  const read = () => compiled.evaluate(world.facts, live, memory);
  let value = read();
  let active = true;
  const update = (cause: FactChange | null): boolean => {
    const next = read();
    if (next !== value) {
      value = next;
      if (active) callback(next, cause);
    }
    return next;
  };
  const offs = [
    world.events.on(factChanged, (change) => {
      if (compiled.dependsOn(change.key)) update(change);
    }),
  ];
  if (needs.properties.length > 0) {
    offs.push(
      world.events.on(propertyChanged, ({ key }) => {
        if (needs.properties.includes(key)) update(null);
      }),
    );
  }
  if (needs.tags) offs.push(world.events.on(tagsChanged, () => update(null)));
  const sampleSignals = (): string =>
    needs.signals.map((s) => (live?.signal(s.graph, s.node, s.port) === true ? '1' : '0')).join('');
  let structure = live?.structure;
  let sample = sampleSignals();
  return {
    get value() {
      return value;
    },
    condition: compiled,
    refresh: () => update(null),
    explain: () => compiled.explain(world.facts, live, memory),
    holds: () => {
      const nodes = compiled.holdNodes();
      return nodes.map((node) => memory?.since.get(node) ?? null);
    },
    restoreHolds: (saved) => {
      const nodes = compiled.holdNodes();
      if (memory === undefined || saved.length !== nodes.length) return false;
      nodes.forEach((node, i) => memory.since.set(node, known(saved[i])));
      return true;
    },
    poll: () => {
      if (live === undefined) return value;
      const moved = needs.structure && live.structure !== structure;
      const signalled = sampleSignals();
      const due =
        moved ||
        needs.spatial ||
        signalled !== sample ||
        (memory !== undefined && live.tick >= memory.due);
      structure = live.structure;
      sample = signalled;
      return due ? update(null) : value;
    },
    unsubscribe: () => {
      active = false;
      for (const off of offs) off();
    },
  };
}
