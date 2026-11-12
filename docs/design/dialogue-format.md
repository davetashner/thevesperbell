# Dialogue authoring format

How writers and designers author a conversation as data (mw-e22.3), without touching code. The
schema is `src/content/types/dialogue.ts`; the generated field reference is
[dialogue-schema](../content/dialogue-schema.md). Conditions and effects are the shared
[logic DSL](logic-dsl.md); this page is about the graph around them. The runtime that plays a
dialogue is mw-e22.5 ([below](#runtime)), disposition mw-e22.4, persuasion math mw-e22.7, the graph validator mw-e22.8.

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

## Runtime

`DialogueRuntime` (`src/sim/dialogue/runtime.ts`, mw-e22.5) plays a dialogue: `start(dialogueId, npcId)` picks the
first entry whose condition holds and runs to the first thing that needs the player. A `line` waits for `advance()`,
a `choice` for `choose(i)` (`i` indexes `choices()`, locked options included). `branch`, `effect`, `check` and `jump`
nodes run silently in between; `abort(cause?)` ends a conversation from outside (combat, walking away).

- **Locked options.** An option whose `when` fails is hidden, or with `showWhenLocked` listed `locked` with `reason`
  (`describeCondition`) and `reasonParts`; choosing it returns `{ ok: false, reason: 'locked' }`.
- **Effects are atomic.** Each option, effect node and check outcome applies as one `applyLogicEffects` batch through the
  `LogicHost` you pass (compose the checkpoints of inventory, facts and disposition with `composeCheckpoints`; a
  quest-aware host works unchanged). If it fails nothing applies: an option goes to its `onFail` node, else the
  conversation stays on the node and `choose` returns `effects-failed`; an effect node goes to `onFail`, else the
  conversation aborts. Every failure also emits `dialogue.error`. Call the runtime between sim steps, never from
  a system, because `World.add`/`remove` are deferred mid-step.
- **Visited state** is world facts: `entity:<dialogue>/<n>-<npc>-<id>.visits`, an int per node or option per NPC
  (template `entity:*.visits`, content fact group `dialogue`, so the game's registry declares it and a production save
  load keeps it). `dialogue.visitedCount`, entry selection and `once` read it; a world that never talks hashes as
  before. The conversation in progress is not saved: a restored world drops it silently.
- **Checks** are decided by the `checks` option, a `CheckResolver`; `createPersuasion` builds the deterministic one
  ([below](#class-options-and-persuasion)). The default `failClosed` fails every check, so an unwired runtime takes each
  check's `failure` branch and its `failureEffects`. A resolver may return `{ success, breakdown }`; the runtime publishes
  it as `dialogue.checkResolved`.
- **Events:** `dialogue.started`, `dialogue.nodeVisited` (nodes and options), `dialogue.ended`
  `{ reason: completed | aborted, cause? }` and `dialogue.error`, each with the tick.
- **Guards.** A choice with nothing choosable, a missing node or dialogue, or more than `MAX_SILENT_STEPS` silent nodes
  in a row aborts with an error and a `cause`; the graph validator (mw-e22.8) should catch these first.

## Class options and persuasion

Conversations react to who the player is (mw-e22.6) and let words solve problems (mw-e22.7).

**Tags.** Every `DialogueChoice` has `tags`, derived from the option's `when` (`deriveOptionTags`, never written by hand):
`playerClass` gives a class tag (the class's `dialogueTag`, via `DialogueOptions.tags.classTag`), `hasCapability` a
capability tag (the capability id) and `hasItem` an item tag (the item id and its `icon` via `tags.itemIcon`). Conditions
are walked through `all` and `any`; anything under `not` gives no tag. The UI localizes `labelKey`
(`dialogue.tag.<kind>.<id>`) and draws the icon. Visibility is the option's `showWhenLocked`, default false: a class
option is hidden from the other classes, and a designer who wants a locked, visible option (a capability the player
could learn) sets it. `dialogueWarnings` warns (never errors) when a dialogue's class options serve fewer than two
classes.

**Checks.** The score is deterministic, with no hidden dice: `base` + the NPC's disposition band modifier + the table's
global `modifiers` (class, capability, item, fact; each for some approaches) + the node's own `modifiers` + the NPC's
personality modifiers; it succeeds when `score >= difficulty`. The numbers are the content table
`src/content/data/persuasion/persuasion.json` (field reference: `docs/content/persuasion-schema.md`). The same state
always gives the same outcome, so reloading cannot reroll a failure. A check's `target` speaker names the NPC whose
disposition and personality count (default: the NPC being talked to); personality comes from a `PersonalityLookup` the
game passes to `createPersuasion`. Wire it as `{ checks: p.resolve, preview: p.preview }`.

**For the UI.** A `CheckBreakdown` lists every part (`modifiers`: `source`, `label`, `value`), the `score`, the `margin`
(score minus difficulty) and a `label`: `easy` from `labels.easyFrom`, `fair` from `fairFrom`, `hard` from `hardFrom`,
else `impossible`. A choice whose option leads straight to a check carries it as `check`, so the odds show before the
player commits; after resolving, `dialogue.checkResolved` carries the same breakdown.
