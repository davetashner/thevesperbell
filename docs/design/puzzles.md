# Puzzles

A puzzle is data, not code (contract §1): `src/content/data/puzzle/<id>.json`, checked when content
loads (mw-e15.1). Field reference, generated from the schema: [puzzle schema](../content/puzzle-schema.md).
The runtime that tracks, solves and rewards puzzles is described under "How a puzzle runs" below
(mw-e15.3); the solver that proves declared solutions is mw-e15.6. Which classes can solve each puzzle
is audited and gated in CI (mw-e15.8): [puzzle coverage](puzzle-coverage.md), regenerated with
`pnpm puzzle:coverage --write`.

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
  failures), each a `bark`, a `highlight` of entities, a `rumour` fact, or any mix, with class-aware
  `variants` chosen by capability (mw-e15.11). Defaults for new ladders: 180 s or 3 attempts, 360 s,
  600 s. `failures` lists the signal outputs whose pulses are failed attempts (a sequence node's
  `failed` port). The runtime counts seconds in sim ticks since the puzzle was found, fires each tier
  once (`puzzleHint`, with the chosen text and the entities to pulse), sets the rumour fact, and
  never fires for a solved puzzle. The `puzzleHints` assist (difficulty, mw-e31.10) scales the times
  (2 = twice as soon) and 0 turns hints off. Progress is in the puzzle's saved record, absent until
  an attempt fails or a tier fires. The game publishes a fired hint as `#app[data-puzzle-hint]`; the
  bark and glint are drawn by the HUD beads (mw-e31).
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
| `failed`      | a `critical` entity was destroyed (`puzzleFailed`); it returns to `in-progress` when one is back (a `respawn` policy brings one back) |

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

## Recovery

Failure should make a story, not a dead save (mw-e15.7), and recovery is always in the world: save
rollback is out of scope. `policy.recovery` lists what a puzzle does about losing a key object;
every recovery announces itself with `puzzleRecovered` (`kind` `respawn`, `reset` or `out-of-bounds`,
`entity` the spawn id put back).

- `respawn` (`entity`, `seconds`): the critical entity, once destroyed or burnt out (a wooden barrel
  that chars is as lost as one that is smashed), is replaced where it spawned after that many
  seconds: a fresh copy of the authored prop spawn, with its properties, interaction and breakable
  profile. If another physics object stands in the spot, the replacement waits and tries again every
  2 s, so a copy never appears inside another body. A solved puzzle replaces nothing. The pending
  respawn is part of the saved `puzzle.state` (`recovering`, present only while one is pending), so a
  save and load in the middle of one finishes it. The entity must be a prop spawn (checked at load).
- `reset` (`trigger`, optional `fact`): using the trigger entity (a lever) returns every door and
  switch the puzzle lists to the state its scene authored (a door open or shut, jammed or not, locked
  or not; a lever, crank or wheel at its starting position) and the puzzle to `in-progress`. A solved
  puzzle ignores it. The optional int `fact` counts the resets (hints, quests and telemetry can read
  it). Doors swing to their places like any door, so a reset is seen and heard.
- Falling out of the level: every `critical` entity that is a physics object and falls below the kill
  plane (20 m under the scene's lowest solid) is put back at its spawn point, at rest, with no speed,
  within the same tick and without breaking, whatever policy the puzzle declares. It is property
  based: the `puzzle.critical` marker component (`{ puzzle, spawn, home }`) is what makes an entity
  come home, so anything may carry it. The runtime marks a puzzle's critical entities once the puzzle
  is in play (a dormant puzzle adds nothing to the world); the component is registered on first use.

## Prefabs

Designers assemble puzzles from prefabs (mw-e15.4): data files under `src/content/data/prefab/`
that bundle scene spawns and, where the piece has behaviour, a small signal graph, with parameters
to tune. A scene places one under `prefabs` (the prefab, where, its `yaw`, its `params`) and the
loader expands it into plain spawns and a graph before anything else reads the scene, so a puzzle's
`entities` name `<instance>-<spawn>` and its goal reads `<instance>/<node>`. A prefab never
introduces a component; what the existing ones could not say (push rules, liquid volumes, a body's
facing) went to the e03 layer as general scene fields and a `facing` predicate. Catalogue, generated
from the data: [puzzle prefabs](puzzle-prefabs.md); demo scene `?scene=prefab-gallery`.

## Ordered, timed and sound-clue mechanisms

Listening, repeating and racing are signal-graph mechanisms (mw-e15.5), not puzzle code.

- **Sound clue emitter**: the `clue` signal node. A rising edge plays its `cues` in order,
  `spacing` seconds apart (the first at once), each as a `soundClueCued` event anchored at the
  node's bound spawn. The sim stays silent: the `puzzle-clues` cue sheet turns each cue (`chime-low`,
  `chime-mid`, `chime-high`, `chime-wrong`, `chime-solved`) into a positional sound from that spawn,
  so a source behind a wall is muffled and panned by the audio engine. Every clue cue is
  gameplay-critical (mw-e31.5) with a caption, so with sound captions on it reads like
  `[High chime, left]` (the caption system supplies the direction). A press mid-run is ignored; the
  run is node state and survives a save. Until the approved bell SFX land (mw-e38.144) every clue cue
  plays the placeholder metal impact set.
- **Sequence validator**: the existing `sequence` node. The right order pulses `success`; any
  out-of-order input pulses `failed` and restarts. The `bell-sequence` prefab wires `failed` to a
  `chime-wrong` clue and `success` to `chime-solved` and a latch.
- **Timed window**: `plate-timed-door` opens a door while its plate is weighed and for
  `windowSeconds` (8 by default) after it is released: a falling-edge `pulse` starts a `timer`, and
  the door follows plate OR timer. The door then takes its profile's close time (1.5 s for the sliding
  door) to shut.
- **Readable clue binding**: an item's `book.clueFor` lists the puzzles its text is a clue to.
  Reading it (`readClue`; scrolls are wired, the book reader of mw-e07.9 calls the same function)
  puts `clue.<item id>` on each bound puzzle's trail, at any time before the puzzle is touched, so
  `puzzleSolved.trail` and hint attribution can say a book helped. The text itself is the item's own
  pages.

## The solvability validator

`pnpm puzzle:validate [id…] [--abstract-only] [--time-box <ms>]` (mw-e15.6; code in
`src/tools/puzzle`) proves what each puzzle declares: that every `solutions` entry can reach the goal
for its capability set. Two layers:

- **Abstract search** (`abstract.ts`). The scene's spawns (prefabs already expanded) become a small
  state: which things are lit, and where each movable thing rests. Actions come from the capability
  set, not from the declared steps: anyone can carry a burning prop to a lit-able entity and move a
  movable thing to a place (the puzzle's entities, plates); a capability stands for the stimulus
  elements its spell emits (heat lights from range, a tether counts as force). A breadth-first search
  with memoised states finds the fewest actions that make the goal true. The abstraction ignores
  cells, timing and signal graphs, so it only over-approximates: "unreachable" means no sequence
  works, or the level lacks something the steps name (a crate that is not a spawn, a thing that
  cannot move). Goals that read facts, signals or an element it has no rule for (water, cold) and
  capabilities it has no model of are reported inconclusive, never unreachable.
- **Concrete run** (`concrete.ts`). The solution's `steps` are executed in the headless sim, loaded
  through the game's own wiring: `stimulus` casts the spell (or applies the element by contact),
  `move` carries the thing beside its destination, `interact` uses the target's primary affordance
  (which must be the step's verb), `reach` puts the player beside the target, `wait` runs time. Each
  step has an expected effect (a heated target burns, a moved thing ends up there); the report names
  the index of the first step that diverged, or says the goal stayed false after the last step.

- **Softlock search** (mw-e15.7, `findSoftlock`). The same abstraction plus irreversible losses of
  the things the puzzle lists: a flammable thing burns away once lit, a breakable thing breaks, a
  movable thing is pushed out of the level, a frozen thing melts when anything can heat. From every
  reachable state it asks whether the goal is still reachable (a backward sweep over the explored
  graph); a reachable state that cannot win is a **softlock**, reported with the shortest actions to
  it, the losses included, per solution (so the actor is the one with that solution's capabilities).
  A loss that something recovers is not explored: a `respawn` policy for the entity (every loss), the
  return of a `critical` entity that falls out of the level, a recovery anchor on the spawn (fall and
  break). A softlock that only such recovery removes is reported as `covered`, so the report shows
  what protects the puzzle. Conservative like the rest: bounded, inconclusive rather than a false
  "none" when the bound is hit, and it assumes every loss its properties allow can happen, so a
  `SOFTLOCK` finding may name a loss no player is likely to cause: fix it with a policy, or mark the
  entity `critical` if a fall is the only way.

Verdicts per solution: `ok`; `unreachable` and `diverged` fail the run for an `mvp` puzzle (CI job
`puzzle-validate`) and are reported for others; `abstraction-gap` (the search found nothing but the
sim succeeded: the abstraction needs a rule) and `inconclusive` (a bound was hit: node count, depth
or the 10 s time box per puzzle, or the model has a gap) are warnings. A class-specific solution
whose goal is also reachable with fewer capabilities is reported as an informational shortcut. A
`SOFTLOCK` line (an uncovered irreversible loss) fails an `mvp` puzzle's run like `unreachable`.

## What load checks

- In the file: entity and solution ids are unique; every step, highlight and recovery names a listed
  entity; a step's capability is its solution's; hint tiers are in order; a respawned entity is
  critical and a prop spawn; a reset fact is a declared int; an `mvp` puzzle has two or more solutions.
- Against other content (`src/content/puzzle-checks.ts`): the scene exists and places every listed
  entity; every capability is declared in `src/content/data/capability/`; the goal's facts are
  declared and fit their operators; `solvedFact` is a declared bool and each `set` value fits its
  fact; every signal in `outputs.signals` is a lever or button node of a graph the puzzle's scene
  places. Errors name the file, the JSON pointer and the missing id.

Another example: `src/content/data/puzzle/testbed-room-lever.json`, a grey-box puzzle on the testbed
scene whose goal still reads a stand-in fact (the testbed's lever prop has no switch state, and the
shared testbed takes no new props, so it stays dormant; mw-ikh).
