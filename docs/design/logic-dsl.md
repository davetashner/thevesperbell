# Logic DSL: conditions and effects

One validated, JSON-serializable "if X then do Y" language for dialogue, quests, shops, loot and
deeds (mw-e22.2), so those systems do not grow five incompatible mini-languages. There are no
string expressions and no `eval`: every node is a plain object with a `kind`. Code lives in
`src/sim/logic`; evaluation is pure over a context interface.

## Conditions

| Kind                                                      | Holds when                                          |
| --------------------------------------------------------- | --------------------------------------------------- |
| `{ "kind": "all", "of": [...] }` / `any`                  | every / at least one nested condition holds         |
| `{ "kind": "not", "condition": {...} }`                   | the nested condition does not hold                  |
| `{ "kind": "fact", "fact": "door.open" }`                 | the bool fact is true                               |
| `{ "kind": "factCmp", "fact": "x", "op": "gte", "value": 3 }` | the fact compares (`eq neq gt gte lt lte`)      |
| `{ "kind": "hasItem", "item": "key-a", "count": 1 }`      | the player holds at least `count` (default 1)       |
| `{ "kind": "hasCapability", "capability": "swim" }`       | the capability is learned                           |
| `{ "kind": "playerClass", "class": "mage" }`              | the player's class                                  |
| `{ "kind": "disposition", "npc": "miller", "op": "gte", "value": 10 }` | the NPC's disposition score compares   |
| `{ "kind": "questState", "quest": "mill", "state": "active" }` | `unstarted active resolved failed`             |
| `{ "kind": "objectiveState", "quest": "mill", "objective": "grain", "state": "complete" }` | `inactive active complete failed` |
| `{ "kind": "gold", "op": "gte", "value": 50 }`            | the player's gold compares                          |
| `{ "kind": "timeOfDay", "from": "22:00", "to": "04:00" }` | game clock in `[from, to)`; may wrap midnight       |

`fact` and `factCmp` do not reimplement fact logic: they build the equivalent condition of the shared
condition API ([conditions](conditions.md), `src/sim/facts/conditions.ts`), compile it once per node and
evaluate it over the context's facts, so a fact means one thing everywhere.

## Effects

`setFact`, `giveItem`, `takeItem`, `gold` (`delta`), `disposition` (`npc`, `delta`), `startQuest`,
`completeObjective`, `resolveQuest` (optional `resolution`), `failQuest`, `learnCapability`, `emit`
(`event`, scalar `data`) and `revealRumor`. A batch is **atomic**: `applyLogicEffects(effects, host)` opens
a checkpoint, applies in order, and on the first refusal (or throw) rolls everything back and returns
`{ ok: false, index, kind, reason }`. `emit` and `revealRumor` are deferred until after commit, so a
rolled-back batch announces nothing.

## Context and host

`LogicContext` (reads) and `LogicHost` (mutators returning `undefined` or a refusal reason, plus
`checkpoint()`) are interfaces in `types.ts`. Quests, dispositions and the inventory plug in by
implementing them; `MemoryLogicHost` is the reference implementation for tests.

## Validation

`validateLogicCondition(data, { registry?, references? })` and `validateLogicEffects` return
`{ ok, value }` (normalized, defaults filled) or `{ ok: false, issues: [{ path, message }] }`, e.g.
`unknown condition kind "moonPhase" at of[1].condition`. `references` is the load-time hook: it
receives every `{ type, id }` a node names (`item`, `quest`, `objective` as `quest/objective`, `npc`,
`capability`, `class`, `fact`, `rumor`) and returns a problem string for ones that do not exist.
`logicConditionSchema()` and `logicEffectsSchema()` are zod schemas for embedding in content types.
Nesting is capped at the shared 64 levels.

## Extending

```ts
logicRegistry.registerCondition({
  kind: 'shop.stocked', // camelCase, dotted namespace allowed
  schema: z.strictObject({ shop: z.string(), item: z.string() }), // fields except `kind`
  evaluate: (node, context) => /* read context.services */ true,
});
```

`registerEffect` takes `apply(node, host, defer)`. Extension kinds validate, evaluate, apply and
describe exactly like built-ins; `createLogicRegistry()` gives an isolated copy for tests.

## Describing

`describeCondition` / `describeEffect` return a localized-key string such as
`logic.condition.hasItem(item=key-a,count=1)` (nested for `all`/`any`/`not`); `describeConditionParts`
returns `{ key, params, children }` for UI that translates the key and fills the parameters, which is
how locked dialogue options show "requires: ...".
