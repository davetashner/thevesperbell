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
  `stage` is only active in it; `setStage` failure continuations move between stages.
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
