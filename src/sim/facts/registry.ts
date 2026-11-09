// The fact registry in the sim (mw-e27.2): content declares every world fact once
// (src/content/data/fact/*.json); this turns those declarations into FactStore declarations and sets
// what happens to writes of anything undeclared. Dev and test builds pass the `throw` policy, so a
// typo'd fact key fails loudly; production passes `ignore` with a logger, so a stray write is
// reported and dropped instead of crashing a player's game (the choice is made in src/game/facts.ts).

import type { GameEntry } from '@content/index';
import type { FactSpec, FactStore, UndeclaredFactPolicy } from './store';

/** One fact declaration as the content registry holds it. */
export type FactDeclaration = GameEntry<'fact'>['facts'][number];

/**
 * The store spec of a registry declaration (`default: null` = no default: unset until written), with
 * the keys it was saved under before (`renamedFrom`, mw-e27.4) and its persistence policy (mw-e27.7).
 */
export function factSpecFromDef(def: FactDeclaration): FactSpec {
  const typed = def.type === 'enum' ? { type: def.type, values: def.values } : { type: def.type };
  const named = def.renamedFrom === undefined ? typed : { ...typed, renamedFrom: def.renamedFrom };
  const spec = {
    ...named,
    ...(def.persistence !== 'permanent' && { persistence: def.persistence }),
    ...(def.resetAfter !== undefined && { resetAfter: def.resetAfter }),
    ...(def.decaysTo !== undefined && { decaysTo: def.decaysTo }),
  };
  return (def.default === null ? spec : { ...spec, default: def.default }) as FactSpec;
}

/**
 * Declares every fact of the registry's groups on `store` and applies `policy` to undeclared
 * writes. Call once per world, before any system writes a fact.
 * @throws FactDeclarationError / FactKeyError for a declaration the store rejects (a key declared
 *   twice, which the content loader already refuses).
 */
export function declareFacts(
  store: FactStore,
  groups: readonly GameEntry<'fact'>[],
  policy: UndeclaredFactPolicy,
): FactStore {
  for (const group of groups) {
    for (const def of group.facts) store.declare(def.key, factSpecFromDef(def));
  }
  return store.setUndeclaredPolicy(policy);
}
