# Dialogue authoring format

How writers and designers author a conversation as data (mw-e22.3), without touching code. The
schema is `src/content/types/dialogue.ts`; the generated field reference is
[dialogue-schema](../content/dialogue-schema.md). Conditions and effects are the shared
[logic DSL](logic-dsl.md); this page is about the graph around them. The runtime that plays a
dialogue is mw-e22.5, disposition mw-e22.4, persuasion math mw-e22.7, the graph validator mw-e22.8.

## Decision: plain JSON, one dialogue per file

Dialogues are JSON, like every other content type (`src/content/data/dialogue/<id>.json`, with
`"$schema": "../dialogue.schema.json"` for editor completion and checking). YAML was considered
(nicer to type, comments) and rejected: it would add a second parser, a compile step and a second
file format to every tool (loader, content docs, JSON Schema, hashing, the debug build's globbed
sources), and the source of truth would stop being the file the game loads. The costs of JSON are
met in the format instead: the `note` field gives writers somewhere for comments, and node ids are
short kebab-case words so a file reads top to bottom. A visual editor (mw-e33.13) writes the same JSON.

Because there is no compile step, "compiled and validated" is: the loader parses and validates the
file (`loadContent`), then `validateDialogueLogic` (src/sim/dialogue) validates the logic DSL inside
it. Content may not import the sim at runtime (layer rule), which is why logic validation lives
beside the sim; `tests/integration/dialogue-format.test.ts` runs both over all dialogue.

## Shape

```json
{
  "id": "marsh-greeting",
  "speakers": [{ "id": "ottilie", "npc": "npc-ottilie" }],
  "entries": [
    { "id": "return", "when": { "kind": "dialogue.visitedCount", "id": "welcome", "op": "gte", "value": 1 }, "node": "welcome-back" },
    { "id": "first-meeting", "node": "welcome" }
  ],
  "nodes": [ ... ]
}
```

- `speakers`: who talks. `npc` is a creature id (checked at load); `name` is for a voice or a sign.
  `player` and `narrator` are built in and must not be declared.
- `entries`: the ways in, tried in order, the first whose `when` holds starts the conversation at its
  `node`. The last entry has no condition, so a conversation can always start.
- `nodes`: every step. Node ids are lowercase kebab-case, unique in the file and stable forever (the
  runtime records visited nodes in saves).

## Node kinds

| Kind | Fields | Does |
| --- | --- | --- |
| `line` | `speaker`, `text`, `next` or `end: true` | someone speaks |
| `choice` | `options[]` | the player picks one |
| `branch` | `routes[]` (`when`, `next`), `else` | routes by condition, silently |
| `check` | `approach`, `difficulty`, `target?`, `modifiers[]`, `success`, `failure`, `successEffects?`, `failureEffects?` | a deterministic persuasion check (mw-e22.7); both branches are required, failures must continue the story |
| `effect` | `effects[]`, `next` or `end: true`, `onFail?` | changes the world, silently |
| `jump` | `dialogue`, `node?` | continues in another dialogue (its entries decide when `node` is omitted) |
| `end` | | closes the conversation |

`approach` is `persuade`, `intimidate`, `deceive` or `charm`. Each modifier is `{ when, bonus, label }`;
the label is the words the player sees ("He likes you").

### Options

`{ id, text, when?, showWhenLocked?, once?, effects?, next | end: true, onFail? }`

- `when`: a logic condition. A class-gated option is just `{ "kind": "playerClass", "class": "thief" }`;
  an item-gated one is `hasItem`; a capability-gated one is `hasCapability`. The UI derives the
  tag ("[Thief]") from the condition (mw-e22.6), so the format has no separate class field.
- `showWhenLocked`: when the condition fails, show the option locked with its reason instead of hiding it.
- `once`: offered only until chosen. Option ids are unique across the dialogue and distinct from node ids,
  because the runtime tracks both by id.
- `effects`: applied together, all or nothing. If they cannot all apply the runtime goes to `onFail`, or stays
  on the node with an error event (mw-e22.5).
- Exactly one of `next` or `end: true`; neither (a dead end) and both are validation errors.

### Visited counts

`{ "kind": "dialogue.visitedCount", "id": "welcome", "op": "gte", "value": 1 }` holds when node or option
`id` has been visited that many times with the NPC being talked to; add `"dialogue": "other-id"` to
look at another dialogue. It is a dialogue extension kind of the logic DSL (`src/sim/logic/dialogue-kinds.ts`,
registry `dialogueLogicRegistry()`), reading the `dialogue` service the runtime puts on the logic context.

## Text and localization

Text is inline (`text`) for the MVP. Every line and option has a stable localization key, by default
`dialogue.<dialogue id>.<node id>` (options add `.<option id>`; `dialogueTextKey`), or an explicit
`textKey`. Keys are unique per file. Localization later swaps `text` for a table lookup by key without
touching the graph. In-game text is British-leaning; ids and keys are US spelling (story bible §11.1).

## What is validated, and where

| Check | Where |
| --- | --- |
| unknown node kind, wrong fields | schema; reported with file, node id and line (`validateDialogueText`) |
| duplicate node, option, entry, speaker and text-key ids (both listed) | schema |
| `next`/`onFail`/`success`/`failure`/`else`/entry targets exist; undeclared speakers | schema |
| a line, effect or option neither continues nor ends | schema |
| condition and effect kinds, fields, item/NPC/class/capability/fact references | `validateDialogueLogic` + a reference checker (`refCheckerFor`) |
| `jump` to a node of another dialogue | load check (`src/content/dialogue-checks.ts`) |
| reachability, dead ends, cycles, unsatisfiable choices, text length | mw-e22.8 |

`validateDialogueText(file, text)` returns issues as `file:line (node "id"): message`; issues from
`validateDialogueLogic` carry JSON pointers that `describeDialogueIssue` turns into the same form.

## Fixtures

Two fixture dialogues in `src/content/fixtures/dialogue/dialogue/` (outside the game's content root,
like the creature and spell fixtures, loaded with `loadDialogueFixtureContent`): `marsh-greeting`
(Ottilie Marsh: first meeting versus return, a once-only option) and `brand-commission` (Oswin Brand:
knight and thief options, a locked option, a persuasion check with modifiers and a failure that
continues, effects). Real conversations go in `src/content/data/dialogue/` (E39).
