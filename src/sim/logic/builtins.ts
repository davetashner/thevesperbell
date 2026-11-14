// The built-in condition and effect kinds (mw-e22.2). Fact conditions delegate to the shared
// condition API (src/sim/facts/conditions.ts, mw-e27.5) instead of being a second implementation:
// `fact` and `factCmp` build the equivalent fact condition, compile it once and evaluate it over the
// context's facts.

import { z } from 'zod';
import { compileCondition, type CompiledCondition, type Condition } from '../facts/conditions';
import { isFactKey } from '../facts/store';
import { LogicRegistry } from './registry';
import {
  LOGIC_OBJECTIVE_STATES,
  LOGIC_QUEST_STATES,
  type LogicContext,
  type LogicNode,
  type LogicRef,
} from './types';

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:[.:][a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const id = z.string().regex(ID_PATTERN, 'expected a lowercase content id such as "key-a"');
const factKey = z.string().refine(isFactKey, 'expected a fact key such as "door.open"');
const factValue = z.union([z.boolean(), z.int(), z.string().min(1)]);
const count = z.int().min(1).default(1);
const clock = z.string().regex(CLOCK_PATTERN, 'expected a time such as "21:30"');

/** The event a `deliverItem` effect emits (data: `item`, `npc`, `count`). */
export const ITEM_DELIVERED_EVENT = 'item-delivered';

export const LOGIC_COMPARISONS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;
export type LogicComparison = (typeof LOGIC_COMPARISONS)[number];
const comparison = z.enum(LOGIC_COMPARISONS);

const COMPARERS: Readonly<Record<LogicComparison, (a: number, b: number) => boolean>> = {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
};

/** Compares `actual` with `expected` by `op`. */
export function compareNumbers(op: LogicComparison, actual: number, expected: number): boolean {
  return COMPARERS[op](actual, expected);
}

const compiled = new WeakMap<object, CompiledCondition>();

/** The shared-API evaluation of a fact condition built from `node`, compiled once per node. */
function evaluateFact(node: object, build: () => Condition, context: LogicContext): boolean {
  let condition = compiled.get(node);
  if (condition === undefined) {
    condition = compileCondition(build());
    compiled.set(node, condition);
  }
  return condition.evaluate(context.facts);
}

const ref = (type: string, value: string): LogicRef => ({ type, id: value });

type Fields<S extends z.ZodType> = z.output<S> & LogicNode;

const factCmpSchema = z
  .strictObject({ fact: factKey, op: comparison, value: factValue })
  .superRefine((node, issues) => {
    if (node.op !== 'eq' && node.op !== 'neq' && typeof node.value !== 'number') {
      issues.addIssue({
        code: 'custom',
        path: ['value'],
        message: `"${node.op}" compares numbers`,
      });
    }
  });

const timeWindowSchema = z.strictObject({ from: clock, to: clock });

/** Minutes since midnight of an `HH:MM` string (validated by the schema). */
function minutesOf(text: string): number {
  return Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
}

/** Registers the built-in kinds of the bead's vocabulary into `registry`. */
export function registerLogicBuiltins(registry: LogicRegistry): void {
  const factSchema = z.strictObject({ fact: factKey });
  registry.registerCondition({
    kind: 'fact',
    schema: factSchema,
    evaluate: (node, context) => evaluateFact(node, () => ({ fact: node.fact }), context),
    refs: (node) => [ref('fact', node.fact)],
  });
  registry.registerCondition({
    kind: 'factCmp',
    schema: factCmpSchema,
    evaluate: (node: Fields<typeof factCmpSchema>, context) =>
      evaluateFact(node, () => ({ fact: node.fact, [node.op]: node.value }), context),
    refs: (node) => [ref('fact', node.fact)],
  });
  registry.registerCondition({
    kind: 'hasItem',
    schema: z.strictObject({ item: id, count }),
    evaluate: (node, context) => context.itemCount(node.item) >= node.count,
    refs: (node) => [ref('item', node.item)],
  });
  registry.registerCondition({
    kind: 'hasCapability',
    schema: z.strictObject({ capability: id }),
    evaluate: (node, context) => context.hasCapability(node.capability),
    refs: (node) => [ref('capability', node.capability)],
  });
  registry.registerCondition({
    kind: 'playerClass',
    schema: z.strictObject({ class: id }),
    evaluate: (node, context) => context.playerClass() === node.class,
    refs: (node) => [ref('class', node.class)],
  });
  registry.registerCondition({
    kind: 'disposition',
    schema: z.strictObject({ npc: id, op: comparison, value: z.int() }),
    evaluate: (node, context) => compareNumbers(node.op, context.disposition(node.npc), node.value),
    refs: (node) => [ref('npc', node.npc)],
  });
  registry.registerCondition({
    kind: 'questState',
    schema: z.strictObject({ quest: id, state: z.enum(LOGIC_QUEST_STATES) }),
    evaluate: (node, context) => context.questState(node.quest) === node.state,
    refs: (node) => [ref('quest', node.quest)],
  });
  registry.registerCondition({
    kind: 'objectiveState',
    schema: z.strictObject({ quest: id, objective: id, state: z.enum(LOGIC_OBJECTIVE_STATES) }),
    evaluate: (node, context) => context.objectiveState(node.quest, node.objective) === node.state,
    refs: (node) => [ref('quest', node.quest), ref('objective', `${node.quest}/${node.objective}`)],
  });
  registry.registerCondition({
    kind: 'gold',
    schema: z.strictObject({ op: comparison, value: z.int().min(0) }),
    evaluate: (node, context) => compareNumbers(node.op, context.gold(), node.value),
  });
  registry.registerCondition({
    kind: 'timeOfDay',
    schema: timeWindowSchema,
    // From inclusive, to exclusive; a window that wraps midnight (22:00 to 04:00) is allowed.
    evaluate: (node, context) => {
      const now = context.minuteOfDay();
      const from = minutesOf(node.from);
      const to = minutesOf(node.to);
      return from < to ? now >= from && now < to : now >= from || now < to;
    },
  });

  registry.registerEffect({
    kind: 'setFact',
    schema: z.strictObject({ fact: factKey, value: factValue }),
    apply: (node, host) => host.setFact(node.fact, node.value),
    refs: (node) => [ref('fact', node.fact)],
  });
  registry.registerEffect({
    kind: 'giveItem',
    schema: z.strictObject({ item: id, count }),
    apply: (node, host) => host.giveItem(node.item, node.count),
    refs: (node) => [ref('item', node.item)],
  });
  registry.registerEffect({
    kind: 'takeItem',
    schema: z.strictObject({ item: id, count }),
    apply: (node, host) => host.takeItem(node.item, node.count),
    refs: (node) => [ref('item', node.item)],
  });
  registry.registerEffect({
    kind: 'deliverItem',
    schema: z.strictObject({ item: id, npc: id, count }),
    // Takes the stack from the player (refusing when it is not there, so the batch changes nothing)
    // and announces the hand-over once the batch committed: `deliverItem` quest objectives (mw-e23.3)
    // complete on it. Pair it with `hasItem` on the option so it reads as unavailable without the item.
    apply: (node, host, defer) => {
      const refused = host.takeItem(node.item, node.count);
      if (refused !== undefined) return refused;
      defer(() => {
        host.emit(ITEM_DELIVERED_EVENT, { item: node.item, npc: node.npc, count: node.count });
      });
      return undefined;
    },
    refs: (node) => [ref('item', node.item), ref('npc', node.npc)],
  });
  registry.registerEffect({
    kind: 'gold',
    schema: z.strictObject({ delta: z.int().refine((n) => n !== 0, 'expected a non-zero amount') }),
    apply: (node, host) => host.adjustGold(node.delta),
  });
  registry.registerEffect({
    kind: 'disposition',
    schema: z.strictObject({
      npc: id,
      delta: z.int().refine((n) => n !== 0, 'expected a non-zero amount'),
    }),
    apply: (node, host) => host.adjustDisposition(node.npc, node.delta),
    refs: (node) => [ref('npc', node.npc)],
  });
  registry.registerEffect({
    kind: 'startQuest',
    schema: z.strictObject({ quest: id }),
    apply: (node, host) => host.startQuest(node.quest),
    refs: (node) => [ref('quest', node.quest)],
  });
  registry.registerEffect({
    kind: 'completeObjective',
    schema: z.strictObject({ quest: id, objective: id }),
    apply: (node, host) => host.completeObjective(node.quest, node.objective),
    refs: (node) => [ref('quest', node.quest), ref('objective', `${node.quest}/${node.objective}`)],
  });
  registry.registerEffect({
    kind: 'resolveQuest',
    schema: z.strictObject({ quest: id, resolution: id.optional() }),
    apply: (node, host) => host.resolveQuest(node.quest, node.resolution),
    refs: (node) => [ref('quest', node.quest)],
  });
  registry.registerEffect({
    kind: 'failQuest',
    schema: z.strictObject({ quest: id }),
    apply: (node, host) => host.failQuest(node.quest),
    refs: (node) => [ref('quest', node.quest)],
  });
  registry.registerEffect({
    kind: 'learnCapability',
    schema: z.strictObject({ capability: id }),
    apply: (node, host) => host.learnCapability(node.capability),
    refs: (node) => [ref('capability', node.capability)],
  });
  registry.registerEffect({
    kind: 'emit',
    schema: z.strictObject({
      event: id,
      data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    }),
    apply: (node, host, defer) => {
      defer(() => {
        host.emit(node.event, node.data);
      });
      return undefined;
    },
  });
  registry.registerEffect({
    kind: 'revealRumor',
    schema: z.strictObject({ rumor: id }),
    apply: (node, host, defer) => {
      defer(() => {
        host.revealRumor(node.rumor);
      });
      return undefined;
    },
    refs: (node) => [ref('rumor', node.rumor)],
  });
}

/** A fresh registry holding only the built-in kinds (tests, tools; extensions register on it). */
export function createLogicRegistry(): LogicRegistry {
  const registry = new LogicRegistry();
  registerLogicBuiltins(registry);
  return registry;
}

/** The shared registry the game's content loaders and runtimes use; other epics extend it. */
export const logicRegistry: LogicRegistry = createLogicRegistry();
