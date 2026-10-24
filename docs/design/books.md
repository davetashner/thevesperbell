# Book items (mw-e07.1)

Books are inventory items of category `book` (`src/content/types/item.ts`, field reference in
`docs/content/item-schema.md`). Decisions, made 2026-10-24 under the owner's "make good decisions":

- **Scrolls stay a book subtype** (`book.kind: "scroll"`), not a new category. Inventory's bookshelf
  view, shops and loot already treat them as books. A scroll has one page, teaches nothing, may stack,
  and cannot be damaged. Reading it casts `book.casts` once, free (no mana), for any class, and
  spends it (owner decision 2026-10-24; runtime is mw-ju8.17). `casts` is optional in the schema
  until spell content exists (E08), because a reference to a missing spell fails the load; the three
  shipped scrolls gain it with mw-ju8.17. Only scrolls may set `casts` or stack.
- **Teaching** is `book.teaches`: `{kind: "spell", spell}` (a `spell` reference, checked by the loader),
  `{kind: "insight", capability}` (a non-spell capability) or `{kind: "lore"}`. Many books may teach one
  spell. Learning grants the capability `spell.<spell id>` (ADR-0004). A spell's own `bookId` must name
  a book that teaches it, and a book's `school` must equal its spell's school.
- **Legality** has three values, not two, matching story bible §3.3: `licensed`, `restricted`,
  `forbidden`. It is explicit on every book, never looser than the book's school (`SCHOOL_LEGALITY`),
  but may be stricter (a confiscated or plot book). Somnomancy is forbidden.
- **Language**: `common`, `vesperine`, `hornfolk`, `dreamtongue`. Only the data is defined here; what
  reading a non-common book requires is later work.
- **Condition**: `intact`, or `damaged` with `missingPages` (zero-based, in range, unique, never all).
  Damaged books teach damaged spells that misfire (story bible §3.3; the study runtime ignores the condition for now, see "Studying a book" below).
- **Comprehension (mw-e07.3)** is only prepared for: `comprehensionDifficulty` (0 to 1) exists, and
  `teaches.spell` is an object so unstable-first-version options can be added without a migration.
- **Cover art** is `ui-book-cover-<item id>` (`bookCoverArtId`); `coverArtId` may be omitted.
- **Rarity** is `common|uncommon|rare|unique`, and `unique` exactly when `flags.unique`.
- `cursedWhispers` flags books that whisper while carried or read.

## Studying a book (mw-e07.2)

Code: `src/sim/magic/study.ts` (sessions, progress), `src/sim/magic/learning.ts` (what learning a spell
means), `src/game/items/book-study.ts` (content to study data, who may learn). Decisions, made
2026-10-24 under the owner's "make good decisions":

| Call | Decision | Why |
| --- | --- | --- |
| Reading vs studying | The inventory verb is **Study** (shown for books that teach a spell). Reading for lore is the reader (mw-e07.9); lore stays readable whatever the class. | The bead's Read/Study split: this bead is the study half. |
| How study takes time | A **time-lapse session**: every 30 sim ticks (0.5 s) the study system jumps the game clock 5 minutes (`advanceTime(5, 'study')`) and credits the book. A 60-minute book takes 6 s of play. | Study "advances in-game time", but a single jump would make interruption impossible: the world must keep stepping so a creature can notice the reader. Slices keep AI, noise and the player live. |
| Progress | Per book, kept in thousandths of a minute ("effort"); each minute adds `bonusMilli` (1000, or 1500 at a desk). Complete at `studyMinutes * 1000`. Only whole slices count; the last slice takes only the minutes that finish. | Integer maths, so the desk's x1.5 and any later bonus never drift (determinism). |
| Desk bonus | An entity tagged `desk` within 2.5 m: x1.5. | AC-2. A resting or seated bonus waits for seats (mw-e27.13); no other bonus is invented. |
| Interruption | An enemy within 20 m in `alerted` or `combat`, the reader being hit, walking more than 1 m from where they sat, or the book leaving the pack ends the session (`StudyEnded {outcome: interrupted, reason}`). Progress already earned stays and studying again resumes. Starting with a threat near is refused (`unsafe`). | AC-3 and the bead's note. Only Alerted and Combat count: a Suspicious guard is the player's chance to stop, not a hard stop. Any brain-bearing creature counts, friend or foe: faction filtering can come with the alert tuning (mw-e11.16). |
| Completion | `SpellLearning.learn(world, actor, spell, source)` makes the spell known (`magic.known`), grants capability `spell.<id>` with source `learned` (through the unlock book when an unlock exists, so prerequisites bind), and fires `SpellLearned {actor, spellId, source}` once. `source` is the book's item id. | One door for every teacher: the night teacher (mw-ju8.14), trainers and deeds call the same `learn`; no one touches `magic.known` or the registry directly. |
| Already known | Studying a book of a known spell learns nothing, flags the book (`knownBooks`) and ends at once with `outcome: known`. A spell learned elsewhere mid-session finishes the same way. | AC-4. |
| Who may learn | The book's `learners`: `any`, or `["sorcerer"]`. Others are refused with reason `class`. A non-sorcerer may learn from a book that is a chain root (tier 1), `comprehensionDifficulty` at most 0.3, costs at most 20 mana, and is of a licensed school. | AC-5 and ADR-0004's simple cross-class rule for books. This is a provisional copy of the channel bound; the shared rule with the unlock `crossClass` flag and signature lists is mw-e19.16, and replacing it means changing `learnersOf` only. |
| Prerequisites | Checked at start (`prerequisite`, with the unlock book's refusals) and again at completion. | The unlock book owns them (ADR-0004); the progress is kept if they fail late. |
| Damaged books | Studied like intact ones for now; the `damaged` condition is not carried into the learned spell. | The misfire mechanic needs miscasts (mw-e06.13) and comprehension (mw-e07.3). Tracked as mw-w4p. |
| Comprehension (mw-e07.3) | Not built. `BookStudyDef` is the data it will extend and `#complete` is the single place partial or unstable learning hooks in. | Out of scope per the bead. |
| UI | The status line of the open inventory says it ("You settle down to study...", "You have learned Fixture Bolt.", why it broke off). A refusal for class reads "The runes swim before your eyes." | The reader UI is mw-e07.9. |
| Persistence | The ledger is the `magic.study` component, so world snapshots and state hashes carry it. Saves of known spells and progress are mw-e07.12. | Out of scope. |
| Not in the running game yet | Casting is not wired into the shipping game (aim, hotbar: mw-e06.15, mw-e06.16), so AC-6 is proven in `tests/integration/book-study.test.ts` (fixture book picked up, studied, spell cast through the real pipeline) and not as a browser spec. | An e2e needs a way to cast in the game (mw-55i). |
