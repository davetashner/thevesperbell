// The extension registry of the logic DSL (mw-e22.2, AC-4): each condition and effect kind is a
// definition with its own zod schema, evaluator or applier and optional content references. The
// built-ins (builtins.ts) register through the same calls other epics use for theirs.

import type { z } from 'zod';
import type { LogicContext, LogicHost, LogicFailure, LogicNode, LogicRef } from './types';

/** Kinds are camelCase words, optionally dotted for an extension namespace: `shop.stocked`. */
export const LOGIC_KIND_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/;

/** The kinds the validator, evaluator and describer handle themselves (they nest conditions). */
export const LOGIC_COMBINATOR_KINDS = ['all', 'any', 'not'] as const;

/** A condition kind. `schema` validates every field except `kind`. */
export interface LogicConditionKind<Fields extends object = object> {
  readonly kind: string;
  /** Strict object schema of the node's fields (without `kind`). */
  readonly schema: z.ZodType<Fields>;
  readonly evaluate: (node: Fields & LogicNode, context: LogicContext) => boolean;
  /** Content ids the node names, checked by the load-time reference hook. */
  readonly refs?: (node: Fields & LogicNode) => readonly LogicRef[];
}

/** What an effect defers until the whole batch committed (events, rumors). */
export type LogicDefer = (action: () => void) => void;

/** An effect kind. `apply` returns `undefined` on success or the reason it refused. */
export interface LogicEffectKind<Fields extends object = object> {
  readonly kind: string;
  readonly schema: z.ZodType<Fields>;
  readonly apply: (
    node: Fields & LogicNode,
    host: LogicHost,
    defer: LogicDefer,
  ) => LogicFailure | undefined;
  readonly refs?: (node: Fields & LogicNode) => readonly LogicRef[];
}

export class LogicRegistryError extends Error {
  override readonly name = 'LogicRegistryError';
}

/** The condition and effect kinds known to validation, evaluation and application. */
export class LogicRegistry {
  private readonly conditionKinds = new Map<string, LogicConditionKind>();
  private readonly effectKinds = new Map<string, LogicEffectKind>();

  /** Registers a condition kind. @throws LogicRegistryError for a bad or duplicate kind name. */
  registerCondition<Fields extends object>(definition: LogicConditionKind<Fields>): void {
    this.register('condition', this.conditionKinds, definition as unknown as LogicConditionKind);
  }

  /** Registers an effect kind. @throws LogicRegistryError for a bad or duplicate kind name. */
  registerEffect<Fields extends object>(definition: LogicEffectKind<Fields>): void {
    this.register('effect', this.effectKinds, definition as unknown as LogicEffectKind);
  }

  condition(kind: string): LogicConditionKind | undefined {
    return this.conditionKinds.get(kind);
  }

  effect(kind: string): LogicEffectKind | undefined {
    return this.effectKinds.get(kind);
  }

  /** Registered condition kinds including the combinators, sorted. */
  conditionNames(): readonly string[] {
    return [...LOGIC_COMBINATOR_KINDS, ...this.conditionKinds.keys()].sort();
  }

  effectNames(): readonly string[] {
    return [...this.effectKinds.keys()].sort();
  }

  private register<T extends { readonly kind: string }>(
    what: string,
    into: Map<string, T>,
    definition: T,
  ): void {
    const { kind } = definition;
    if (!LOGIC_KIND_PATTERN.test(kind)) {
      throw new LogicRegistryError(`invalid ${what} kind "${kind}"`);
    }
    const reserved =
      what === 'condition' && (LOGIC_COMBINATOR_KINDS as readonly string[]).includes(kind);
    if (reserved || into.has(kind)) {
      throw new LogicRegistryError(`${what} kind "${kind}" is already registered`);
    }
    into.set(kind, definition);
  }
}
