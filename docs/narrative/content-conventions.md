# Narrative content conventions

How every piece of story content is laid out, named, referenced and tested, so that many writers
(E39) can work in parallel and the validators and the narrative lint (mw-e39.24) can catch dangling
references and drift. Set by mw-e39.3. The canon itself is [story-bible.md](story-bible.md) (CANON v1,
mw-e39.1); where this page and the bible disagree about a name or number, the bible wins and this
page is wrong. The formats are [dialogue-format](../design/dialogue-format.md),
[quest-format](../design/quest-format.md), [books](../design/books.md) and the
[logic DSL](../design/logic-dsl.md); this page does not repeat them.

## The six kinds at a glance

| Kind | Directory (what the loader reads) | ID | Class variants | World-state facts | Validator today | Type from |
| --- | --- | --- | --- | --- | --- | --- |
| Dialogue | `src/content/data/dialogue/<id>.json` | `<npc>-<topic>`, e.g. `ottilie-bridge-talk` | `playerClass` entries and options | `<subject>.<state>` | `pnpm dialogue:validate`, loader, `content:coverage` | mw-e22.3 (exists) |
| Quest | `src/content/data/quest/<id>.json` | `quest-<slug>` | `variants` on journal text (see below) | `<subject>.<state>` | loader, `validateQuestLogic` | mw-e23.1 (exists) |
| Rumour | `src/content/data/rumor/<id>.json` | `rumor-<nn>-<slug>` | `variants` | `<subject>.<state>` | none yet (the `rumor` reference passes) | the type arrives with mw-e39.23 (harbour 13-18); mw-e39.12 adds 1-12 |
| Book, note, inscription | text: `src/content/data/book/<id>.json`, `.../note/<id>.json`, `.../inscription/<id>.json`; a book's inventory item stays `src/content/data/item/<id>.json` (item `category: "book"`) | `book-<slug>`, `note-<slug>`, `inscription-<slug>` | `variants` on a page only where the text really differs (none do yet) | `<subject>.<state>` | loader schema, `checkReadables`, `readable.test.ts`, `lore-map.test.ts`, `pnpm narrative:lint`, `content:coverage` | mw-e39.13 (exists) |
| Narration (cards and slides) | `src/content/data/narration/narration-<slug>.json`: title card, arrival, first night, barge rides, ending cards, epilogue slides | `narration-<slug>`; a slide's sequence id is its epilogue objective id | `variants` not used; arrival text per class is mw-e39.17 | `<subject>.<state>` (named in a slide's `facts`) | loader schema, `narration.test.ts`, `epilogue-text.test.ts`, `pnpm narrative:lint`, `content:coverage` | mw-e39.16 (exists) |
| Description | item text stays on the item (`description`, `descKey`); creature and bestiary text in `src/content/data/description/<id>.json` | `desc-<subject id>`, e.g. `desc-species-hushlings` | `variants` | none | none yet | items exist; standalone descriptions: mw-e39.15 |
| Narrative reference | `src/content/narrative/glossary.json` (plus `class-variants.ts`) | `npc-`, `place-`, `species-`, `term-`, and the text ids above | defines the class list | defines canon numbers | `glossary.test.ts` | mw-e39.3 |

**Directories.** The content loader globs `src/content/data/<type>/*.json` and nothing else, so that
is where shipped narrative lives. The directory names in the backlog text (`src/content/dialogue/`,
`quests/`, `rumors/`, `books/`, `descriptions/`) are not read by anything and are not used. One file
per dialogue, quest, rumour, note, inscription and description; the file name is the id. `rumor` is US
spelling like every code identifier (bible 11.1). `narrative/` is the one exception: the glossary is
not game content (nothing in the game loads it and it has no per-entry harness), so it is a validated
JSON module read by tests and the lint, not a registered content type.

Fixtures and worked examples live under `src/content/fixtures/` and never ship (see the end of this
page). Real E39 files go in `data/`.

## IDs

Content ids are lowercase kebab-case, stable forever (saves track dialogue visits and quest state by
id), and unique within their kind.

| Prefix | Used for | Notes |
| --- | --- | --- |
| `npc-<name>` | the creature content entry of a character (`src/content/data/creature/`); the id every `npc` reference uses | `<name>` is what the cast is called in the bible and the backlog: first name by default (`npc-mirela`, `npc-dot`, `npc-horn`, `npc-clatter`, `npc-snig`, `npc-nell`, `npc-mags`), surname for officials and the surname-led cast (`npc-hale`, `npc-vane`, `npc-cray`, `npc-quell`, `npc-garrick`, `npc-rooke`, `npc-quillon`), the epithet when there is no better name (`npc-kettleback`, `npc-abbot`). The glossary lists every id. |
| `quest-<slug>` | quests | Bible 11.1. The slug is the title without articles: `quest-empty-barge`, `quest-captains-boots`. The main quest is `quest-labyrinth-beneath-briar-glen`. |
| `book-<slug>`, `note-<slug>`, `inscription-<slug>` | in-world books (an item id), loose notes and letters, carved or painted text | Spell scrolls and spellbooks keep their item ids (`scroll-of-ember`); only story books take `book-`. |
| `rumor-<nn>-<slug>` | rumours | `<nn>` is the two-digit bible 6.2 number (`rumor-04-glen-well-echoes`, `rumor-19-under-the-bridge`); the number is part of the id and never reused. |
| `desc-<subject id>` | standalone descriptions | The subject's whole id, so the owner is visible: `desc-species-hushlings`. Item descriptions are not standalone: they are the item's own field. |
| (none) | dialogues | `<npc name>-<topic>`: `ottilie-bridge-talk`, `mirela-restricted-shelf`. Unprefixed on purpose: the directory already says dialogue, the text keys read `dialogue.<id>.<node>`, and the format's fixtures set this. |
| `species-`, `place-`, `term-` | glossary ids only | Never used by game content. |

Inside a file, local ids (nodes, options, entries, objectives, resolutions) are plain kebab-case words
(`greet-knight`, `ask-mags`). Do not repeat the file id inside them.

**Spelling.** In-game text is British-leaning ("armour", "rumour", "colour"). Identifiers, ids, keys and
field names are US ("rumor", "armor"). Names are spelled exactly as the glossary spells them
(`Mirela`, not "Mirella"; `Kettleback`, not "Kettlebach"); the lint will flag near-misses.
Reserved initial: no human MVP character's surname starts with S (bible 11.1).

## Class variants

The classes are `knight`, `archer`, `sorcerer`, `thief` (`NARRATIVE_CLASSES` in
`src/content/narrative/class-variants.ts`; a test keeps it equal to the ids under `data/class/`), plus
`all` for text every class sees.

**Dialogue has no class field, by decision.** A class-gated entry or option is a `playerClass`
condition (`{ "kind": "playerClass", "class": "thief" }`). The UI derives the tag ("[Thief]") from the
condition (mw-e22.6), the validator already rejects an unknown class there, and a second field would
be a second source of truth that could disagree with the condition. So the class-variant convention
for dialogue is about names:

- **Greetings.** One entry per class, in the entries list after the `return` entry and before the
  fallback: entry id `first-<class>`, `when` a `playerClass` condition, node id `greet-<class>`. The last
  entry is the unconditioned fallback (`first-any` to `greet-any`) so a conversation always starts and a
  fifth class later costs nothing.
- **Options.** A class-only option carries the class at the end of its id (`oath-knight`,
  `tracks-archer`) and its `when` names that class. An id that ends in `-<class>` without that condition
  is a bug (the lint will flag it).
- **Lines that differ by class** are separate nodes behind a `branch` on `playerClass`, named
  `<topic>-<class>`, ending in an `else` node named `<topic>-any`.
- **Coverage.** At least two classes per gated choice (the validator warns otherwise); the E39 beads set
  their own minimums (mw-e39.5: four greetings, two class branches per NPC).

**Every other kind** (quest journal text, rumours, notes, descriptions, arrival text) that varies by
class carries a `variants` map validated by `classVariantsSchema`:

```json
"variants": {
  "knight": "...",
  "thief": "...",
  "all": "..."
}
```

Keys are the four classes and `all`; any other key ("paladin") fails the load naming the key.
`pickClassVariant(variants, playerClass)` returns the class's text, else `all`, else nothing, so a
variant block with no `all` is a coverage warning for the classes it skips (`missingClassVariants`).
Localisation keys of a variant are the base key plus the class: `quest.<id>.summary.thief`.
`all` is never written in a `playerClass` condition: unconditioned means all.

## World-state facts

A fact is any `bool`, `int` or `enum` the story reads or writes. Keys:

- Form `<subject>.<state>`: lowercase kebab-case, one dot. The subject is the thing the story is about,
  without its id prefix: a character (`horn.fate`, `clatter.restored`, `tansy.saved`, `abbot.fate`,
  `vane.fate`), a group (`goblins.standing`), a place (`knot.breach-sealed`, `deepworks.gate-open`) or a
  quest slug (`empty-barge.asked`). Physical world changes use `world.<place>.<state>`
  (`world.glen-well.rung-pulled`).
- Type by meaning: `enum` for fates and standings (`alive`/`dead`), `bool` for things that happened,
  `int` for counts. Past tense or adjective for events (`restored`, `sealed`, `asked`), never a verb.
- **Registered or it does not exist.** Every key a narrative file reads or writes has an entry in a
  fact group under `src/content/data/fact/<group>.json` with `type`, `default`, `description` and
  `owner` (`quest`, `dialogue`...). The dialogue and quest validators reject an unknown key, and the world
  facts store (mw-e27) persists only registered keys. Story-ending facts are in `fact/endings.json`; a quest
  adds its own group file named for the quest.
- **Runtime-owned keys are not written by writers:** `entity:<dialogue>/<n>-<npc>-<id>.visits` (read it
  through `dialogue.visitedCount`) and the quest runtime's state (`questState`, `objectiveState`).
- Fixtures prefix the subject with `fixture-` (`fixture-barge.asked`) so they never collide.

## Canon glossary

`src/content/narrative/glossary.json` holds every name, place, creature type, canon number, bible 11.2
term and in-world text id, each once, transcribed from the bible. `glossary.test.ts` re-reads
`story-bible.md` and fails when a principal NPC (5.1 to 5.13), minor character (5.14 to 5.17), location
(3.5, 3.6), creature type (8), bold canon figure (11.3), glossary term (11.2) or in-world text (7.2) is
missing or counted twice. When the bible changes, change the glossary in the same PR (bible section 12
already requires a lint update). Canon numbers carry the bible's own bold phrase as `quote`, so a number
changed in the bible fails the test until the glossary follows.

## Books, notes and inscriptions

Set by mw-e39.13. Code: `src/content/types/readable.ts` (schema, hymn, page keys),
`src/content/readable-checks.ts` (item pairing), lore map `src/content/narrative/lore-map.json`.

- **Three content types, one shape.** `book`, `note` and `inscription` are registered content types
  (`data/book/`, `data/note/`, `data/inscription/`), each file `{ id, title, author?, notes, locations,
  pages: [{ text }], damaged? }`. The full text is content data validated by the schema, so the narrative
  lint reads it (`book` joined `note` and `inscription` in `isNarrativeSource`) and checks names and canon
  numbers. A book's `id` is its inventory item id; the item carries icon, value, legality and study.
- **Resolving text.** A book item's `book.pages[n].textKey` is `book.<id>.page-<n+1>` (`bookPageKey`),
  and `bookPageText(textKey, lookup)` returns that page's text. `checkReadables` fails the load if an
  item whose id has a text file disagrees (title, author, page count, keys, damaged) or if a `book-<slug>`
  item has no text file. Spell tomes and scrolls (`mage-hand`, `scroll-of-ember`...) keep their own keys
  and are not story books; their text belongs to the spellbook-flavour work.
- **Items are added with placement.** The texts exist first; the beads that place a book or stock it
  add its item (an `icon-item-...` icon needs art) with the keys above. A book with no item is simply not
  yet findable.
- **Locations.** `locations` lists one or more glossary `place-` ids; the placement beads map them to
  scenes. `readable.test.ts` checks each is a glossary place (AC-1).
- **Length.** A book has 40 to 400 words in all (the bible's norm is 100 to 300; AC-2). A note or
  inscription is as short as it is; a title is at most 40 characters for a book (the item's limit) and 60
  for a note or inscription.
- **Damaged texts.** `damaged: true` exactly when a page carries `[illegible]` (words that cannot be
  read) or `[missing]` (a lost passage; a page that is wholly `[missing]` is a torn-out page). The reader
  UI renders the markers (`DAMAGE_MARKERS`). The item's `condition` must say damaged too.
- **The Vesper hymn** is `VESPER_HYMN`. Any text that opens it ("Sleep, you who were not born") must give
  all of it byte for byte; the schema rejects an altered copy in a readable and `readable.test.ts` sweeps
  every content file, dialogue included (AC-3). It lives in `book-vesperine-hours` and the rim of
  `inscription-vesper-bell`; quote single lines ("The day is rung") freely.
- **Lore map.** `lore-map.json` lists, for each of the Long Vespers, Horn's role and the bell, the
  books, objects (notes and inscriptions) and people (dialogue files) that speak of it, each with a
  `pattern` its text must match; every topic needs a book, an object and a person and at least three
  sources (AC-4, bible 7.1). Add a source here when you write a text that touches one of them.
- **Not here.** The abbot's "friend below" notes (mw-e39.42), spell tomes and scrolls, and bookshop
  stock rules.

## Worked examples

Shipped content is real canon written under E39, so the examples are fixtures: they load with the
game's content and run through its validators, and are never in a shipped build.

| Kind | Example | Shows | Validated by |
| --- | --- | --- | --- |
| Dialogue | `src/content/fixtures/dialogue/dialogue/ottilie-bridge-talk.json` | four class greetings, a return entry, a fallback, class-gated options with the class in the id | loader, `validateDialogues` (`pnpm dialogue:validate` rules), `tests/integration/narrative-conventions.test.ts` |
| Quest | `src/content/fixtures/quest/quest/quest-empty-barge.json` and its facts `fixtures/quest/fact/narrative-example.json` | `quest-<slug>`, `<subject>.<state>` facts, registered fact group | loader, `validateQuestLogic`, the same test |
| Class variants (other kinds) | `variants` snippet above | the map and the fallback | `class-variants.test.ts` |

Kinds whose content type does not exist yet are shown as shape only; the bead that adds the type adds
its worked example to its own PR.

```json
// rumor-04-glen-well-echoes.json (type arrives with mw-e39.12; illustrative)
{ "id": "rumor-04-glen-well-echoes", "source": ["npc-dot"], "truth": "true",
  "target": "place-glen-well",
  "text": "The Glen Well echoes wrong. Drop a stone and you hear it land twice." }

// book-vesperine-hours: text in data/book/, its item (category "book", teaches lore) comes with its placement
// note-hale-list.json, inscription-rules-of-the-mine.json: see "Books, notes and inscriptions" below
// desc-species-hushlings.json (type arrives with mw-e39.15): { "id", "seen", "studied", "variants?" }
```

A `target` or any other reference to a name must resolve to a glossary id or a content id; the lint
(mw-e39.24) enforces it.

## Writing checklist

1. Names, places and numbers match the glossary; check the bible section it cites.
2. IDs follow the table; the file name is the id.
3. Every fact key you read or write is registered.
4. Class text uses `playerClass` entries and options (dialogue) or `variants` (everything else), with a
   fallback.
5. In-game text British-leaning; lines under 240 characters; `pnpm dialogue:validate` passes.
6. Quote or paraphrase the Vesper hymn only from `book-vesperine-hours` (bible 7.2); it must be identical
   everywhere.
