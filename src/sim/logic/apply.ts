// The atomic effect applier (mw-e22.2, AC-2): a batch changes the host entirely or not at all.
// Effects run in order against the host; the first refusal (or throw) rolls the checkpoint back, so
// nothing earlier survives, and the failure names the effect and why. Events and rumors are deferred
// until the batch committed, so a rolled-back batch announces nothing.

import { logicRegistry } from './builtins';
import { LogicError } from './evaluate';
import type { LogicRegistry } from './registry';
import type { LogicFailure, LogicHost, LogicNode } from './types';

export type LogicApplyResult =
  | { readonly ok: true; readonly applied: number }
  | {
      readonly ok: false;
      /** Index in the batch of the effect that refused. */
      readonly index: number;
      readonly kind: string;
      readonly reason: LogicFailure;
    };

/**
 * Applies `effects` (validated data) to `host` as one atomic batch.
 * @throws LogicError for an unknown kind (nothing is applied); rethrows what an effect throws after
 * rolling the batch back.
 */
export function applyLogicEffects(
  effects: readonly LogicNode[],
  host: LogicHost,
  registry: LogicRegistry = logicRegistry,
): LogicApplyResult {
  const steps = effects.map((effect) => {
    const definition = registry.effect(effect.kind);
    if (definition === undefined) throw new LogicError(`unknown effect kind "${effect.kind}"`);
    return { effect, definition };
  });
  const checkpoint = host.checkpoint();
  const deferred: (() => void)[] = [];
  const defer = (action: () => void): void => {
    deferred.push(action);
  };
  try {
    for (const [index, { effect, definition }] of steps.entries()) {
      const reason = definition.apply(effect, host, defer);
      if (reason !== undefined) {
        checkpoint.rollback();
        return { ok: false, index, kind: definition.kind, reason };
      }
    }
  } catch (error) {
    checkpoint.rollback();
    throw error;
  }
  checkpoint.commit();
  for (const action of deferred) action();
  return { ok: true, applied: effects.length };
}
