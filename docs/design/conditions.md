# Conditions

One predicate language gates everything on world state (mw-e27.5): dialogue lines, quest stages,
puzzle goals, shops, AI and level variants all ask "was the minotaur befriended, and is the cellar
still open?" the same way. A condition is plain JSON, checked when content loads and evaluated by
the sim over the world's facts (`src/sim/facts/conditions.ts`). Field reference, generated from the
schema: [condition schema](../content/condition-schema.md). Facts themselves are declared in the
[fact registry](../content/fact-schema.md) (`src/content/data/fact/`).

## The language

A condition is an object with exactly one of `fact`, `count`, `entities`, `signal`, `sustained`,
`all`, `any` or `not`.

| Condition                                        | Holds when                                                      |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `{ "fact": "horn.befriended" }`                  | the bool fact is `true`                                         |
| `{ "fact": "horn.fate", "eq": "alive" }`         | the fact equals the value (`neq`: does not; unset is unequal)   |
| `{ "fact": "horn.rescues", "gte": 3 }`           | the int or tick fact compares (`gt`, `gte`, `lt`, `lte`)        |
| `{ "fact": "bell.rung-by", "has": true }`        | the fact holds a value: set, or declared with a non-null default |
| `{ "count": "entity:mine/*.looted", "gte": 3 }`  | that many entity facts matching the pattern are `true`          |
| `{ "all": [ … ] }`                               | every condition in the list holds                               |
| `{ "any": [ … ] }`                               | at least one holds                                              |
| `{ "not": { … } }`                               | the condition does not hold                                     |

The last three leaves read the **live world** rather than facts (mw-e15.2), so a puzzle goal can name
an outcome instead of a step:

| Condition                                                                              | Holds when                                                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `{ "entities": { "tag": "brazier" }, "where": [{ "test": "element", "element": "fire" }], "match": "all" }` | every entity tagged `brazier` (at least one exists) is burning |
| `{ "entities": { "entity": "room-lever" }, "where": [...], "match": "any" }`           | that scene spawn's entity passes the predicates                     |
| `{ "entities": {}, "where": [{ "test": "property", "property": "weight", "op": "gte", "value": 40 }], "inside": { "kind": "box", ... }, "match": "any" }` | something weighing 40 kg or more stands in the volume |
| `{ "entities": { "tag": "brazier" }, "where": [...], "gte": 2 }`                       | at least 2 of the selected entities pass                            |
| `{ "signal": "vault/gate-open" }`                                                      | that signal graph node's output (`port` to pick one) is on          |
| `{ "sustained": { ... }, "seconds": 3 }`                                               | the inner condition has held, without a break, for 3 s of sim time  |

`entities` selects by `tag` (an entity tag or the tag of a scene spawn), by `entity` (a scene spawn
id), by both, or, with `{}`, every entity that has a placement. `where` takes the same property, tag
and element predicates as signal-graph filters (so "burning" means one thing everywhere); `inside` is
a box, sphere or capsule in world coordinates. Then exactly one of `match` (`all`: at least one is
selected and every one passes, so a goal over braziers that never spawned is not solved; `any`; `none`)
or one operator over how many pass. A `sustained` hold restarts whenever its condition breaks; it
needs a watcher's memory, so only `onConditionChanged` and the puzzle `GoalRuntime` can satisfy one.
Mark a signal node you read `observed` in its graph so an unwired output is accepted.

A fact test takes at most one operator; a count takes exactly one. `count` patterns are
`entity:<level>/*.<fact>` (one level's entities) or `entity:*/*.<fact>` (every level's), and count
only facts that have been written, so a chest nobody touched never counts. Unset facts never
satisfy `gt`/`gte`/`lt`/`lte`.

Example: `all(fact(minotaur.befriended), not(fact(cellar.sealed)))` is written

```json
{ "all": [{ "fact": "minotaur.befriended" }, { "not": { "fact": "cellar.sealed" } }] }
```

and that text form, `all(fact(a), fact(b) ≥ 3)`, is how debug tools and logs show conditions.

## What load checks

- **Shape** (the schema): every node is one kind, operators are known and well typed, lists are
  non-empty, and nesting is at most **64** levels (a lone leaf is 1; each `all`/`any`/`not` adds 1).
  Deeper conditions are rejected with the path to the 65th level: split them into named conditions.
- **Live leaves**: predicates are checked against the world-property vocabulary by the schema; a
  `signal` must name a signal graph, node and output port that exist; a puzzle goal may only read
  scene spawns the puzzle lists in `entities` (`src/content/puzzle-checks.ts`).
- **Facts** (`src/content/condition-checks.ts`, against the registry): every fact is declared
  (exactly, or by its `entity:*.<fact>` template); a bare test or a `true`/`false` needs a bool fact;
  `gt`/`gte`/`lt`/`lte` need an int or tick fact; an enum compares only with one of its values; an
  id with a content id; a count pattern names a declared bool template. Errors name the file, the
  JSON pointer and the fact.

## Where conditions live

- **Inline** in any content type that gates on world state: embed `conditionSchema` for the field
  and add a line to `CONDITION_USAGES` (`src/content/condition-checks.ts`) so its facts are checked.
  Puzzle goals (`goal`, [puzzles](puzzles.md)) do this; dialogue (mw-e22) and quests (mw-e23) will,
  rather than inventing their own predicates.
- **Named** in `src/content/data/condition/<id>.json` (`id`, `name`, `notes`, `when`) when several
  systems share one, e.g. `horn-ally`.

## Using conditions from systems

```ts
const compiled = compileCondition(entry.when); // validates, extracts dependencies
compiled.evaluate(world.facts); // boolean; reads facts only, deterministic
compiled.facts; // exact fact keys it reads
compiled.patterns; // count patterns it reads
compiled.dependsOn('entity:mine/chest-3.looted'); // can this change affect it?
formatExplanation(compiled.explain(world.facts)); // ✓/✗ per node, with the values read

const watch = onConditionChanged(world, compiled, (value, cause) => {
  // runs once per change of result, at the phase boundary after the fact changed
});
watch.refresh(); // after World.restore: restoring changes facts without events
watch.unsubscribe();
```

`onConditionChanged` evaluates only when something the condition depends on changes, and calls back
exactly once per change of result, even when a transaction changes several of its facts at once.
Facts, world properties and tags announce changes by event; signal outputs, entity existence and
elapsed time are checked by `watch.poll()` (the `puzzleGoalSystem` calls it each tick), which
re-evaluates only when a signal output it reads flipped, entities were spawned or removed, or a
`sustained` hold came due. A condition with an `inside` volume is re-checked every tick, because
positions announce nothing. Pass a host with a live reader for the live leaves:
`onConditionChanged(conditionHost(world), compiled, callback)`; without one they are false.
`compiled.live` lists what it reads of the world.

Puzzle goals use `GoalRuntime` (`src/sim/puzzle/goals.ts`): `add(id, goal, onChange)`, `met(id)`,
`explain(id)` (the `✓`/`✗` account above, e.g. `entities(tag:brazier, where fire): all (2 of 3 pass)`),
and `refresh()` after `World.restore`.
Conditions are compiled from code as well as content; a malformed one throws a `ConditionError`
naming where it is.

