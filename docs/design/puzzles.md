# Puzzles

A puzzle is data, not code (contract §1): `src/content/data/puzzle/<id>.json`, checked when content
loads (mw-e15.1). Field reference, generated from the schema: [puzzle schema](../content/puzzle-schema.md).
The runtime that tracks, solves and rewards puzzles is mw-e15.3; the solver that proves declared
solutions is mw-e15.6.

## Outcomes, not scripts

"Problems support multiple solutions" (CONSTITUTION §2). A puzzle therefore describes **what must be
true**, never which trigger fires:

- `goal` is a [condition](conditions.md): true when the puzzle is solved, whatever made it so. A goal
  like "the lever is thrown" is met by pulling it, by Mage Hand, or by knocking a crate into it,
  including routes nobody declared (the runtime records those as `undeclared`, mw-e15.3). A goal
  reads world facts and the live world (mw-e15.2): entities by tag or spawn id tested with property
  predicates ("every brazier burning"), signal outputs, volumes ("≥ 40 kg on the plate") and
  `sustained` holds ("for 3 s"), all in the same language. The `GoalRuntime` keeps goals current and
  `explain` says which part still fails. A goal may only read scene spawns listed in `entities`.
- `solutions` are the routes the designer intends. Each lists the `capabilities` it needs (all of
  them; empty = anyone) and abstract `steps` for the solver and scenario replays. Steps say what
  happens to the world, in the stimulus/property vocabulary, not which script runs:

| Step                                                   | Means                                                   |
| ------------------------------------------------------ | ------------------------------------------------------- |
| `{ "do": "stimulus", "element": "heat", "target": … }` | a stimulus reaches the entity (lit, frozen, shoved)     |
| `{ "do": "move", "target": …, "to": … }`               | the entity (or `"player"`) ends up at another           |
| `{ "do": "interact", "verb": "pull", "target": … }`    | the player uses one of its affordances                  |
| `{ "do": "reach", "target": … }`                       | the player gets there (climbs, blinks, swims)           |
| `{ "do": "wait", "seconds": 2 }`                       | time passes (water freezes, a timer runs)               |

A step's `using` names the capability it relies on; it must be one of its solution's `capabilities`.

## What else a puzzle says

- `scene` and `entities`: the level the puzzle lives in and the spawns that matter, each with a
  `role`. `critical` marks an entity whose loss could softlock the puzzle.
- `policy`: `repeatable` (default false: once solved it stays solved) and `recovery`, the diegetic
  ways back from a lost object or stuck mechanism: `respawn` a critical entity after some seconds, or
  a `reset` trigger (mw-e15.7).
- `hints`: the hint ladder, tiers in increasing `afterSeconds` (or sooner after `afterAttempts`
  failures), each a `bark`, a `highlight` of entities, or both, with class-aware `variants` chosen by
  capability (mw-e15.11).
- `tags` (`mvp` puzzles must declare at least two solutions; mw-e15.8 later requires them to be
  distinct and cover three classes) and `focus`, the classes it is meant to showcase.
- `outputs`: the bool `solvedFact` set when solved, and further facts to `set` (doors, rewards and
  quests read these).

## What load checks

- In the file: entity and solution ids are unique; every step, highlight and recovery names a listed
  entity; a step's capability is its solution's; hint tiers are in order; a respawned entity is
  critical; an `mvp` puzzle has two or more solutions.
- Against other content (`src/content/puzzle-checks.ts`): the scene exists and places every listed
  entity; every capability is declared in `src/content/data/capability/`; the goal's facts are
  declared and fit their operators; `solvedFact` is a declared bool and each `set` value fits its
  fact. Errors name the file, the JSON pointer and the missing id.

Example: `src/content/data/puzzle/testbed-room-lever.json`, a grey-box puzzle on the testbed scene.
