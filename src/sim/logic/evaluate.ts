// Pure evaluation and description of logic conditions (mw-e22.2). Evaluation reads only the
// `LogicContext` it is given: no clock, randomness or hidden state, so the same context always
// gives the same answer.

import { logicRegistry } from './builtins';
import type { LogicAllNode, LogicNotNode } from './validate';
import type { LogicRegistry } from './registry';
import type { LogicContext, LogicNode, LogicScalar } from './types';

/** Thrown when data that was never validated names a kind nobody registered. */
export class LogicError extends Error {
  override readonly name = 'LogicError';
}

/**
 * Whether `condition` (validated data) holds in `context`.
 * @throws LogicError for a kind the registry does not know.
 */
export function evaluateLogic(
  condition: LogicNode,
  context: LogicContext,
  registry: LogicRegistry = logicRegistry,
): boolean {
  switch (condition.kind) {
    case 'all':
      return (condition as LogicAllNode).of.every((child) =>
        evaluateLogic(child, context, registry),
      );
    case 'any':
      return (condition as LogicAllNode).of.some((child) =>
        evaluateLogic(child, context, registry),
      );
    case 'not':
      return !evaluateLogic((condition as LogicNotNode).condition, context, registry);
  }
  const definition = registry.condition(condition.kind);
  if (definition === undefined) {
    throw new LogicError(`unknown condition kind "${condition.kind}"`);
  }
  return definition.evaluate(condition, context);
}

/** A node described as a localization key with parameters, for UI to translate. */
export interface LogicDescription {
  /** `logic.condition.<kind>` or `logic.effect.<kind>`. */
  readonly key: string;
  /** The node's scalar fields, in field order. */
  readonly params: Readonly<Record<string, LogicScalar>>;
  /** Nested descriptions (`all`, `any`, `not`). */
  readonly children: readonly LogicDescription[];
}

function scalarFields(node: LogicNode): Record<string, LogicScalar> {
  const params: Record<string, LogicScalar> = {};
  for (const [name, value] of Object.entries(node)) {
    if (name !== 'kind' && ['string', 'number', 'boolean'].includes(typeof value)) {
      params[name] = value as LogicScalar;
    }
  }
  return params;
}

/** The structured description of a condition (nested for combinators). */
export function describeConditionParts(condition: LogicNode): LogicDescription {
  const key = `logic.condition.${condition.kind}`;
  switch (condition.kind) {
    case 'all':
    case 'any':
      return {
        key,
        params: {},
        children: (condition as LogicAllNode).of.map(describeConditionParts),
      };
    case 'not':
      return {
        key,
        params: {},
        children: [describeConditionParts((condition as LogicNotNode).condition)],
      };
  }
  return { key, params: scalarFields(condition), children: [] };
}

/** The structured description of an effect. */
export function describeEffectParts(effect: LogicNode): LogicDescription {
  return { key: `logic.effect.${effect.kind}`, params: scalarFields(effect), children: [] };
}

/** One line: `logic.condition.hasItem(item=key-a,count=1)`; nested for combinators. */
export function describeText(description: LogicDescription): string {
  const parts = [
    ...Object.entries(description.params).map(([name, value]) => `${name}=${String(value)}`),
    ...description.children.map(describeText),
  ];
  return parts.length === 0 ? description.key : `${description.key}(${parts.join(',')})`;
}

/** A condition as a non-empty localized-key string, for "requires: ..." hints (AC-5). */
export function describeCondition(condition: LogicNode): string {
  return describeText(describeConditionParts(condition));
}

/** An effect as a non-empty localized-key string. */
export function describeEffect(effect: LogicNode): string {
  return describeText(describeEffectParts(effect));
}
