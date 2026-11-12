# Quest authoring format

How writers and designers author a quest as data (mw-e23.1), without touching code. The schema is
`src/content/types/quest.ts`; the generated field reference is
[quest-schema](../content/quest-schema.md). Conditions and effects are the shared
[logic DSL](logic-dsl.md); this page is about the quest around them. Quests are what
[dialogues](dialogue-format.md) hand out and resolve: a dialogue option's `startQuest` effect starts
one, and a quest's `startWhen`, resolutions and objectives read the facts and visited nodes
dialogue leaves behind. The runtime is mw-e23.2, objective bindings mw-e23.3, failure handling
mw-e23.4, the validator mw-e23.5.

## Decision: plain JSON, one quest per file

Quests are JSON (`src/content/data/quest/<id>.json`, with `"$schema": "../quest.schema.json"`), like
every other content type and for the same reasons as dialogue: one parser, one loader, one docs
generator. Content may not import the sim at runtime, so the file schema checks structure and the
*shape* of conditions and effects (`{ "kind": ... }`); `validateQuestLogic` (src/sim/quest) checks
the DSL itself, the objectives' content ids and the quest's own objective ids.
`tests/integration/quest-format.test.ts` runs both over every quest. Fixtures: three quests under
`src/content/fixtures/quest/` (never shipped; `loadQuestFixtureContent`).

## Shape

- `id`, `title`, `summary` (journal text; every text has a stable localization key, default
  `quest.<id>.title`, `.summary`, `.objective.<id>`, `.resolution.<id>`, `.failure.<id>`, `.stage.<id>`).
- `givers`: NPCs who hand the quest out. `startWhen`: a condition that starts it; **omit it** and the
  quest is started by an effect (`startQuest` in a dialogue option or another quest).
- `stages` (optional): ordered sequencing, with `initialStage` (default the first). An objective with a
  `stage` is only active in it; `setStage` failure continuations move between stages. A stage's
  `transitions` (`{ when, stage, effects? }`) move a branching quest on by condition: while the stage is
  current, the first transition (file order) whose `when` holds moves the quest to `stage` and applies
  its `effects` in the same atomic batch (a refusal changes nothing and the next transition is tried).
  Resolutions are still checked first, so an ending can end the quest from any stage. One move per
  evaluation pass, so a chain of stages settles over a few passes. The main quest
  (`quest-labyrinth-beneath-briar-glen`, mw-e39.4) is written this way.
- `objectives`: what the quest tracks (below). `optional` ones are not needed to resolve; `hidden`
  ones show only when complete; `activeWhen` gates when one is active.
- `resolutions` (at least one): `{ id, approach, when, priority, effects, journal }`. `approach` is
  `combat | stealth | diplomacy | magic | trickery | other`. The first `when` to hold (highest
  `priority`, then file order) resolves the quest, applies `effects` and writes the journal entry.
  Because every resolution is just a condition, any systemic means counts.
- `failures`: `{ id, journal, effects, continuation, ... }` plus at least one way to happen: `when`
  (any condition), `npcRemoved`, `itemDestroyed` or `deadlineDays`.
  **`continuation` is required** (failure is a story, not a dead end): `startQuest` (a successor,
  never the quest itself), `setStage` (carry on elsewhere) or `resolve` (end with a bittersweet
  resolution of this quest). The runtime applies it atomically with the failure.

## Objective kinds

Each objective is `{ id, kind, text, params, optional, hidden, activeWhen, stage }`. The kind decides
the `params` and (mw-e23.3) the sim events the objective listens to. An unknown kind fails naming it.

| Kind | Params | Complete when |
| --- | --- | --- |
| `haveItem` | `item`, `count` | the player holds the item |
| `deliverItem` | `item`, `npc`, `count` | the item is handed to the NPC |
| `fact` | `fact`, `value` (default `true`) | the world fact has the value |
| `entityState` | `creature`, `state` | `dead`, `befriended`, `fled`, `subdued` or `removed` |
| `enterArea` | `area` | the player enters the area |
| `talkTo` | `npc` | the player talks to the NPC |
| `dialogueNode` | `dialogue`, `node` | the player reaches that node |
| `learnCapability` | `capability` | the player learns it |
| `event` | `event` | a named event is emitted |

Prefer `entityState: removed` to `dead`, so stealth and diplomacy resolve combat-flavoured objectives.
Adding a kind is one entry in `OBJECTIVE_SCHEMAS` and `QUEST_OBJECTIVE_KINDS` in the schema, its case in
`objectiveRefs` (src/sim/quest/validate.ts) and its event binding in the sim.

## What the schema checks, and what comes later

Schema (every load): unique ids per section, at least one resolution, a failure that can happen and
continues, stage / resolution / successor references that name real things, unique text keys. Logic
(`validateQuestLogic`): DSL kinds and fields, content references, the quest's own objectives.
mw-e23.5 (the quest validator): every resolution is satisfiable, a non-combat resolution exists,
successor chains are valid and cycle-free.

## The runtime (mw-e23.2)

`QuestRuntime` (src/sim/quest/runtime.ts) runs the quests: `unstarted → active → resolved(<id>) |
failed(<id>)`. A quest starts by `startWhen` or a `startQuest` effect, ends the first time a
resolution's `when` holds (priority, then file order; resolutions are checked before failures) and is
terminal after that. Objectives not completed when it ends become `skipped` (resolved) or `failed`;
an optional objective never blocks a resolution, and a resolution that wants an objective names it
with `objectiveState`. A resolution's or failure's effects apply in the same atomic batch as the state
change: if one refuses, nothing changes and the next satisfied resolution gets its turn.

State is world facts, so saves, hashes and conditions see it: `quest.<id>.state`
(`unstarted active resolved failed`), `.stage`, `.resolution`, `.failure` and
`quest.<id>.objective.<oid>` (`inactive active complete skipped failed`). The runtime declares them
when built (before a save loads) and writes none until a quest starts. Re-evaluation is incremental:
conditions are indexed by the facts, items, capabilities and quests they read, and only dependent
quests are evaluated; gold, time of day, disposition and unknown kinds are polled every 30 ticks.
Run logic through `runtime.host` (the game's host with quest conditions and effects served by the
runtime). `completeObjective` is the hook objective trackers call; `quest.started`, `.stage`,
`.objective`, `.resolved`, `.failed` and `.refused` events feed the journal.

### In the game (mw-e23.11)

`installGameLogic` (src/game/logic) builds the game's `LogicHost` and, when the content has quests,
installs the runtime over it; `startWorld` calls it right after the fact registry and clock, before
any save loads. `gameLogic.host` is the host dialogue and shop effects run against (quest-aware when
quests exist, the plain game host otherwise). The host reads and writes the real systems: world
facts, the player's pack and gold, capabilities, class, the game clock and, once the NPC registry
exists (mw-e22.4), dispositions. Its one `checkpoint()` composes a fact overlay (written to the
store as one transaction at the outermost commit), `inventoryCheckpoint`, `capabilityCheckpoint`
and the dispositions' checkpoint. `createGameSaveRegistry` refreshes and settles the runtime after
every load (`afterRead`), so slots, recovery and death reloads all re-evaluate. A world with no
quests gets no runtime, no system and no declared fact, so it hashes as before.
