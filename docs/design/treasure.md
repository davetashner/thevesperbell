# Treasure design guide (mw-e18.9)

How to put loot in the world so it stays worth finding, for anyone placing a container, a body or a
pickup in the town, the wilderness or the Labyrinth. This is a placement guide, not a value spec:
gold amounts, chest tiers and item-value multipliers are set in `docs/design/economy.md` (mw-e20);
this doc only says what kind of thing goes where, how often, and how it reads. Loot-table mechanics
(`guaranteed` items vs. weighted `entries`) are `docs/content/loot-table-schema.md`
(`e18-loot-tables`, mw-e18.1). Flavour text follows the tone guide and item voice in
`docs/narrative/story-bible.md` §2.4 and §7.4.

Scope: this is the guide, not the content — actual placements belong to the world-content group and
the scenes they're written into.

## Rule of thumb

**An interesting-looking place usually contains something.** A dead end, an alcove, a locked
drawer, a skeleton's pockets, the one shelf lit by a window — if the level art drew the player's eye
to it, it pays off, even if the payoff is a joke. A plain corridor or an unremarkable patch of grass
doesn't need one; scattering loot everywhere flattens the signal and trains players to stop looking
at the geometry.

## Treasure tiers

Five kinds of discovery. A tier is what the thing is *for*, not how much it's worth — a tier-3 tool
and a tier-5 artifact can both be a single item sitting in the same chest.

| Tier | What it's for | Example | Anti-pattern |
| --- | --- | --- | --- |
| **Junk with jokes** | Worthless-to-sell clutter placed for the beat, not the gold. Pure environmental storytelling (story bible §7.1: "item text is lore"). | *Bent fork.* "Someone straightened it three times before giving up. You're the fourth to try." | *Bent Fork.* "Lol, who even uses forks." Value: 1g. — slang, winking at the player, and a price tag on something that was never meant to sell. |
| **Useful consumables** | Food, potions, ingredients, jars — the volume sink (`economy.md` "Sinks and price bands"). Bought in bulk at shops; found loot tops up the supply, it isn't the main source. | *Traveller's rations.* "Hard bread, harder cheese. Keeps forever; tastes like it already has." | Either every potion gets the same copy-pasted "Restores health" with no voice at all, or a three-paragraph elegy on a stack of ten arrows — both waste the one sentence a consumable actually earns. |
| **Tools** | Lockpicks, climbing gear, a lantern, a non-quest key — functional unlocks the player keeps using, not a one-time story beat. | *Oil-blacked lockpick.* "Already bent to one lock's shape. It'll open a few more before it snaps." | Putting a **progression-blocking** tool in a weighted table roll instead of a `guaranteed` placement or a quest carry. If the player can fail to find it, a loot table cannot be the only way to it. |
| **Books** | Spellbooks, lore books, scrolls — their own schema and voice (`docs/design/books.md`, story bible §7.2-7.3). This guide only covers *where* they're placed. | A circle-one spellbook on a shop's shelf; a lore book on the one bookshelf in a room that has one. | Writing new flavour text that drifts from an existing book's canon fields (`legality`, `rarity`, `school`) instead of reading `books.md` first. |
| **Artifacts** | Masterwork-tier, story-relevant, one of one. Always handcrafted, never rolled. The item voice at its strongest. | *Hornfolk name-stone.* "A river-smooth stone carved with one long, low word. Held to the ear, it is silent. Held near the minotaur, it is not." (story bible §7.4) | Reducing the payoff to a stat line ("+15% magic damage") instead of a sentence, or letting it appear as a weighted `entries` roll — an artifact that can fail to drop isn't an artifact. |

## Placement density

Numeric targets, one per part of the world:

- **Town (Briar Glen).** Sparse and always handcrafted. About one discovery per notable interior (a
  shop's back room, a locked drawer, Mirela's red shelf) — most rooms have zero. The town's economy
  runs on shops, not on finding things on the floor.
- **Wilderness (the valley, Briarwood).** Tracks the gold curve in `economy.md`'s target: about
  three common chests per 45 minutes of unhurried skeleton-hunting, i.e. roughly one discovery per
  named sub-area (a clearing, a camp, a ruin), or every 10-15 minutes of travel.
- **Labyrinth (the Knot).** Densest. Superior chests go one per major room — a fight, a puzzle or a
  set piece, never a bare connector (`economy.md` "Chest, superior"); every area a player can stop
  and look around in gets at least a common-or-fine discovery. Masterwork stays to a handful per
  region, hidden or puzzle-gated, never sitting on the critical path itself (`economy.md` "Chest,
  masterwork").

## Handcrafted vs. table-rolled

**Target ratio: roughly one handcrafted (`guaranteed`) placement for every two to three table-rolled
(`entries`) rolls**, region-wide — skewed further toward handcrafted in the Labyrinth, almost
entirely rolled for generic wilderness trash. By chest tier (`economy.md` "Income"):

| Chest tier | Handcrafted | Table-rolled |
| --- | --- | --- |
| Common | none | everything — coins plus a consumable roll |
| Fine | one guaranteed item | one or two rolls, for coins and filler |
| Superior | one or two guaranteed items | a small coin roll only |
| Masterwork | everything | none — a roll table cannot gate a reward this size |

A `guaranteed` placement is a decision someone made on purpose; a weighted `entries` roll is the
game making the decision for them. Spend the first on anything the player should remember finding.

## Gold budget

Treasure placement does not set prices — `docs/design/economy.md` (mw-e20) is the single reference
for chest value bands, item tiers and the target gold curve. The numbers that matter here: chest
gold by tier (common 8-25, fine 25-70, superior 70-180, masterwork 180-450) and the region target of
about a 0.6-0.8 obtainable-to-sink ratio. Placement density (above) is how that budget gets spent
across a region; if a region's chest count and tier mix don't land it near its target gold, fix the
placement count before touching the bands themselves.

## Ownership

A container or item may carry `owner` (an id or name). It has no mechanical effect on its own
(`docs/design/interaction-matrix.md`: `owner` — no effect) — it exists so that taking the thing is
theft: the UI names the owner on a stolen item's tooltip (`docs/design/ui.md`), and stolen goods
only sell to a fence, at a worse rate (`economy.md` "Merchant modifiers").

- **Owned.** Anything inside an inhabited, currently-used space that belongs to someone named or
  implied — a shop's back room, a sleeping guard's pack, a locked house. Taking it should feel like
  a choice, not a freebie.
- **Unowned.** Anything abandoned, monster-held, or found in the wild — valley chests, dungeon
  containers, a dead skeleton's pockets. Nobody to steal from; leave `owner` unset.
- Don't mark something owned just to make it feel valuable. Ownership is about whether someone would
  notice, not about rarity — a junk-tier mug on someone's shelf is still theirs.

## Humour and flavour text

Every piece of treasure text follows the tone guide (story bible §2.4): funny because of what it
*is*, never winking at the player — no modern slang, no memes, no "lol". Even junk-tier jokes earn
one sentence of character and, ideally, a small turn of feeling at the end, the way "Mortimer's
tooth" or the rusted watch-key do (§7.4). A joke that only works if the player notices the game
making it is the wrong kind of joke here; a joke that works because of who dropped it is the right
kind.

| Do | Don't |
| --- | --- |
| *Goblin kettle-helm.* "Protects the head, boils water, and signals rank. Goblin engineering at its best." | *Goblin Helmet.* "Haha, goblins are so dumb, look at this helmet!" |
| *Rusted watch-key.* "The sergeant wore it on a cord. The cord outlived him by forty years; the key will outlive us all." | *Old Key.* "Opens a door. Value: 5g." |
| One line, maybe two, then stop. | A paragraph of backstory on a stack of arrows. |
