# Puzzles

A puzzle is data, not code (contract §1): `src/content/data/puzzle/<id>.json`, checked when content
loads (mw-e15.1). Field reference, generated from the schema: [puzzle schema](../content/puzzle-schema.md).
The runtime that tracks, solves and rewards puzzles is described under "How a puzzle runs" below
(mw-e15.3); the solver that proves declared solutions is mw-e15.6.

## Outcomes, not scripts

"Problems support multiple solutions" (CONSTITUTION §2). A puzzle therefore describes **what must be
true**, never which trigger fires:

- `goal` is a [condition](conditions.md): true when the puzzle is solved, whatever made it so. A goal
  like "the lever is thrown" is met by pulling it, by Mage Hand, or by knocking a crate into it,
  including routes nobody declared (the runtime records those as `undeclared`, see below). A goal
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
- `discovery`: how the player finds it, a `volume` (world coordinates) to walk into and/or an
  `interact` trigger entity. Without it the first thing done to a listed entity finds it.
- `outputs`: the bool `solvedFact` set when solved, further facts to `set` (doors, rewards and
  quests read these), `signals` to drive (`"<graph>/<node>"`: a lever is switched on, a button
  pressed; the scene's signal graph wires it to doors and lights) and `rewards`, hook ids announced
  once.

## How a puzzle runs

A puzzle file placed next to its level needs no code: the game starts a `PuzzleRuntime`
(`src/sim/puzzle/runtime.ts`) for the scene's puzzles (`startPuzzles`, `src/game/puzzles`), and a
scene with none starts nothing. The runtime watches each goal with the live conditions of mw-e15.2
and walks the puzzle through its lifecycle:

| State         | When                                                                                   |
| ------------- | -------------------------------------------------------------------------------------- |
| `dormant`     | nobody has found it                                                                    |
| `discovered`  | the player entered its discovery volume or used its trigger (`puzzleDiscovered`)       |
| `in-progress` | the player did something to it: a property its goal reads changed on a listed entity, a listed entity was used, a capability was used on one |
| `solved`      | its goal is true, from any state, however it got there (`puzzleSolved`)                |
| `failed`      | a `critical` entity was destroyed (`puzzleFailed`); it returns to `in-progress` when one is back |

When it is solved the outputs fire once, in this order: the solved fact and the other `set` facts
(one transaction), the `signals`, then the events `puzzleSolved`, and for a first solve one
`puzzleRewarded` per reward hook. A solved one-shot puzzle stays solved and nothing fires again,
whatever the goal does later (a brazier put out does not close the vault). A `repeatable` puzzle
reopens when its goal fails: the solved fact goes false, the levers it drove go back off, and
`puzzleUnsolved` fires; its rewards still fire only once.

**Attribution.** Capabilities used while the puzzle is open form its trail (`capabilityUsed`;
casting a spell records `spell.<id>`, other systems emit the event as they learn to). When it is
solved the declared solution whose capabilities are all in the trail is credited, the most
demanding one first, the first declared on a tie; none fitting is `undeclared`, and
`puzzleSolvedUndeclared` also fires (the game logs it as telemetry). A solution that needs no
capability fits every trail, so a puzzle with an "anyone can" route is never `undeclared`:
capabilities alone cannot tell a torch from a stranger's cleverness. The solver (mw-e15.6) can say
more.

**Saving.** Each puzzle's state, attribution, trail, lost entities and half-finished `sustained`
holds live in a `puzzle.state` component on a puzzle entity, so saves, snapshots and the state hash
carry them (the solved fact and the doors it opened are already saved as facts and world state).
The component is registered, and the entity made, only when a puzzle first leaves `dormant`:
worlds with no puzzle in play hash as they always did. After a load the runtime reloads its view
(`World.restores` tells it), resumes the holds, and re-reads the goals; a solved puzzle stays solved
and fires nothing. A `sustained` hold therefore keeps its progress across a save ("lit for 0.7 s of
1 s" loads as exactly that); the clock that matters is sim ticks, which a save keeps.

**Coordinates.** `discovery.volume` and a goal's `inside` volumes are in world coordinates, unlike a
signal graph's volumes, which are placed relative to the graph's origin in the scene. Tags an
entity gets any way other than `tagEntity` (a scene spawn's own tags are fine: they never change)
announce no `tagsChanged` event, so a goal reading them notices at its next poll or after a load.

**Signals a goal reads.** A goal may read a graph node's output (`{ "signal": … }`); mark such a
node `"observed": true` in its graph if nothing in the graph reads it, or the graph's own check
(a node that drives nothing) rejects it.

Example: `src/content/data/puzzle/brazier-hall.json` on its own scene `brazier-hall`
(`?scene=brazier-hall`). Three unlit light-source braziers, a goal "every brazier burns, together,
for a second", and a portcullis the puzzle's `signals` open through a latch in the scene's signal
graph. A burning barrel carried from brazier to brazier, an Ember cast from across the room, a fire
arrow all solve it, because it reads what burns, not what lit it. The stack it is built from is
all existing: light sources, world properties, the stimulus API, a door receiver, facts.

## What load checks

- In the file: entity and solution ids are unique; every step, highlight and recovery names a listed
  entity; a step's capability is its solution's; hint tiers are in order; a respawned entity is
  critical; an `mvp` puzzle has two or more solutions.
- Against other content (`src/content/puzzle-checks.ts`): the scene exists and places every listed
  entity; every capability is declared in `src/content/data/capability/`; the goal's facts are
  declared and fit their operators; `solvedFact` is a declared bool and each `set` value fits its
  fact; every signal in `outputs.signals` is a lever or button node of a graph the puzzle's scene
  places. Errors name the file, the JSON pointer and the missing id.

Another example: `src/content/data/puzzle/testbed-room-lever.json`, a grey-box puzzle on the testbed
scene whose goal still reads a stand-in fact (the testbed's lever prop has no switch state, and the
shared testbed takes no new props, so it stays dormant; mw-ikh).
