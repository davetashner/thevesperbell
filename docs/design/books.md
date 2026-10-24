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
  Damaged books teach damaged spells that misfire (story bible §3.3; runtime mw-e07.2).
- **Comprehension (mw-e07.3)** is only prepared for: `comprehensionDifficulty` (0 to 1) exists, and
  `teaches.spell` is an object so unstable-first-version options can be added without a migration.
- **Cover art** is `ui-book-cover-<item id>` (`bookCoverArtId`); `coverArtId` may be omitted.
- **Rarity** is `common|uncommon|rare|unique`, and `unique` exactly when `flags.unique`.
- `cursedWhispers` flags books that whisper while carried or read.
