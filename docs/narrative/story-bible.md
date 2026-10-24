# Story Bible — The Vesper Bell

> Status: **CANON v1**, signed off by the owner on 2026-09-27 (`mw-e39.1`). Changes from here on need a
> change-log entry (§12) and a narrative-lint update (`e39-narrative-lint`).
> Subordinate to `CONSTITUTION.md`. Scope target: the MVP boundary (one town, one wilderness, one major
> dungeon, a handful of NPCs/quests, ~8–10 creature types, one excellent bookshop, ~6 meaningful puzzles).
> **Owner extension (v0.2):** the River Wend and the optional harbour town of **Wendmouth** (§3.6) were
> added at the owner's direction. Wendmouth is optional-but-rewarding; the main quest never requires it.
> **Owner revision (v0.3):** retitled *The Vesper Bell* (§1). The valley's wealth is now **stone first**:
> glenstone, cut from the hill and carried down the Wend to the sea for export abroad, built the region and
> Wendmouth's great stone harbour. **Silver**, struck 35 years ago at the heart of the mine, is the empire's
> new cash cow and the root of its dominance over its neighbours (§3.1, §3.2, §3.6).

---

## 1. Title

**_The Vesper Bell_** (decided 2026-09-27; ADR `docs/adr/0002-game-title.md`, bead `mw-e39.2`).

- **It names the solution, not the threat.** For three centuries the bell's evening note kept the Nightjar
  asleep, and the game ends when someone finally rings it again. The title promises wonder and warmth with
  dread underneath, which is the tone (§2.4).
- **It is an instrument you must restore.** The missing tongue, the crack, the climb up the Sounding Shaft:
  the title object is the quest.
- **Vespers is dusk.** The valley's golden-hour light, the hour the sleepwalkers begin to stir, and the
  lamp that is always still lit at the end.
- **The Nightjar** remains the name of the dreaming creature in the Cradle.

The collision search and the candidates that were considered are recorded in the ADR.

---

## 2. Logline, premise, themes, tone

### 2.1 Logline

A hero-for-hire takes a bounty on the "beast of the old mine," only to discover that the minotaur is
the last warden of a living labyrinth — and that the thing calling Briar Glen's sleepers into the dark
is still singing.

### 2.2 Premise

For three weeks, people in the mining town of Briar Glen have been walking out of their beds at night
and not coming back. Those who glimpse the culprit describe a horned giant carrying the missing into
the Deepworks mine. The mine owner has posted a bounty. You arrive the night it goes up.

Under the mine lies **the Knot**: a labyrinth written in stone by the vanished Hornfolk as a prison for
**the Nightjar**, a dreaming thing whose song pulls sleepers toward it and unravels who they were. For
three centuries a monastic order rang the **Vesper Bell** each dusk to keep it asleep. Sixty-one years
ago their abbot silenced the bell to hear the song for himself, and the monastery walked into the maze.
Three months ago the mine, chasing the empire's silver, broke through the Knot's outer wall. Now the song reaches the surface.

The minotaur, **Brother Horn**, has been catching the sleepwalkers before they reach the heart and
hiding them, alive, in a sealed vault called the Fold. The kindly voice guiding you through the dark
belongs to the abbot — who needs someone to kill the warden.

### 2.3 Themes

1. **Monsters are a matter of where you stand.** The minotaur, the goblins, even the skeletons are
   misread by the town. So is the respectable mine owner — in the other direction.
2. **Curiosity is sacred, and dangerous.** The game adores books and forbidden knowledge (the sorcerer
   literally levels up by reading). The abbot is what happens when curiosity stops caring who pays.
3. **Keeping watch.** The warden, the watchtower's last sergeant, the animated armor still holding its
   post, the captain who can't sleep: the cost and dignity of guarding something no one thanks you for.
4. **Remembering who you are.** The song unwrites names. Skeletons are people who forgot. The warmest
   quest in the game is helping one remember.

### 2.4 Tone guide

Souls-like weight and mystery, but the lights are on in town. Every dark room should have one thing
that makes you smile, and every warm room one thing that makes you uneasy.

**Rules**
- Characters are funny *because of who they are*, never winking at the player. No modern slang, no
  memes, no fourth-wall breaks.
- Dread is quiet and specific (a child's shoe on a mine track), not gore.
- Lore is offered, not lectured. Item text implies; NPCs disagree; books contradict each other.
- Stakes are real: people can be lost, the minotaur can die, the town can be wrong forever.
- Despair is never the default. Even the darkest ending leaves a lamp lit.

**Voice examples**

| Do | Don't |
|---|---|
| "Three weeks. Seven beds gone cold. I've started counting the doors on my rounds, like that'll help." — Captain Hale | "The town is in grave peril! Only you can save us, hero!" |
| "Rusted watch-key. The sergeant wore it on a cord. The cord outlived him by forty years; the key will outlive us all." | "Old Key: Opens a door in the watchtower. Value 5g." |
| "Goblins don't dream, sweetling. Nothing up here to sing to." — Mother Kettleback | "Me goblin! Me smash!" |
| "Don't touch the red shelf. It's not cursed. It's *expensive*." — Mirela | "Welcome to my shop! Let me show you my wares, adventurer!" |
| "The monks called me Brother Horn. It was a kindness. I have kept it." — Brother Horn | "RAAAARGH! You dare enter my labyrinth, puny human?!" |
| "Lol, this skeleton is so random." (never) | "I had a sister. She laughed like a gate that wanted oiling. I… liked that gate." — Clatter |

---

## 3. The world

### 3.1 The region

Briar Glen sits in a steep green valley at the end of a mountain road — the last town before the
highlands — and at the head of the **River Wend**, which rises from the hills by the Deepworks and runs
down the valley to the sea. The hill is made of **glenstone**, a pale, honey-grey freestone that cuts
clean, carves fine and hardens in sea air. For two and a half centuries the Wend has carried it down to the
sea in barges, and ships have carried it on to palaces, harbours and temples in lands that have never heard
of Briar Glen. Stone made the valley rich. Then, thirty-five years ago, the Vanes struck **silver** at the
heart of the mine, and the silver made the empire rich.

Above the town: the Briarwood, a thick old forest of oak, holly and bramble. On a spur to the east,
**Mooring's Watch**, a barony watchtower abandoned for forty years. North, into the hill: **the Deepworks**,
the Vane family's stone mine, whose oldest galleries follow the best bed of glenstone deep into the hill and
whose newest follow the silver. On the hill beyond the forest: **Bellwater Priory**, the ruined Vesperine
monastery, built of the first glenstone ever cut. Under all of it: **the Knot**. A day downriver by stone
barge, where the Wend meets the sea: **Wendmouth**, a rowdy harbour town built like a city out of the
valley's stone, which ships that stone, and now the empire's silver, to faraway lands (§3.6).

**The empire.** Briar Glen lies in a barony on the far edge of **the empire**, whose capital ("the city" in
valley speech) is weeks away by sea. For most of its history the empire noticed the valley only as the stone
in its own palace walls. Glen silver changed that. The empire mints it into the **crowns** that pay its
armies and buy its neighbours' loyalty, and within a generation it has bent the neighbouring states to its
will. The Saltmarch Isles, who once bought glenstone for their sea-walls, now pay their harbour dues in
imperial silver. The silver goes downriver under imperial seal and leaves Wendmouth in escorted ships, and
every year the empire wants more of it. (The empire is not named in the MVP.)

Paths loop: the forest joins the watchtower and priory; the watchtower's old supply tunnel joins the
upper mine; the priory crypt and the Sounding Shaft join the labyrinth; the town well joins a cistern
that joins the priory. The river is a loop too: the Deepworks' drainage tunnel, **the Weeping Adit**, is
where the Wend springs from the hill, and a raft or a strong swimmer can go *up* it into the lower mine;
the **Millweir** below town can be crossed on its sluice walk to reach the Briarwood's far bank; the
towpath follows the river down past **Kestrel Lock** to Wendmouth. Every loop is a shortcut the player
can open.

### 3.2 History in layers (oldest first)

**The Hornfolk and the Knot (uncounted centuries ago).** Before people came to the valley, the
Hornfolk lived here: tall, bull-headed, long-lived, slow to speak. When the Nightjar came down — Hornfolk
carvings show "a winter when the stars sang and one of them fell" — they could not kill it, because it
is not quite a body. It is a dream that hungers. So they did what their people did best: they wrote.
Hornfolk magic is inscription. A labyrinth is a sentence that never ends; the Knot is a spell carved as
corridors, and anything inside that cannot read cannot find the end. The Nightjar sleeps at the centre,
**the Cradle**, lost in its own prison. Wardens of the Hornfolk walked the Knot for generations,
humming low throat-songs that muffled the Nightjar's voice. Their statues all cover their ears.

**The Vesperine Order (about 300 years ago).** Human monks — scholars of sound and silence — followed
old rumours of "the singing hill," found the last few Hornfolk wardens and made a pact. The monks built
Bellwater Priory directly over the Cradle out of the hill's own pale stone, cut the **Sounding Shaft** straight down to it, and cast the
**Vesper Bell**. Every dusk they rang vespers; the bell's note fell down the shaft and the Nightjar slept
deeply. The Hornfolk kept watch below. The monks kept the books above. For three hundred years it
worked. The Vesperines taught the valley to read, and Briar Glen was founded to feed and supply them.

**The stone and the river (about 250 years ago).** The priory's masons had found that the hill's stone was
finer than any they knew, and word travelled. With the Vesperines' blessing, the townsfolk opened a stone
mine into the hill, underground and following the best bed, under a monastic rule carved over the mine
gate: no shaft below the "Bell Line." Hauling blocks down the mountain road by cart was ruinous, so the
stone went to the river. The Vesperines had already built the Millweir for their grain mill (the bargemen
still touch its keystone bell-mark for luck). The barony dredged the Wend, built **Kestrel Lock** halfway
down the valley to tame the rapids, built Mooring's Watch on the spur to guard the valley and its stone
road, and granted Wendmouth a charter as the valley's port. Flat-bottomed stone barges carry dressed blocks
downstream in a day and are towed back up by horses on the towpath in two, loaded with everything the valley
can't make: salt, cloth, tea, lamp oil, foreign steel, and books. Briar Glen's quay at the foot of the
**Stone Stair** (a stepped slipway from the Deepworks' cutting hall) is the town's second heart. Every family
has someone in the galleries, on the barges, at the lock, or owed money by a Wendmouth merchant. When the
mine sneezes, the river goes quiet, and then Briar Glen goes hungry. The Vane family has run the Deepworks
for five generations. Wendmouth grew rich on the trade and built itself out of it (§3.6).

**The Long Vespers (61 years ago).** Abbot **Corvin Ashgrove** was the finest mind the order ever had
and the first to study the Nightjar's song as text rather than threat. He came to believe the song was a
language — the language dreams are written in — and that whoever could read it could rewrite a sleeping
mind. On midsummer night he removed the bell's bronze tongue and did not ring vespers. The song rose.
The monks, the lay brothers, and a dozen villagers stood up from their beds and walked down the Sounding
Shaft into the Knot. The abbot went with them, awake and joyful. Horn, then a young warden, carried out
who he could — three novices, through the old mine — and collapsed the crypt passage behind him. Only
when the abbot, lost in the Cradle's dream, dropped the song back to a murmur did the Nightjar settle.
Without the bell, it has never slept as deeply since.

The novices told the barony. The Lantern Court (see 3.4) outlawed **Somnomancy**, sealed the priory,
and burned its library — or thought they did. The garrison of Mooring's Watch dwindled for twenty years
and was finally withdrawn about forty years ago; Sergeant **Aldric Mooring** refused the order, stayed
alone, and died at his post. The Deepworks were closed below
the Bell Line. Briar Glen shrank and forgot, the way towns do. Children still sing a skipping rhyme
about "the ox beneath the hill."

**The silver (about 35 years ago).** Cutting a new gallery toward the heart of the hill, Harrow Vane's
grandfather broke into a vein of silver running through the glenstone like a seam of frost: above the Bell
Line, but pointing down. The strike turned a stone town into an imperial concern. The empire granted the
Vanes a silver warrant with a yearly **Measure** owed to the imperial mint, sent assayers upriver and a
Lantern Court inspector to Wendmouth, and began striking crowns from Glen silver. The silver outspent and
outlasted the empire's rivals; in thirty years it has made the empire the power of its world. For Briar Glen
it has been a mixed blessing. The Vanes grew rich. The best cutters were moved from the stone galleries to
the silver, fewer stone barges run each year, and the valley's old trade is slowly being hollowed out for
the empire's new one.

**The Breach (3 months ago).** The empire's Measure rises every year; the vein above the Bell Line does not.
**Harrow Vane**, grandson of the man who struck the silver, has been dreaming of the vein running rich below
the Line — dreams the abbot has been gently sending. He dug below the Bell
Line and broke into the Knot's outer ring. He found Hornfolk horn-coins and carvings, sold them quietly
to a buyer in the city, and sealed the lower mine "for safety." The relics go downriver packed among the dressed blocks of
ordinary stone barges, sit in Vane's bay of the **bonded warehouse** in Wendmouth under a customs seal that no one
opens, and sail on the merchantman **Gilded Tern** to "Mr. S—." Vane is also deeply in debt to Wendmouth's
merchant factors, who have fronted him credit against silver he has promised the mint and cannot reach. The breach cut the Knot's sentence. The
song leaks out through the gap and, on still nights, reaches the town.

**Now (the last 3 weeks).** Six people have walked into the dark: Moss Greaves the tanner, Ettie Lark
the milkmaid, Rowan Tate and Harlan Burr (miners), Mina Coles the schoolteacher, and Fitch, the barman at
the Sleeping Ox. Horn, old now and tired, has caught every one before the Cradle and laid them in the
Fold, a sealed Hornfolk vault where they sleep, unharmed, fed by goblins, until the song stops. The town
has seen only a horned giant carrying their neighbours away. On the player's first night, the seventh
walks: **Tansy Pell**, twelve years old, the baker's daughter.

### 3.3 Magic and society

**Magic is language.** A spell is a sentence the world agrees to obey. That is why magic lives in
books: the precise phrasing, rhythm and diagram matter, and memory is unreliable. A spellbook is read,
practised and *learned* (per `e07-spellbook-learning`); once learned, the sorcerer can cast the spell,
but the book still matters — damaged, water-stained or mistranslated books teach damaged spells, which
misfire in interesting ways. This is also why the Hornfolk wrote a prison: to them, carving was the
strongest magic there is.

Consequences for the world:
- **Bookshops are the armouries of sorcerers.** A good bookseller is part scholar, part smuggler, part
  gatekeeper. Books are expensive, loaned, stolen, copied badly, and fought over.
- **Literacy is uneven.** The Vesperines taught Briar Glen to read, so the town is unusually bookish for
  a stone-cutters' town: a lending shelf at the inn, a schoolhouse, a bookshop far too good for the town.
- **Goblins cannot read** (their language is gesture and smell) — which is why Snig wants to learn so
  badly, and why the Knot has never lost a goblin: they don't read the sentence, so they don't get caught
  in it. They also do not dream, making them immune to the song.

**Schools and the law.** The Lantern Court, the empire's royal-and-scholarly authority in the capital,
licenses magic.
Licensed books carry a pressed lantern seal.
- *Licensed:* Fire, Frost, Storm, Light, Nature, Alteration, Arcane.
- *Restricted* (sale requires a Court writ): Illusion, Conjuration, Gravity, Shadow.
- *Forbidden:* Necromancy, Time and — since the Long Vespers — **Somnomancy** (dream magic).

In practice, small towns ignore restrictions and whisper about forbidden books. Mirela sells restricted
books under the counter and keeps one forbidden book she will not sell to anyone.

### 3.4 Factions

| Faction | What they want | Texture |
|---|---|---|
| **The townsfolk of Briar Glen** | Their people back; the mine to keep the town alive. | Frightened, stubborn, kind to strangers who help. They will believe the minotaur is a monster until shown otherwise — and some never will. |
| **Vane Deepworks** | Silver enough to meet the empire's Measure, or anything worth as much. | Vane is not a cartoon: without the mine, Briar Glen dies, and if he fails the Measure the warrant goes to someone who will care about the valley even less. He lied to protect the town and himself, and can't tell which mattered more. |
| **The empire** | Silver, more every year. | Offstage and everywhere: the imperial seal on silver barges, the Measure, crowns in every purse, and the Lantern Court as its hand on knowledge. The MVP shows it only through objects, notices, escorted silver ships and Inspector Cray. |
| **The Rootcellar Goblins** | Shiny things, safe tunnels, to be left alone. | A clan of ~20 displaced from their warrens by the breach. Immune to the song; scavenge the Knot; have a quiet deal with Horn (food for the sleepers in exchange for salvage rights). Blamed for the disappearances. |
| **The Warden (Brother Horn)** | The Nightjar asleep; the sleepers safe; to be allowed, finally, to rest. | Last of the Hornfolk. Bound by oath never to leave the Knot. |
| **The Forgotten** (the lost Vesperines) | Nothing, now. Habit. | Skeletons of monks and miners who walked in and forgot themselves. Still sweeping, praying, carrying buckets. Hostile only when disturbed or when the song swells. |
| **The Sleepless Abbot** | To hear the whole song, and to write in it. | Corvin Ashgrove's wraith, kept "awake" by the dream for 61 years. Horn stands between him and the Cradle's centre. He guides the player as "a friend below". |
| **The Lantern Court** | Order; control of dangerous knowledge. | Mostly offstage: seals on books, a posted edict, a letter — and one official in person, **Inspector Prudence Cray** at the Wendmouth customs house, who confiscates restricted books at the dock. A post-MVP threat and a sorcerer's natural antagonist. |
| **The Low Tide Company** (Wendmouth smugglers) | Untaxed cargo, a quiet harbour, no Lantern Court. | Nell Gannet's crew of dockhands, lightermen and pickpockets. Run the black market (the Undertow). Rivals, employers or victims, depending on the player. Human enemies if crossed. |
| **The Wendmouth factors** | Their money back from Vane. | Merchant creditors of the harbour. Offstage except through Jasper Quell, Vane's shipping agent, who fears them more than he fears the law. |

### 3.5 Locations (MVP)

**Briar Glen (town)** — Market Green and the notice board; **the Sleeping Ox** inn (Dot's; its front door is on the shop lane, further up the west side than Marsh's); **the Lamplit
Stacks** bookshop (Mirela's); Brand's Forge; Fenn's Fletchery & Simples; Pell's Bakery; **Marsh's General Store** (§5.15); the Watch House
and its one-cell jail; Vane House on the rise; the schoolhouse (empty; its teacher is missing); the Glen
Well (a loose ladder-rung leads to the old cistern); the lychgate cemetery with Vesperine graves.

**The Miners' Bridge (Briar Glen)** — a broad stone bridge of glenstone arches over the River Wend, built about two
hundred years ago so miners could reach the nearest mine without the long way round. It made the Deepworks easy
to reach and the town easy to attack: before the bridge, the river was Briar Glen's wall. Today the **Bridge
Watch** (part of Captain Hale's Watch, §5.2) keeps a guard post on the town end by day and night, and turns
away hooligans and monsters; nothing that is not a person on business crosses it. Everything a traveller
brings into Briar Glen from the valley passes the post first, and Marsh's General Store is the first building
past it. The bridge is canon (owner, 2026-10-04). The Watch wear tabards and stand just inside the town end, beside a brazier and lamp (owner-reviewable greybox decision, mw-ju8.12). Guard names, shift times and what the post does with
armed or armoured strangers are open.

**The Bridgeward College (placeholder name, Briar Glen)** — the bridge's second legacy: the garrison that had
to be kept at the town end grew over two centuries into a soldierly training college inside the town, where
townsfolk and strangers learn **fighting** (knight techniques, mw-e19.8) and **archery** (the archery range,
mw-e05.14). It does not teach sorcery. The Lantern Court's licence (§3.3) keeps a licensed school out of a
frontier town, and the college's old soldiers regard casters as unreliable. Instructors, fees and entry terms
are open until the next sentence: the college stands at the far end of the lane's west side, past the Sleeping Ox. Its instructors, lessons
and fees are settled as greybox decisions in §5.16 and `docs/design/bridgeward-college.md` (mw-ju8.13, owner-reviewable).

**The robed figure under the bridge (unnamed)** — sorcery is learned elsewhere: after dark, beneath the
Miners' Bridge, a robed figure waits for those who ask the right questions (rumours, Dot, Mirela). Who they
are, what they charge and what they teach are open. They are not licensed by the Lantern Court. They appear
only at night.

**Marsh's General Store (Briar Glen)** — the first building a traveller reaches after crossing the
stone bridge into town. A crooked three-storey timber-framed shop with a slate roof: the ground floor is the
shop (clothes, boots, gloves, basic arms and armour, food, simple potions and jars, herbs); the shopkeeper,
Ottilie Marsh (§5.15), lives upstairs, reached by a wooden stair inside and an outside gallery stair. Painted
sign: a lantern and a barrel, pictures only. Concept art: `concept-marsh-store-*` (mw-ju8.8). The name is owner-confirmed (2026-10-04); how its stock sits beside Brand's Forge and Fenn's Fletchery is settled by the shop catalogue beads (mw-ju8.3, mw-ju8.5).

**The Briarwood (wilderness)** — the Sleepers' Path (a line of trampled ferns only visible at night or to a
sharp eye); the Standing Horn (a Hornfolk menhir, hands over its ears); the wolf den; the woodcutter's
empty hut; the millpond and the drowned lane; the priory road.

**Mooring's Watch (watchtower)** — goblin lookout below, Hollow Sentinels above; the keeper's log; the
signal mirror on the roof; a collapsed supply tunnel into the upper Deepworks.

**The Deepworks (stone and silver mine)** — the boarded main gate with the Bell Line rule carved above it;
the winch house; the old glenstone galleries (square pillared halls, half-cut blocks still in the walls);
the silver galleries; Vane's sealed lower gallery; the breach; the Rootcellar goblin camp in the old cutting
hall.

**Bellwater Priory (ruined monastery)** — the roofless nave; the choir with its singing-monk statues; the
scriptorium (and its book mimics); the belfry with the silent, cracked Vesper Bell; the crypt (sealed
from below); the cistern.

**The Knot (labyrinth)** — the Outer Ring (Hornfolk runes, loom spiders); the Ossuary Galleries (the
Forgotten); the Chapel of Echoes (where sound misbehaves); the Fold (sealed sleepers' vault); Horn's Hall;
the Sounding Shaft's foot; **the Cradle** (the heart).

**The River Wend (connective route)** — Briar Glen Quay and the Stone Stair; the Millweir and its sluice walk;
the Weeping Adit (the river's source, a flooded drainage tunnel into the lower Deepworks); the towpath;
Kestrel Lock and the lock-keeper's cottage. Travel between Briar Glen Quay and Wendmouth is by barge ride
(a narrated journey / fast travel) or on foot along the towpath; the river itself is not a flowing-water
simulation.

**Wendmouth (optional harbour town)** — see §3.6.

### 3.6 Wendmouth — the harbour at the river mouth

**What it is.** A harbour town of a few hundred souls where the Wend's brown water meets the grey sea,
built, improbably, like a city. Two and a half centuries of glenstone have passed through Wendmouth, and a
good deal of it stayed: blocks cracked in loading, offcuts, rejects, and whole shiploads left on the quay
when a foreign buyer went bust. The quays are colossal stepped blocks worn smooth by barge hulls. The
**breakwater** is a great curving wall of rejected blocks, each still carrying its mason's mark. The
warehouses are vaulted stone halls, the Customs House has columns a palace would envy, treadwheel cranes
stand on stone piers, and yards of cut blocks wait in rows for their ships, like a city waiting to be built
somewhere else. Everyday life is timber on stone bones: net lofts, tarred sheds, bright shopfronts and
laundry lines perch on and lean against the stonework, and the gulls have criminal records. Stone barges tie
up at the Stone Wharf; seagoing ships moor at the deep-water quay or anchor in the pool and send lighters
in. Everything the valley buys comes through here. The stone and the empire's silver leave through here,
the silver under imperial guard, and much of everything else leaves without troubling the tax clerk. Where Briar Glen is
quiet, frightened and bookish, Wendmouth is loud, cheerful and on the make. **This is where shenanigans
ensue.**

**Why go (design intent).**
- **Sneakiness is richly rewarded.** Customs house, bonded warehouse, cargo manifests, rooftops and ship
  rigging, pickpocketable crowds, dockhand disguises, smugglers' tunnels under the fish market. The thief's
  playground.
- **Everyone else gets hijinks.** Knights brawl, arm-wrestle and duel; archers win shooting contests and
  cut cargo nets; sorcerers gust sails, freeze the harbour pool and dodge a customs inspector who
  confiscates restricted books.
- **Better gear.** The Tidemarket is plainly better stocked than Briar Glen — foreign weapons and armour,
  exotic arrows, rare foreign spellbooks — and the Undertow black market sells smuggler thief tools and
  the things the Tidemarket can't.
- **Evidence and leverage for the main plot.** Vane's relic shipments pass through here (side quest
  *The Crate for Mr. S—*).

**When.** Reachable from the morning after the first night (Act I, beat 3) onward. Mags Oakum's barge
leaves Briar Glen Quay each morning; she won't run at night ("not with whatever's singing up there"). The
towpath is always open. The Gilded Tern stays in harbour, loading slowly, until **Act III begins** — then it
sails, with or without Vane's crate. There is no real-time clock.

**Places.**
- **The Stone Wharf** — barges unload dressed blocks onto the great stepped quay; treadwheel cranes, cargo
  nets, block yards and stacked crates; the Tidefair contests are held here on the open flagstones. At its
  far end, behind an iron gate and imperial guards, the Silver Quay where the Measure is loaded (seen, not
  entered, in the MVP).
- **The Customs House** — a columned glenstone hall; Lantern Court flag, a scale for weighing cargo, a strongroom of confiscated goods
  (including books), Inspector Cray's office with its suspiciously well-read shelf.
- **The Bonded Warehouse** — a vaulted stone hall of sealed bays for goods awaiting export; **bay nine** is Vane Deepworks'. Skylights,
  hoist beams, a night watchman, and a manifest desk.
- **The Drowned Gull** — tavern on the breakwater end, run by Nell Gannet; arm-wrestling table, dice, a
  trapdoor to the Undertow.
- **The Tidemarket** — covered import market: Tereza Maelo's arms stall, a foreign bookseller's cart,
  spice, silk, oddities.
- **The Undertow** — the black market in the old block-vaults beneath the fish market, where stone once
  waited out the winter storms and smugglers now wait out the Inspector; tunnels to the Drowned Gull and the
  harbour wall.
- **The Net Lofts and rooftops** — a continuous roof route across the waterfront for climbers.
- **The Gilded Tern** — a three-masted merchantman in the pool: rigging, hold, captain's cabin, the
  locked passenger berth of "Mr. S—'s agent."
- **The Breakwater and the sunken figurehead** — where the sea-serpent rumour lives.

**What the market sells (for economy/bookshop planners; flavour, not stats).** Foreign weapons (curved
Saltmarch sabres, harpoon-spears, lacquered round shields), sharkskin brigandine and other light armour,
exotic arrows (whistling, netting, tar, glass-headed, grapple), rare foreign spellbooks (Storm, Illusion and
Gravity texts from over the sea — restricted ones must be smuggled past Cray), and in the Undertow: smuggler
thief tools (tide-silk rope, glue-soled boots, smoke pearls, a skeleton-key ring, a customs-seal stamp).
Mirela is not pleased that a foreign book cart exists, and will pay well for anything it won't sell.

### 4.1 Beat sheet

**Act I — Help Wanted**

1. **Arrival (dusk).** The player arrives on the mountain road as the bounty is nailed up: *WANTED — the
   Beast of the Deepworks. 500 crowns, paid by H. Vane.* Short class-specific opening (4.3).
2. **The first night.** At the Sleeping Ox, Dot gives you the last room. Past midnight the town goes
   silent; the player wakes to see Tansy Pell walking barefoot up the street, eyes open, humming. The
   player can follow (tutorial for movement/stealth/interaction). She cannot be woken — shaking her makes
   her hum louder. At the mine gate the player glimpses a huge horned shape lift her gently and vanish
   inside. The gate is barred. *Failure is fine:* lose her, fall behind, get blocked by wolves (who, oddly,
   let her pass) — the beat always ends with the horned shadow.
3. **Morning: the town wakes angry.** Hollis Pell is inconsolable; Captain Hale is out of his depth; Vane
   raises the bounty to 800 crowns in a public speech. The player is now, officially, the hireling.
4. **Investigation (open hub).** The player gathers threads in any order:
   - Hale's list of the missing and his map of where footprints ended (all toward the mine).
   - Mirela: the skipping rhyme is older than the town; the priory "had a bell that was rung against
     something." She sells or lends *The Vesperine Hours* (contains the Vesper hymn — a key item).
   - Dot's rumours (section 6.2), including "goblin trinkets found where people vanished."
   - Juniper: the wolves have stopped howling; she found the Sleepers' Path.
   - *Optional:* Mags Oakum at the quay offers a barge ride to Wendmouth "if you've got business with
     people who don't ask questions" — the harbour thread (§3.6, §6.1 quests 6–8). Vane's shipping evidence,
     better gear and a befriend-Horn item can be found there; none of it is required.
   - A folded note under the player's door, in old-fashioned hand: *"The beast keeps them in the dark.
     Come down and I will guide you. — A friend below."* (The abbot, via a sleepwalker's hand: Captain
     Hale delivered it in his sleep. Hale does not know.)
5. **Getting in.** The Deepworks is sealed by Vane's order. Routes: Vane's key (persuade, bargain, steal);
   smash the rotted side-boarding (knight); shoot the winch pulley to drop the cage (archer); Mage Hand the
   inner bar or Ember the rope latch (sorcerer); pick the padlock or climb the ventilation chimney (thief);
   or go the long way through the Briarwood, Mooring's Watch and its supply tunnel (any class); or go *up*
   the river through the flooded Weeping Adit (swim, raft, Frostglass the current's edge, or ride in on an
   empty stone barge being winched back up — any class, found via Mags or rumour 16).

**Act II — The Deep and the Dead**

6. **The Deepworks and the goblins.** The upper mine is Rootcellar territory. Goblins are wary, not
   murderous. Mother Kettleback's camp can be fought, sneaked through, or talked to. Talking reveals:
   goblins don't dream; they have seen "the Big One" carrying sleepers "to the soft room"; and they are
   being framed (see side quest *Framed in Brass*). Vane's sealed gallery holds his ledger (horn-coin
   sales), a Hornfolk horn-ring he pried off a carving, and the breach itself.
7. **The Outer Ring.** The player enters the Knot. Hornfolk runes line every wall; the player learns the
   first rule of the Knot (followed runes lead somewhere; ignored runes lead in circles). The "friend
   below" leaves chalk marks and notes, genuinely helpful ones. First Forgotten; first loom spiders; first
   sighting of Horn at a distance, dragging something wrapped in cloth.
8. **The Ossuary and Clatter.** Among the skeletons, one keeps apologising while it fights — or doesn't
   fight at all if you hum the hymn. This is **Clatter**, once Brother Anselm Hobb. He remembers
   fragments: a pear tree, a sister, "the abbot's hands shaking the night he took the tongue." Starts
   *The Name on the Bones*.
9. **The Priory (can happen before Act II through the forest).** The belfry: the Vesper Bell is intact
   but cracked and has no tongue. The scriptorium's surviving pages and the choir-statue puzzle reveal the
   pact, the Sounding Shaft, and the abbot's letters. The crypt door is sealed from the other side.
10. **The Warden.** The player finally faces Horn in Horn's Hall, outside the Fold. He will not let the
    player pass — he doesn't know whether you're another sleepwalker, a treasure-hunter, or the abbot's
    new hands. This is the pivotal encounter (4.2). Every resolution eventually lets the player into the
    Fold, where the six missing (and Tansy) lie asleep on moss beds, breathing, with goblin-brought bread
    at their sides. **The reveal lands visually before anyone explains it.**

**Act III — Long Vespers**

11. **The second reveal.** Whatever happened with Horn, the "friend below" now speaks aloud: the abbot
    appears, a lantern-lit monk made of dream-fog, thanks the player warmly, and — if Horn lives — asks
    the player to finish him ("He is old, and he is in my way, and you are so very good at this"). If Horn
    is dead, the abbot simply walks past the player toward the Cradle, delighted. The song swells. In the
    Fold, Tansy stands up and starts walking.
12. **The Cradle.** The heart of the Knot: a round chamber where the dream leaks into the physical.
    Hushlings, the Forgotten stirring, and the abbot at the centre, conducting. The abbot holds the Vesper
    Bell's tongue. Resolutions for the abbot:
    - **Fight** him (a wraith: fog body, solid only while singing; sound and light break his concentration).
    - **Trick** him (thief lifts the tongue from his belt mid-song; sorcerer's Mirror Self sings the hymn
      in his voice so the Forgotten turn on him; archer shoots out the lanterns that anchor his form).
    - **Persuade** him to rest — only possible if Clatter remembers his name and comes to the Cradle
      ("Corvin. You promised we'd go back up for pears.").
    - **Join** him (dark path; 4.4).
13. **The Climb.** With the tongue recovered, the bell must ring. The Sounding Shaft runs straight up to
    the belfry: a vertical ascent (ropes, counterweights, old bell-ropes) with the song rising behind.
    If Horn lives, he holds the foot of the shaft against the Hushlings; if he's dead, the goblins (if
    befriended) or Clatter (if restored) hold it; if no one, the climb is a chase.
14. **Vespers.** The player hangs the tongue and rings the cracked bell. It sounds wrong and beautiful.
    Down the shaft, the song falters, and the Nightjar sleeps. Sleepers wake in the Fold, confused and
    hungry. Tansy asks who you are.
15. **Morning after.** Return to Briar Glen. The town's reaction depends on who you bring back, what
    you tell them, and what you can prove. Vane's reckoning (6.1 *Framed in Brass*, or a direct
    confrontation with his ledger). Bounty paid, or refused, or given to the Pells.
16. **Epilogue** — see endings (4.4).

### 4.2 The Warden encounter — resolutions

Horn fights to *stop*, not to kill: at low health the player is knocked down and dragged to the Fold
(4.5). Resolutions (combinable; tracked as world-state facts):

| Resolution | How | Consequence |
|---|---|---|
| **Fight & kill** | Beat him in combat; when he yields ("Enough. Hear me, or finish it."), finish him. | Bounty claimable. The Knot loses its warden; the song swells sooner and harder in Act III. The abbot is openly grateful. Horn's horn becomes an item: *"It still hums, faintly, if you hold it to your ear. Keep holding it."* |
| **Fight & spare** | Beat him, then listen. | He tells the truth, wounded. He cannot hold the shaft in Act III without healing (Juniper's salve, a Nature spell, or rest in the Fold). |
| **Trick** | Sneak past entirely; lure him away with a Mirror Self; trap him behind the dropped portcullis in the Chapel of Echoes (archer shoots the counterweight); steal the Fold's horn-key from his belt while he "rests one eye." | You reach the Fold without him. When he finds you there, he is angry, then weary, then honest — unless you flee. |
| **Befriend** | Hum the Vesper hymn; return his mother's horn-ring from Vane's gallery; return the Hornfolk name-stone recovered from Vane's crate in Wendmouth; have Snig or Clatter vouch; or lower your weapon and wait (he will circle you three times, then speak). | Full ally. He shares Hornfolk lore, opens the crypt shortcut to the priory, and fights beside you at the shaft. |
| **Help** | After befriending: bring him bread for the sleepers, heal him, and seal the breach (collapse Vane's tunnel, freeze and shore it, or have the goblins wall it). | Best outcome. Sealing the breach restores the Knot's sentence; the ending adds "the song never reaches the town again." |
| **Knight: the Trial of Horns** | Hornfolk honour duel: no killing, first to three clean parries/blocks wins the right to be heard. | Counts as Befriend; Horn is delighted anyone still knows the form. |

### 4.3 How each class experiences the key beats

**Knight — "The Oath for Hire."** A knight of the disbanded Baron's household, now selling a sword.
Came for the bounty; is openly weighed by the town as muscle.
- Arrival: Vane courts you personally ("A proper sword. Finally.").
- Mooring's Watch: only the knight can *formally relieve* the Hollow Sentinels — speaking the old words of
  the watch, they salute and fall still. Others must sneak, shatter or dispel them.
- Getting in: shoulder through rotted boards; clear the collapsed supply tunnel by hand.
- Wendmouth: the Drowned Gull's arm-wrestling table (Big Oona), a tavern brawl you can start or end, and a
  duel with Tereza Maelo, who retired from duelling and is looking for a reason not to be.
- Horn: the Trial of Horns. Horn to a knight: "You stand like the barony's men stood. They were brave,
  and they were always leaving."
- Climax: can hold the shaft's foot yourself while a restored Clatter climbs with the tongue — a sacrifice
  beat where you fight until the bell rings and the Hushlings dissolve around you.

**Archer — "The Silent Wolves."** A Greenmarch ranger tracking a wolf pack that has stopped howling.
Came for the wolves; stayed for the people.
- Arrival: Juniper treats you as a peer; Hale asks you to scout.
- Night one: you can see the Sleepers' Path when others can't (tracking clue on the trampled ferns).
- Mooring's Watch: turn the signal mirror to throw light across the valley onto the priory's hidden choir
  door; shoot the tower's bell cord to "end the watch" for the Sentinels.
- Wendmouth: the Gull Shoot at the Tidefair; cut the cargo net as Vane's crate is hoisted aboard the Tern
  so it drops into the harbour; rigging shots from the net lofts.
- Horn: drop the Chapel portcullis with a single shot. Horn to an archer: "You looked at me a long time
  before you drew. Look longer."
- Climax: shoot a rope line up the Sounding Shaft to skip half the climb; shoot out the abbot's anchor
  lanterns.

**Sorcerer — "The Letter from the Lamplit Stacks."** Summoned by Mirela: "I have come by something you
will want to read. Come before the Lantern Court does."
- Arrival: Mirela opens the back room to you (restricted shelf access, a discount, and suspicion).
- Books matter most: *The Vesperine Hours*, the abbot's letters, and fragments of Hornfolk inscription
  unlock dialogue options and the Cradle's secret route.
- The abbot's temptation is aimed at you: he offers to teach you **Somnomancy** (a unique forbidden
  spell, *Lull*, which puts creatures to sleep — genuinely excellent). Accepting leaves a "dreamer" mark:
  Hushlings ignore you, but you begin hearing the song in town, and Mirela will know.
- Wendmouth: Inspector Cray confiscates restricted spellbooks at the dock — including yours if you carry
  them openly. Gust a racing sail at the Tidefair regatta; freeze the harbour pool to walk to the Tern.
  The foreign book cart has the best spellbooks in the MVP, some of which must be smuggled.
- Horn: Mirror Self decoys; or read the runes on his axe aloud (they are his name). Horn to a sorcerer:
  "The last one who read that well took the bell's tongue."
- Climax: mend the bell's crack with Frostglass/Alteration before ringing — a truer note, and a better
  epilogue for the Nightjar's sleep.

**Thief — "A Commission from the City."** Hired by an anonymous buyer to lift one horn-coin sample from
Vane's strongbox. (The buyer is Vane's buyer — he suspects Vane of salting shipments with fakes and wants
a sample taken from the source. Post-MVP hook.) The drop is at the Drowned Gull in Wendmouth; Nell Gannet
is the go-between. You can deliver the coin, keep it, or deliver a fake.
- Arrival: Dot recognises your kind and offers her back room and her fencing rates.
- Vane House: rooftop route, strongbox, ledger — the thief can have proof of Vane's lie before Act II.
- Goblins treat you as kin ("You smell like pockets"); Snig tries to pick your pocket and you can let him.
- Wendmouth is your level: the bonded-warehouse heist, dockhand disguises, manifest forgery, the Undertow's
  tools, and a pickpocket race at the Tidefair.
- Horn: sneak all the way to the Fold without being seen. He finds you inside, sitting with the sleepers,
  and just says: "You walk quietly. So did the abbot. Why are you here?"
- Climax: pickpocket the tongue from the abbot mid-song — the single most satisfying theft in the game.

### 4.4 Endings

Endings are assembled from world-state facts (Horn's fate, abbot's fate, Vane's fate, breach sealed,
Clatter restored, goblin standing, Tansy saved). Four headline endings; epilogue slides vary within each.
Optional harbour facts add slides but never change the headline ending: if Vane's crate was intercepted,
the name-stone goes home to the Knot; if the Gilded Tern sailed with it, the last slide is a man in a
far city prising open a crate and finding a tiny ox asleep on every coin (post-MVP hook).

1. **"Vespers Rung"** (Horn alive, abbot at rest or defeated). The bell rings each dusk again — the goblins
   ring it, or Hale does, or Tansy insists on learning. Horn remains below, but now the town brings bread
   to the mine gate. If the breach was sealed: the song never reaches the town again. If the player spoke
   for Horn publicly, the children's rhyme gets a new last verse.
2. **"The Last Warden"** (Horn dead, bell rung). The sleepers come home and the bounty is paid. The Knot
   has no warden. Epilogue: Mother Kettleback's clan takes up the watch in their own way; or Clatter walks
   the halls humming; or no one does, and the last slide is a lantern at the mine gate, and a child's
   footprints in the dust, going in. (Hook, not doom.)
3. **"The Hireling's Silence"** (sided with Vane: bounty claimed, ledger buried, breach left open). The
   mine prospers on silver from below the Line and on Hornfolk gold; the town is grateful; the bell is rung — mostly. On still nights,
   someone always sits up in bed. You were well paid.
4. **"The Long Vespers"** (joined the abbot, or failed to ring the bell). The whole valley sleeps. The
   final text is the player waking — years later? moments? — in the Cradle, the abbot gone, a goblin
   poking them with a stick: "Oi. You're the only one up. Everyone's snoring. Fix it." The game ends on
   a doorway, not a grave. (Post-MVP continuation hook; the MVP does not expect players to choose this.)

### 4.5 Failure creates stories (main quest)

- **Dying in the Knot** doesn't reload you to a bonfire: **you wake in the Fold**, laid on a moss bed next
  to the sleepers, with a bandage you didn't tie. Before the reveal it is eerie ("Who put me here?");
  after, it is the point. Horn has been saving you the same way. Each "rescue" is a world fact; Horn
  remarks on the count. If Horn is dead, you wake instead in the goblin camp (Kettleback charges a
  "carrying fee" in coin or trinkets) or, if the goblins are hostile, among the Forgotten, who have laid
  you out like a monk for burial.
- **Dying in the Briarwood** — you wake at the Sleeping Ox; Juniper found you. She mentions where.
- **Losing Tansy on night one** doesn't matter; **failing to stop her in Act III** does — she reaches the
  Cradle and the abbot uses her as a hostage in the final scene (a harder, still-winnable climax).
- **Caught stealing in town** — Hale jails you. The cell has a loose stone (a Vesperine-era drain) that
  leads to the cistern and the priory. Jail is a secret entrance.
- **Caught by goblins** — dragged to Mother Kettleback, who is less interested in punishment than in
  making you useful. Opens negotiation even if you arrived swinging.
- **Ringing the bell without its tongue** (hammer, mace, arrow, Thunderclap) — a sour, cracked note that
  wakes every Forgotten in the priory and draws Hushlings up the shaft. But Horn hears it too, and it is
  the one sound that makes him come *to* you.
- **Caught in Wendmouth** — dockhands don't call the watch; they throw you off the pier. You surface by the
  breakwater, next to the sunken figurehead and a smugglers' sea-door you'd never have found otherwise.
- **Caught with restricted books at customs** — Cray confiscates them (never forbidden-plot items) and
  files them in the customs strongroom. They can be bought back with a writ, stolen back, or charmed back
  (*Contraband Pages*).
- **Losing the Drowned Gull drinking contest** — you wake in the Gilded Tern's hold among the crates,
  shanghaied as crew. You are now *inside* the ship you were trying to infiltrate.
- **The Tern sails** before you act — not a failure state; the crate becomes an epilogue hook, and the
  manifest copy in the customs house still proves Vane's shipments.
- **Accepting the abbot's gift** (sorcerer's Lull, or any class's "help") — marks you; future dialogue
  changes; Horn trusts you less.

---

## 5. Cast

Twelve principal characters. Each lists want / fear / secret / voice, and class reactions.

### 5.1 Mirela Thorne — the bookseller
Owner of **the Lamplit Stacks**, a crooked three-storey bookshop that leans on the forge next door.
Fifties, ink-stained, reading glasses on a chain, keeps a tin of ginger biscuits for good customers.
Her shop is the town's secret heart and the sorcerer's main destination: rotating stock, a restricted
shelf behind a curtain (Court seals, writ required, wink), a buyback counter that pays for rare finds
from the dungeon, a reading nook where the town's lending shelf lives, and **Mortimer**, a tame book
mimic who guards the rare shelf and bites shoplifters.
- **Want:** to keep the shop, and knowledge, alive in a town that's shrinking.
- **Fear:** the Lantern Court. One inspection and she loses everything.
- **Secret:** her grandmother Ysolde was one of the three novices Horn carried out of the Knot. Mirela
  owns the abbot's personal treatise, *Nine Sleeps*, the one forbidden book she will never sell. She has
  read it. She dreams the song sometimes.
- **Voice:** "Don't touch the red shelf. It's not cursed. It's *expensive*." / "A book about a thing is not
  the thing. That's the first lesson and the last one people forget."
- **Class reactions:** Sorcerer — colleague, suspicion, back-room access. Knight — "Can you read, or do you
  just carry things?" (she is delighted if you can). Archer — sells maps and bestiaries. Thief — watches
  you like Mortimer does; offers a job retrieving a book "someone borrowed permanently."

### 5.2 Captain Brannoc Hale — the guard captain
Sixty, big, grey, the entire Watch of Briar Glen plus two teenagers with spears. Honest, tired, rumpled.
- **Want:** the missing home; one full night's sleep.
- **Fear:** that he's too old for this and everyone knows it.
- **Secret:** *he sleepwalks.* He wakes with mine dust on his boots and hides it. He delivered the "friend
  below" note in his sleep (side quest *The Captain's Boots*).
- **Voice:** "Three weeks. Seven beds gone cold. I've started counting the doors on my rounds, like that'll
  help."
- **Class reactions:** Knight — relieved, formal, treats you as a peer. Archer — "Scout the tree line for me,
  would you? My knees don't do tree lines." Sorcerer — polite, uneasy; asks if you "can do something about
  the dreams." Thief — "I know what you are. Don't make me prove it." (He will, badly.)

### 5.3 Harrow Vane — the mine owner
Forty, handsome, tailored, generous in public. Chairs the town council because he pays for it.
- **Want:** to save the Deepworks, and with it the town and his name.
- **Fear:** being the Vane who lost the warrant, and five generations with it.
- **Secret:** he dug below the Bell Line after months of vivid dreams (sent by the abbot), broke into the
  Knot, sold Hornfolk horn-coins in the city, and posted the bounty to have the "beast" removed from his
  new treasure. His foreman is planting goblin trinkets at vanish sites.
- **Voice:** "I employ a third of this valley. When the mine sneezes, Briar Glen catches its death. So yes —
  I'd like the monster dead, and I'd like it done quietly."
- **Redeemable?** Yes, partly. Confronted with the Fold and the truth, he can confess, fund the bell's
  repair, and pay the bounty to the Pells. Or he can bribe you (ending 3).
- **Class reactions:** Knight — courts you as his champion. Archer — treats you as hired help. Sorcerer —
  asks, too casually, whether you can "read old carvings." Thief — never meets you by daylight if you're
  smart.

### 5.4 Odette "Dot" Farrow — innkeeper and rumour-monger
Keeper of the Sleeping Ox (sign: a peaceful ox asleep under a moon — the town finds this less funny than
it used to). Sharp, warm, missing her barman Fitch more than she admits.
- **Want:** Fitch back; to know everything first.
- **Fear:** being useless in a crisis.
- **Secret:** she runs a quiet fencing business out of the cellar, and kept one "goblin trinket" found at a
  vanish site because it had a Vane Deepworks stamp on the back.
- **Voice:** "A rumour's just the truth wearing someone else's coat. Buy a drink and I'll tell you whose."
- **Rumour system:** Dot trades rumours for coin, drinks or rumours you bring back. She is the main rumour
  source (6.2).
- **Class reactions:** Thief — back room, fence prices. Knight — "Mind the beams, love." Archer — keeps game
  for your snares. Sorcerer — asks you to light the fire without burning the inn down (you can fail).

### 5.5 Hollis Pell — the baker (and Tansy)
Big-handed, flour to the elbows, a widower with one child. **Tansy Pell**, twelve, clever, reads
everything in the Stacks she's not supposed to, walks into the dark on night one.
- **Want:** Tansy back.
- **Fear:** that he slept through it.
- **Secret:** Hollis's great-grandmother was the sister of Brother Anselm Hobb — Clatter. The Pell family
  Bible has a letter from Anselm (side quest *The Name on the Bones*).
- **Voice:** "I bake at four. I was *up*. I was right there with my hands in the dough and she walked past
  the window and I didn't—" (He stops.)
- **Class reactions:** mostly the same — he wants anyone who'll help. Knight gets bread for the road;
  archer gets told where Tansy liked to play; sorcerer gets Tansy's library card; thief gets the spare
  key and a plea not to judge the mess.

### 5.6 Juniper Fenn — fletcher and herbalist (merchant)
Thirties, sunburnt, laconic, sells arrows, snares, salves and sleep-draughts at Fenn's Fletchery & Simples.
Knows the Briarwood better than anyone.
- **Want:** the wolves back to normal. The silence frightens her more than howling ever did.
- **Fear:** fire in the Briarwood.
- **Secret:** she's been selling sleep-draughts to half the town — and they make the song *easier* to
  follow. She has just worked this out.
- **Voice:** "Wolves don't go quiet. Not unless something bigger is listening."
- **Class reactions:** Archer — peer; trick arrows and trail lore. Knight — "You'll clank. Everything will
  hear you. That's fine, it'll hear you coming and leave." Sorcerer — trades herbs for Nature-school
  scraps. Thief — sells poisons only after you've done her a favour.

### 5.7 Oswin Brand — the smith (merchant)
Seventy, deaf in one ear, loud in both. Forges tools for the mine and swords for nobody, until now.
- **Want:** one more real commission before his hands go.
- **Fear:** the mine closing and his forge going cold.
- **Secret:** his father cast the replacement clapper for the Vesper Bell eighty years ago; Oswin still has
  the mould. He can recast a tongue — imperfectly — if the original is lost or destroyed.
- **Voice:** "What? No. WHAT? — Oh, you want it *sharper*. Everyone wants it sharper."
- **Class reactions:** Knight — adores you, repairs armour free once. Archer — arrowheads. Sorcerer —
  fascinated by fire magic, asks you to heat his forge (Ember) for a discount. Thief — sells lockpicks
  "for miners," deadpan.

### 5.8 Brother Horn — the minotaur, Warden of the Knot
Nine feet, grey-muzzled, horns chipped and bound in bronze wire; carries a stone-headed axe carved with
his true name. Speaks slowly, in short plain sentences, with long pauses, and has not spoken to a human
in sixty-one years except the sleepers, whom he talks to anyway.
- **Want:** the Nightjar asleep; the sleepers home; to rest.
- **Fear:** failing the oath, as his whole people eventually did. Falling asleep.
- **Secret:** he is dying — slowly, of age. He was going to ask the goblins to take over. He does not
  think they would do it well. He is probably right.
- **Voice:** "The monks called me Brother Horn. It was a kindness. I have kept it." / "They sleep. They are
  fed. Do not wake them. Waking is the dangerous part."
- **Class reactions:** see 4.3.

### 5.9 Clatter (Brother Anselm Hobb) — the skeleton who remembers
A Vesperine lay brother, gardener, the abbot's childhood friend. Now a skeleton in a rotted habit who
still tends a patch of pale mushrooms like a garden. Named "Clatter" by the goblins.
- **Want:** to remember his name. (He doesn't know that's what he wants.)
- **Fear:** "the humming." When the song swells, he loses what he has recovered.
- **Secret:** he knows the abbot's weakness: Corvin was always afraid of silence, which is why he fell in
  love with a song.
- **Voice:** "I had a sister. She laughed like a gate that wanted oiling. I… liked that gate." / "Sorry —
  sorry — I don't *want* to hit you, it's the bones, they have opinions."
- **Class reactions:** mostly the same; the sorcerer can attempt to "read" his memories (risky), the thief
  can return things he doesn't know he lost, the knight can give him the Vesperine burial rites if he
  asks for rest.

### 5.10 Mother Kettleback — goblin matriarch
Head of the Rootcellar clan. Enormous for a goblin (child-sized), wears a copper kettle as armour and
another as a hat. Pragmatic, sarcastic, fond of anyone who can be useful.
- **Want:** safe tunnels for her clan and a better class of junk.
- **Fear:** humans with torches coming down "to sort it out."
- **Secret:** she has an arrangement with Horn: salvage rights in exchange for feeding the sleepers. She
  also captured Vane's foreman, Duggan Marl, planting goblin trinkets, and is keeping him in a crate.
- **Voice:** "Goblins don't dream, sweetling. Nothing up here to sing to." / "Everyone wants to kill the
  goblins till they need something found."
- **Class reactions:** Thief — kin. Knight — "Big shiny one. Stand over there, you're making the young ones
  nervous." Archer — respects anyone who can hit a rat at forty paces. Sorcerer — "Don't do magic in my
  kitchen."

### 5.11 Snig — goblin scout
Young, quick, sticky-fingered, talks too much, desperately wants to learn to read, which no goblin has ever
done. Has been breaking into the Lamplit Stacks at night to look at pictures.
- **Want:** to read one book, start to finish.
- **Fear:** Mortimer.
- **Secret:** he has a stolen primer hidden in his hammock and has taught himself four letters, all wrong.
- **Voice:** "What's this one? Is it a snake? It looks like a snake. Is the whole book about snakes?"
- **Class reactions:** follows the thief everywhere; is scared of the knight's armour until it's taken off;
  asks the sorcerer to "do the reading trick" constantly; challenges the archer to a throwing contest.

### 5.12 The Sleepless Abbot (Corvin Ashgrove) — the wraith
A monk made of lantern-lit dream-fog, gentle-voiced, courteous, never raises his voice. Appears first
as the "friend below" (notes, chalk arrows), only speaking aloud in Act III.
- **Want:** to hear the whole song, and then to *write* in it — to edit dreams, beginning with the town's.
- **Fear:** silence. Being forgotten. Being wrong.
- **Secret:** he no longer remembers the pear tree, or Anselm, or why he started. Only the song.
- **Voice:** "Such a patient thing, a labyrinth. I have had sixty-one years to admire it." / "You needn't
  hate him. Just move him. He is old, and in the way, and you are so very good at this."
- **Class reactions:** Sorcerer — tempts with Somnomancy. Knight — appeals to duty ("free these poor
  bones"). Archer — flatters the hunt. Thief — offers the Knot's treasure.

### 5.13 Harbour cast (Wendmouth and the river)

**Mags Oakum — bargewoman.** Skipper of the stone barge *Patient Ann*; fifties, pipe, forearms like hawsers,
has carried Deepworks stone for thirty years and knows every eddy of the Wend. The player's ferry and guide
to the river.
- **Want:** a full hold again; her son home from the Deepworks crew's layoff.
- **Fear:** the river going quiet for good — and the humming she's started hearing at the Weeping Adit.
- **Secret:** she's been carrying Vane's "special crates" downriver for two months, for triple pay, and
  has a fair idea they aren't stone. She kept one horn-coin that slipped through a split plank.
- **Voice:** "River doesn't care who you are, love. Sit in the middle and don't touch the ropes."
- **Class reactions:** Knight — puts you on the tow-rope ("Useful for once"). Archer — asks you to shoot the
  herons off her blocks. Sorcerer — wants a Gust for the sail, pays in passage. Thief — hides you under a
  tarpaulin for customs, for a fee.

**Nell Gannet — keeper of the Drowned Gull, queen of the Low Tide Company.** Sixty, tiny, gold-toothed,
a laugh like a gull landing badly. Runs the tavern, the smugglers and the Undertow black market, in
roughly that order of honesty.
- **Want:** Cray gone; the harbour hers.
- **Fear:** the Lantern Court sending someone competent.
- **Secret:** she's the go-between for Mr. S—'s agent (the thief's commission drop) and has been skimming
  a coin from every relic crate. She knows exactly what's in bay nine.
- **Voice:** "Everything in Wendmouth's for sale, darling. Some of it's even ours."
- **Class reactions:** Thief — kin, work, and Undertow access. Knight — "Break anything, you buy it, and
  then you own it, and then you'll have to sell it to me." Archer — sponsors you in the Gull Shoot for a
  cut. Sorcerer — sells you restricted books, then tells you how to get them past customs, for more.

**Inspector Prudence Cray — Lantern Court customs inspector.** Forties, starched, spectacles, incorruptible,
posted to Wendmouth as a punishment she has decided to treat as a crusade. The MVP's only Lantern Court
official on screen.
- **Want:** a clean harbour and a transfer to the capital.
- **Fear:** that she will die in Wendmouth.
- **Secret:** she reads everything she confiscates — especially the romances — and keeps them. She has
  also noticed that bay nine's customs seal was stamped by a clerk who has been dead for a year.
- **Voice:** "Restricted school, unlicensed binding, no writ. It stays with me. You may visit it."
- **Class reactions:** Sorcerer — searches you on sight; offers a writ-by-post "in six to eight months."
  Knight — treats you as a respectable witness. Archer — asks you to count ships for her ledger. Thief —
  doesn't catch you, and can tell she didn't, which bothers her enormously.
- **Hook:** give her evidence about bay nine and she becomes a legal route to seizing Vane's crate.

**Tereza Maelo — import merchant, retired duellist.** From the Saltmarch Isles over the sea; runs the arms
stall at the Tidemarket. Forties, elegant, scarred hands, sells the best steel in the region and pretends
not to miss using it.
- **Want:** to go home rich enough never to fight again.
- **Fear:** that she enjoyed it too much.
- **Secret:** the Tern's captain owes her a debt of honour; she can get anyone aboard.
- **Voice:** "This blade was made for someone braver than you. Let us see if it can make you braver."
- **Class reactions:** Knight — challenges you to a first-blood duel; win and she sells you what she keeps
  under the counter. Archer — sells exotic arrows and asks to see your draw. Sorcerer — has one foreign
  spellbook she won in a duel and will trade it for a story. Thief — "Put it back. No — the other one too."

**Jasper Quell — shipping agent, Vane Deepworks.** Thirties, ink-stained cuffs, nervous smile; keeps the
manifests for bay nine and the correspondence with Mr. S—'s agent. The harbour end of Vane's scheme.
- **Want:** to get out from between Vane and the factors alive.
- **Fear:** the factors; Cray; being the one who hangs.
- **Secret:** he ordered the brass "goblin trinkets" from a Wendmouth foundry on Vane's instruction (the
  foundry invoice is in his desk — see *Framed in Brass*). He keeps a second, honest manifest as insurance.
- **Voice:** "Stone. It's stone. It's all stone. Heavy stone. Stone with — look, is there a problem?"
- **Class reactions:** Knight — folds instantly under a stern look. Archer — tries to hire you as a crate
  guard. Sorcerer — asks nervously whether you can "tell if something's cursed." Thief — you'll meet his desk
  long before you meet him.

### 5.14 Minor named characters
**Duggan Marl** (Vane's foreman, guilty conscience, in a goblin crate); **Tansy Pell**; the missing:
**Moss Greaves, Ettie Lark, Rowan Tate, Harlan Burr, Mina Coles, Fitch**; **Mortimer** (tame book
mimic); historical: **Sergeant Aldric Mooring**, **Ysolde Thorne**. Harbour and river: **Big Oona**
(dockhand, arm-wrestling champion of the Drowned Gull); **Old Reed** (Kestrel Lock keeper, charges tolls in
gossip); **Captain Hesketh** of the *Gilded Tern*; **"Mr. S—'s agent"** (a veiled passenger who never
leaves the Tern's locked berth in the MVP).

### 5.15 Ottilie Marsh — shopkeeper (merchant)
**Name and entry owner-confirmed, 2026-10-04.** Middle-aged, stout, capable and unhurried, with
rosy cheeks, greying auburn hair under a linen cap and spectacles pushed up on her forehead. Keeps Marsh's
General Store (§3.5), the first shop past the bridge, and lives in the rooms above it. Friendly and shrewd;
her brass scales are known to be honest. No voice acting in the MVP (text only).
- **Want:** a shop that stays open and a town that keeps coming in to it.
- **Hooks (no plot-changing canon):** she hears everything that crosses the bridge, so she can be a source
  for a rumour (§6.2) or a pointer to who has come and gone lately. She is a general merchant for basics.
- **Art:** `char-ottilie-marsh-base-01`, `portrait-npc-ottilie-marsh-01`, `prop-marsh-store-set-01`.

### 5.16 The Bridgeward College instructors (placeholder decisions, mw-ju8.13)
**Owner-reviewable greybox decisions** ("make good decisions", 2026-10-24); names, looks and prices may change.
- **Sergeant Maud Garrick — fighting instructor.** Fifties, stout and broad, close-cropped grey hair, a scarred
  stern-but-fair face; a retired garrison drill sergeant of the old bridge garrison, in a brick-red tabard
  over a quilted gambeson and mail sleeves. Gruff ("Make it quick."), a stickler for order: nobody learns the
  second step before the first. Teaches the knight's techniques for crowns: Shoulder Barge (100), Riposte (175),
  Shield Charge (250) and Disarm (400, needs Riposte). She was Captain Hale's sergeant; she calls him "the Captain" and thinks he sleeps too little.
- **Master Ewan Rooke — archery instructor.** Sixties, tall and lean, long grey hair tied back, trimmed beard,
  keen squinting eyes; a moss-green hooded jerkin and a long dun coat, a leather bracer and shooting glove.
  Dry and shrewd, keeps the college's butts (the straw targets). Teaches trick shots: Pinning Shot (150), Ricochet
  Shot (275), Severing Shot (400), each needing the one before.
- **No sorcery.** Neither will discuss it (the old soldiers' view of casters, §3.5); the robed figure under the bridge is the only teacher.
- **No XP.** Lessons are bought one technique at a time, for a fixed price, and last for good (ADR-0004).
- **Art:** `char-maud-garrick-base-01`, `char-ewan-rooke-base-01` (placeholder, awaiting approval); models `model-npc-garrick-01`, `model-npc-rooke-01`.

---

## 6. Side quests and rumours

### 6.1 Side quests

**1. The Bookshop Burglar** (town; any class). Books are going missing from the Lamplit Stacks at night;
Mortimer has bitten something small and green. Stake out the shop, follow the ink-smudged footprints to
the Glen Well and the goblin tunnels, and find Snig.
- *Solutions:* turn Snig in to Hale (goblins turn cold; Snig jailed; thief can bust him out later); broker
  a deal (Snig returns the books; Mirela offers reading lessons for goblin salvage — Snig becomes a
  recurring comic ally and later vouches for you with Horn); sell Snig the book yourself (thief); cast
  a light at the right moment so Mortimer and Snig meet face to face (sorcerer; hilarious; Snig will not
  come back, but tells the goblins you're "the scary reading one").
- *Reward:* goblin goodwill, a rare Mirela book, or bounty coin.

**2. The Captain's Boots** (town; any). Hale's boots are dusty every morning. Follow him at night (he
sleepwalks toward the mine, then turns back at the Bell Line stones, confused).
- *Solutions:* give him Juniper's *wakeful* tea (not the sleep draught — pick the wrong one and he walks
  all the way in); tie him to his bed with his consent; set a bell on his door; or follow him and learn the
  sleepwalkers' route, which reveals the Briarwood shortcut to the priory.
- *Choice:* tell the town (Hale loses authority; Vane gains it) or keep his secret (Hale becomes a loyal
  ally in Act III and backs your testimony about Horn).

**3. The Watch Still Stands** (Mooring's Watch; class-flavoured). The Hollow Sentinels still hold the tower
on a forty-year-old order and attack anyone without the watchword.
- *Solutions:* find the watchword in the keeper's log (any); formally relieve them (knight); shoot the
  tower bell cord to sound the "watch ended" signal (archer); dispel or overload their binding (sorcerer);
  never be seen and take what you want (thief); or smash them (anyone, slow).
- *Reward:* the tower as a safe base and fast route to the mine; the signal mirror (priory light puzzle);
  Sergeant Mooring's watch-key and a closing line in the log.

**4. Framed in Brass** (Deepworks; any). Goblin trinkets keep turning up at vanish sites, stamped on the back
with the Vane Deepworks mark. Mother Kettleback has Duggan Marl in a crate.
- *Solutions:* free Duggan by force (goblins hostile); trade for him (the clan wants a specific kettle from
  Dot's cellar); talk Kettleback into releasing him to testify; or leave him and take his planting kit as
  proof. Combine with Vane's ledger to expose Vane to Hale and the town. *Harbour evidence (optional):*
  Jasper Quell's foundry invoice for "40 brass trinkets, goblin style, stamp as sample" makes the case
  undeniable; the honest manifest from bay nine links the trinkets to the relic shipments.
- *Consequences:* Vane's fate (exposed / confesses / bribes you / flees on the mountain road).

**5. The Name on the Bones** (town + Knot; any; the emotional side quest). Help Clatter remember.
- *Pieces:* his psalter (Ossuary, among the Forgotten); the pear tree (a dead tree in the priory garden — a
  Nature spell or Juniper's graft can make it bloom once); his sister's letter (the Pell family Bible —
  ask Hollis, or steal it).
- *Solutions:* bring the pieces (any order); a sorcerer can attempt a memory-reading shortcut (success
  skips a piece; failure costs Clatter one memory, permanently).
- *Outcome:* Clatter remembers his name, the abbot's fear of silence, and that Tansy is family. He can join
  you at the Cradle (enables the abbot's Persuade resolution) or ask for rest (knight rites, or any class
  laying his psalter on the priory altar). Either choice is right.

**6. The Crate for Mr. S—** (Wendmouth; any class, **the stealth heist**). Vane's next relic crate sits in bay
nine of the bonded warehouse, waiting to be hoisted aboard the Gilded Tern. Inside: horn-coins, carvings,
and a Hornfolk **name-stone** carved with Horn's mother's name.
- *Solutions:*
  - **Heist (thief-favoured, any class can try):** case the warehouse; roof and skylight entry, or a
    dockhand disguise from the Undertow; dodge the night watchman; open bay nine, swap the crate's
    contents for ballast, and re-seal it with the Undertow's customs-seal stamp. Perfect execution: no one
    ever knows, the Tern sails with rocks from a town made of them, and Vane gets paid in angry letters.
  - **Paper (any):** forge or swap the manifest so Cray inspects bay nine legally and seizes the crate
    (needs Quell's honest manifest or the dead clerk's seal as evidence).
  - **Net (archer):** cut the cargo net mid-hoist; the crate drops into the harbour; fish it out at low
    tide before the Low Tide Company does.
  - **Force (knight):** walk into the warehouse and tell the watchman to stand aside; it becomes a
    dockside brawl with Nell's crew and the harbour watch (winnable, noisy, and Cray arrives at the end).
  - **Ice (sorcerer):** freeze the pool around the Tern at night, walk out, and take the crate from the
    hold; or Gust the hoist so the crate lands on the wharf, not the deck.
  - **Leverage (any):** confront Quell with the foundry invoice; he hands over the crate and his honest
    manifest in exchange for a head start on the mountain road.
- *Outcomes:* name-stone (befriend-Horn trigger), manifest (Vane evidence), Mr. S—'s sealed letter (hook,
  unreadable in the MVP beyond one line). If the Tern sails first, the crate is gone (epilogue hook); the
  customs copy of the manifest remains.

**7. The Tidefair** (Wendmouth; shared hijinks with class flavours). Every market day the Stone Wharf holds
contests for coin, prizes and bragging rights. Any class can enter any event; each class is best at one.
- *Events:* **Arm-wrestling and the Gull brawl** (knight flavour; beat Big Oona, or survive the free-for-all
  that follows when someone loses badly — often you); **the Gull Shoot** (archer flavour; hit wooden gulls
  on a swinging boom, then a live one that stole the prize ribbon); **the Regatta** (sorcerer flavour; a
  rowing-boat race where "no magic" is a rule nobody enforces until Cray walks by — Gust your sail, freeze a
  rival's oars); **the Pocket Race** (thief flavour; lift a ribbon from each of five marked contestants
  without being caught — one of them is Cray).
- *Solutions/branches:* win honestly, cheat (sabotage is possible in every event and has its own
  consequence), throw a match for Nell's betting book, or lose gracefully (Oona buys you a drink, and the
  Drowned Gull warms to you anyway).
- *Rewards:* Tereza's under-the-counter stock, discounts, a foreign spellbook, reputation in Wendmouth.

**8. Contraband Pages** (Wendmouth; sorcerer-flavoured, any class). Cray has impounded a crate of books
including Mirela's order from over the sea (a rare Illusion text) and — if you were careless — your own
restricted spellbooks.
- *Solutions:* bribe her (it fails, magnificently; she writes it down); trade her a romance novel from
  Mirela's stock (her secret weakness); obtain a writ (Vane can sign one as council chair — at a price —
  or Mirela can forge a Lantern seal); steal it back from the customs strongroom (thief route through the
  roof); impersonate an inspector with Mirror Self or a borrowed coat (risky: she knows every inspector by
  name); or give her the bay nine evidence and let her release the books "in gratitude, off the record."
- *Outcomes:* Mirela's book delivered (a rare spell for the Lamplit Stacks' stock) or kept for yourself
  (Mirela knows); Cray's disposition, which decides whether she helps with *The Crate for Mr. S—*.

### 6.2 Rumours (Dot, townsfolk, goblins, notes)

Each rumour is true, half-true or false, and points at a place or secret.

1. "Wolves let the sleepwalkers walk right through the pack. Didn't even look up." → the song affects
   animals; wolf den; Juniper. *(True.)*
2. "Old Mooring never left his tower. Some say he's still up there, keeping watch." → Hollow Sentinels.
   *(Half-true: his armour is.)*
3. "The goblins took them. They left their little brass trinkets at every door." → *Framed in Brass.*
   *(False — planted.)*
4. "The Glen Well echoes wrong. Drop a stone and you hear it land twice." → cistern route to the priory.
   *(True.)*
5. "There's a bell up at the priory, cracked clean through. Used to ring every sunset. My gran said the
   night it didn't ring, the monks all went for a walk." → the Vesper Bell. *(True.)*
6. "Vane's been buying drinks for the whole mine crew and nobody's dug a thing in months. Where's the
   money from?" → Vane's ledger, the horn-coins. *(True.)*
7. "Mirela's got a shelf you can only see if she likes you." → restricted shelf; *Nine Sleeps*.
   *(True.)*
8. "The captain looks like he's been sleeping in his boots." → *The Captain's Boots.* *(True.)*
9. "Something at the millpond sings on still nights. Not a bird." → a sleepwalker's lost lantern and a
   Hushling in the drowned lane. *(True, and dangerous.)*
10. (Goblin) "Big One doesn't eat people. Big One puts them in the soft room and gives us bread for them." →
    the Fold. *(True — the town won't believe it.)*
11. (Goblin) "The talking bones in the flower room says sorry a lot." → Clatter. *(True.)*
12. "They say the stone horn in the woods covers its ears so it won't hear the maze calling." → the
    Standing Horn; Hornfolk statue language. *(True.)*

Harbour and river rumours (Mags, Nell, Old Reed, Tidemarket gossip):

13. "Vane crates go into bay nine and customs never cracks a seal. Funny, that." → bonded warehouse;
    *The Crate for Mr. S—*. *(True.)*
14. "The Inspector reads every book she confiscates. Every one. Even the ones with kissing." → Cray's
    secret; *Contraband Pages*. *(True.)*
15. "Nell's cellar goes further than her cellar." → the Undertow. *(True.)*
16. "River's been humming up by the Weeping Adit. Fish won't bite there." → the river route into the lower
    Deepworks; the song reaching the water. *(True.)*
17. "The Gilded Tern pays double for crew who don't ask what's in the hold." → the Tern; shanghai route.
    *(True.)*
18. "There's a sea serpent under the breakwater. Big as a barge. Eyes like lanterns." → the sunken
    figurehead and the smugglers' sea-door. *(False — debunked by diving, or by Mags laughing at you.)*

---

## 7. Environmental storytelling & lore delivery

### 7.1 Principles
- **Three sources that disagree.** Any big fact (the Long Vespers, the minotaur) appears in at least three
  voices: a book, an object, a person. They don't fully agree.
- **Every bookshelf has a book.** Most are short (100–300 words) and readable in under a minute.
- **Item text is lore.** 1–3 sentences, concrete, often with a turn of feeling at the end.
- **Statues speak through posture.** Hornfolk statues cover their ears. Vesperine statues sing, mouths
  open. Near the Cradle, every carved face in the Knot is turned toward the centre.

### 7.2 In-world books (MVP set, excerpts)

**The Vesperine Hours** (hymnal; key item). Contains the Vesper hymn. *"Sleep, you who were not born. Sleep,
you who fell. The day is rung. The door is kept."* Margin note in a child's hand: *"Brother A. sings
this flat."*

**A Traveller's Account of the Glen** (common). *"The inhabitants are uncommonly literate for stone-cutters and
uncommonly nervous about sunset. Asked why the priory bell rings so loud, the innkeeper told me, 'So
nobody has to hear anything else.'"*

**On the Silence of Goblins** (Mirela's stock). *"The goblin does not dream. Deprived of sleep's theatre,
it compensates by stealing props."*

**The Ox Beneath the Hill** (children's book, Tansy's copy). *"The ox beneath the hill has a very big
door and a very small light, and he stays awake so we can sleep."* The last page is torn out.

**Keeper's Log, Mooring's Watch** (watchtower). Final entries: *"Day 40 alone. Wrote the men's names on
their armour stands so I'd remember. Gave the stands the order. Foolish. They seemed to listen."*

**Letters of Abbot Corvin Ashgrove** (priory scriptorium, fragments). *"Anselm thinks it is a threat. It is
a sentence, and we have spent three hundred years shouting over it. What if it is trying to tell us
something?"* / later: *"I will take out the tongue for one night only. One night, to listen."*

**Nine Sleeps** (forbidden; Mirela's back room; never sold). The abbot's treatise on Somnomancy. Readable
for lore; its first chapter teaches *Lull* to a sorcerer who reads it — Mirela will throw you out if she
catches you.

**Deepworks Ledger** (Vane's gallery). *"Horn-coin, 12 pcs, to Mr. S— of the city. No questions. Below
the Line, gallery 9: carvings. Men uneasy. Double wages."*

**Rules of the Mine** (carved over the gate). *"No shaft below the Bell Line. The hill is kept."*

**Cargo Manifest — Gilded Tern, Bay Nine** (Wendmouth customs house copy / Quell's desk). *"Consignor: Vane
Deepworks. Contents: GLENSTONE SAMPLES, dressed, 1 crate (heavy). Customs seal: No. 114, clerk E. Ardley. Consignee: to be
collected at destination by bearer of the S— token."* Quell's honest copy, hidden in his desk, lists instead:
*"Horn-coin, 40 pcs. Carved stone (ox-headed), 3. Name-stone, 1 — do NOT let the men see this one."*

**Notice of the Lantern Court — Port of Wendmouth** (posted at the Stone Wharf and the customs house).
*"All books of the Restricted Schools (Illusion, Conjuration, Gravity, Shadow) entering this port without
writ shall be held. Books of the Forbidden Schools shall be burned. Enquiries to the Inspector, who is not
to be approached before ten, or after four, or at lunch. — By order, P. Cray."*

**Kestrel Lock Toll Board** (painted, flaking). *"Stone barge, laden: 2 pennies. Stone barge, empty: 1 penny.
Silver barge: by imperial warrant. Pleasure craft: 5 pennies. Gossip accepted in lieu at keeper's
discretion."*

**Foundry invoice** (Quell's desk). *"40 brass trinkets, goblin style, stamp as sample. Rush. Do not ask."*

### 7.3 Spellbook flavour (house style)
Each spellbook: a title with an author, a one-paragraph practical voice, and one human detail.
- **Ember, Kindled: A Primer** — *"Begin with a candle. Do not begin with a curtain. (The author began with a
  curtain.)"*
- **Frostglass for the Careful** — *"Ice is water that has decided to stay. Persuade it gently."*
- **Gust, and Other Impolite Winds** — *"The spell will clear smoke, scatter paper and remove hats. Choose
  your target with the hat in mind."*
- **The Absent Hand** (Mage Hand) — *"Imagine your hand longer. Then imagine it braver."*
- **Mirror Self: A Short Treatise on Being Two Places** (restricted) — *"Your double is you with fewer
  opinions. Enemies prefer it."*
- **Grasping Vines** (Nature) — *"The roots are always listening. Ask."*
- **Thunderclap** (Storm) — *"Keep your mouth open when casting, or your ears will do it for you."*
- **Nine Sleeps, ch. 1: Lull** (forbidden) — *"Everything wants to sleep. We only remind it."*

### 7.4 Item description voice (examples)
- *Rusted watch-key.* "The sergeant wore it on a cord. The cord outlived him by forty years; the key will
  outlive us all."
- *Horn-coin.* "Hornfolk money, heavier than it looks. Every coin has a tiny ox asleep on the back."
- *Tansy's hair ribbon.* "Blue once. Found on a mine rail, neatly tied in a bow, as if she meant to come
  back for it."
- *Vesper Bell's tongue.* "Bronze, green with age, and warm. Things that were made to sing hate being
  quiet."
- *Mortimer's tooth.* "You shouldn't have it. Mortimer knows you have it."
- *Goblin kettle-helm.* "Protects the head, boils water, and signals rank. Goblin engineering at its best."
- *Hornfolk name-stone.* "A river-smooth stone carved with one long, low word. Held to the ear, it is
  silent. Held near the minotaur, it is not."
- *Saltmarch sabre.* "Curved like a gull's wing and just as rude. Balanced for a duellist who expected to
  live."
- *Crown.* "Imperial silver, struck in the city from silver cut out of the hill behind the Sleeping Ox. Most of
  Briar Glen has never held one this new."
- *Customs-seal stamp.* "Official. Stolen. Official again, as long as nobody looks closely."

### 7.5 Notes and marks
"A friend below" notes (6–8, genuinely helpful until the reveal, then re-readable as sinister); Hale's
missing-persons list; Duggan's planting instructions; a sleepwalker's scrawl on the mine wall
("*it's so pretty down here*"); chalk tallies in the Fold (Horn counting the sleepers, and, later, the
player's rescues).

---

## 8. Creature lore (MVP roster — 10 types)

| Creature | Lore | Social / avoidable? |
|---|---|---|
| **The Forgotten** (skeletons) | Monks and miners who walked into the song and forgot themselves. They repeat old habits: sweeping, praying, hauling. Monk-Forgotten fight with staves and censers; miner-Forgotten with picks. Crumble and reassemble unless their bones are scattered or burned. | Avoidable; ignore quiet players; humming the Vesper hymn calms them. Clatter is social. |
| **Rootcellar Goblins** | Small, clever scavengers immune to the song (they don't dream). Kettle helmets, slings, nets, and very loud alarms. Flee when outnumbered. | Fully social: talk, trade, bribe, hire, anger. |
| **Brother Horn** (minotaur, unique) | Last Hornfolk warden. Charges, grabs, and throws — to stop, not kill. | The central social encounter (4.2). |
| **Loom Spiders** (giant spiders) | Pale, dog-sized, living in the Outer Ring. They weave webs along the Hornfolk runes, copying the carvings in silk — their webs can be *read*. Webs are flammable; spiders fear bright light. | Avoidable; drive off with light or fire; a webbed rune can be a puzzle clue. |
| **Briar Wolves** | Lean grey wolves of the Briarwood. Since the breach, they've gone silent and uneasy; the song stills animals. They avoid the mine. | Scare with fire; feed to pass; Juniper's quest-line flavour; a pack that isn't fought remembers. |
| **Hushlings** (original; dream creatures) | Child-sized figures of grey fog shed by the Nightjar's dream. Blind; hunt by sound. They mimic the voices of the missing ("Da? I'm cold"). Loud sounds (bells, Thunderclap, shattered glass) tear them apart. | Avoidable by silence; the thief's natural nightmare and playground; knights clank. |
| **Tallow Ooze** (slime) | The priory's candle-wax, animated by stray dream-magic. Slow, sticky; fire melts it into spreading flammable puddles; frost makes it brittle. | Mindless but avoidable; systemic toy. |
| **Mimics** | Book-mimics in the scriptorium, lectern- and chest-mimics in the Knot. Once Vesperine guardians of the library. Mortimer is tame. | Can be fed (they like paper), avoided, or woken on purpose. |
| **Hollow Sentinels** (animated armour) | Mooring's garrison armour stands, animated by his last order: *hold the tower.* Honour-bound, slow, relentless inside the tower, never leave it. | Relieved by watchword or knight's formal words; sneaked past; smashed. |
| **The Sleepless Abbot** (wraith, unique) | A dream-body kept "awake" by the song. Solid only while singing. Commands Hushlings. | Fight / trick / persuade / join (4.1, beat 12). |

**Wendmouth adds no new creature types** (the MVP count stays at 10). Its opposition is human: the **Low Tide
Company** smugglers (clubs, knives, nets, whistles), the **harbour watch** (non-lethal by default — they
arrest, or throw you off the pier), and the **Gilded Tern's crew**. All are social: bribe, trick, drink with,
out-brawl. Ambient life with systemic hooks (not counted as creature types): **harbour gulls** snatch shiny
unattended items and can be followed to their rooftop hoards; **wharf rats** scatter from light and give away
a sneaking player if startled.

---

## 9. Failure creates stories (summary)

See 4.5 for main-quest specifics. General rules for all narrative content:
- **Every "fail" state lands somewhere new**, recorded as a world-state fact: jail → cistern route; goblin
  capture → negotiation; death in the Knot → the Fold (and Horn counts); lost sleepwalker → Act III
  stakes; sour bell → new encounter and a chance to meet Horn; caught in Wendmouth → thrown off the pier
  → the smugglers' sea-door; lost drinking contest → aboard the Tern; confiscated books → the customs
  strongroom.
- **NPCs remember embarrassment.** Dot mentions the time you fell in the well. Mirela bans you for a day
  if Mortimer catches you (then lets you back if you bring biscuits).
- **Botched spells** from damaged pages misfire into story (a mis-cast Lull puts *you* to sleep: a
  short dream sequence in which the song shows you a door you haven't found yet).
- **No choice is a dead end.** Killing Horn, siding with Vane or even joining the abbot all lead to an
  ending with a lamp still lit and a reason to return.

---

## 10. Post-MVP hooks

- **The buyer in the city** ("Mr. S—"), who bought Vane's horn-coins and hired the thief: a collector of
  Hornfolk relics who knows there are other Knots. His veiled agent aboard the Gilded Tern is the thread;
  the Tern's next voyage is the natural next adventure.
- **Over the sea.** The Saltmarch Isles (Tereza's home), paying their dues in imperial silver, and the foreign
  book trade that supplies the Tidemarket.
- **Other Sleepers.** The Hornfolk built more than one prison. The Nightjar is one of several; carvings
  in the Cradle map others.
- **The Lantern Court arrives.** An inquisitor comes to investigate reports of Somnomancy, Mirela's shelf,
  and the sorcerer — possibly summoned by Inspector Cray's report on bay nine.
- **The Warden's succession.** Who keeps the Knot when Horn is gone — goblins, Clatter, the player, Tansy?
- **Snig learns to read.** A long-running comic thread; the first goblin author.
- **Ysolde's journey.** Mirela's grandmother left the valley with one book the Court never found.
- **The empire's appetite.** Imperial assayers come upriver to learn why the Measure is short, and find what
  lies below the Bell Line.
- **The stone abroad.** Glenstone stands in harbours and temples across the sea; somewhere, a Hornfolk
  carving went out with it.

---

## 11. Naming conventions & glossary

### 11.1 Naming conventions
- **Townsfolk:** rustic English/Celtic, plain surnames from trades and landscape (Pell, Hale, Fenn,
  Brand, Farrow, Lark, Tate). Nicknames welcome (Dot, Fitch).
- **Vesperine (monastic):** Latinate or old-church first names (Corvin, Anselm, Ysolde); place names with
  bell/vesper/hollow (Bellwater).
- **Hornfolk:** things are named by function in translation (the Knot, the Cradle, the Fold, the
  Standing Horn). Untranslated Hornfolk words are low and doubled ("thruum," "oorr"); use sparingly.
- **Goblins:** short, kitchen- and garden-noun names (Kettleback, Snig, Nib, Mudge, Grubble).
- **River and harbour folk:** salty English trade and sea-bird surnames (Oakum, Gannet, Reed, Hesketh);
  places named for water features (Wendmouth, Kestrel Lock, the Millweir, the Weeping Adit). Ships get
  virtue or bird names (*Patient Ann*, *Gilded Tern*).
- **Lantern Court officials:** stiff, plain virtue-or-clerk names (Prudence Cray, E. Ardley).
- **Over-the-sea (Saltmarch Isles):** vowel-rich, Mediterranean-leaning (Tereza Maelo); use sparingly.
- **Reserved initial:** no human MVP character's surname may begin with **S**, so nobody reads as
  "Mr. S—" (keep the buyer's identity open).
- **Spells:** plain evocative words, never Roman numerals (Ember, Frostglass, Lull).
- **Content IDs:** `npc-<firstname>` (e.g. `npc-mirela`, `npc-horn`), `quest-<slug>`, `book-<slug>`,
  `rumor-<nn>-<slug>`; asset IDs follow the backlog contract (e.g. `portrait-npc-mirela-bookseller`).
- Spelling: British-leaning ("armour", "rumour") in in-game text; code identifiers use US spelling
  (`rumor`).

### 11.2 Glossary
- **Bell Line** — the depth below which the Vesperine rule forbade mining.
- **Bellwater Priory** — ruined Vesperine monastery over the Cradle.
- **Brother Horn** — the minotaur; last Hornfolk warden.
- **Clatter** — goblin name for the skeleton Brother Anselm Hobb.
- **The Cradle** — heart of the Knot where the Nightjar sleeps.
- **Crowns** — the empire's silver coin, struck from Glen silver.
- **The Deepworks** — the Vane family's glenstone mine, where silver was struck 35 years ago.
- **The empire** — the realm Briar Glen belongs to; unnamed in the MVP; its capital is "the city".
- **The Drowned Gull** — Nell Gannet's tavern in Wendmouth; trapdoor to the Undertow.
- **Glenstone** — the valley's pale, honey-grey freestone; its export built the region and Wendmouth.
- **The Fold** — sealed Hornfolk vault where Horn keeps the sleepers safe.
- **The Forgotten** — skeletons of those who walked into the song.
- **A friend below** — the signature on the abbot's notes.
- **The Gilded Tern** — merchantman in Wendmouth harbour carrying Vane's relics to Mr. S—.
- **Hornfolk** — the ancient bull-headed people who wrote the Knot.
- **Hushlings** — blind fog-children shed by the Nightjar's dream.
- **Kestrel Lock** — the barony lock halfway down the Wend; keeper Old Reed.
- **The Measure** — the yearly quota of silver the Vanes owe the imperial mint under their warrant.
- **The Knot** — the labyrinth; a prison-spell carved as corridors.
- **The Lamplit Stacks** — Mirela's bookshop.
- **The Lantern Court** — the authority that licenses and forbids magic.
- **The Long Vespers** — the night, 61 years ago, the bell was silenced and the priory walked into the maze.
- **The Low Tide Company** — Wendmouth's smugglers, run by Nell Gannet.
- **The Millweir** — Vesperine-built weir and sluice walk below Briar Glen.
- **Mooring's Watch** — the abandoned watchtower.
- **Mr. S—** — the unnamed buyer "of the city" of Vane's relics; the thief's anonymous client.
- **The Nightjar** — the dreaming thing in the Cradle; its song draws sleepers and unwrites names.
- **The Stone Stair** — stepped slipway from the Deepworks' cutting hall down to Briar Glen Quay.
- **The Stone Wharf** — Wendmouth's great stepped quay where the stone barges unload.
- **The River Wend** — the river from the Deepworks hills through Briar Glen to the sea at Wendmouth.
- **Rootcellar clan** — the goblins in the Deepworks.
- **The Sleeping Ox** — Briar Glen's inn.
- **Saltmarch Isles** — lands over the sea; source of Tidemarket imports.
- **Somnomancy** — forbidden dream magic.
- **The Sounding Shaft** — vertical shaft from the priory belfry to the Cradle.
- **The Vesper Bell** — the priory bell whose evening note keeps the Nightjar asleep; its bronze tongue
  was removed by the abbot.
- **Vesperines** — the monastic Order of the Vesper Bell.
- **The Tidefair** — Wendmouth's market-day contests on the Stone Wharf.
- **The Tidemarket** — Wendmouth's covered import market.
- **The Undertow** — black market in the smugglers' cellars under Wendmouth's fish market.
- **Bay nine** — Vane Deepworks' bay in the Wendmouth bonded warehouse.
- **The Weeping Adit** — the Deepworks drainage tunnel where the Wend springs; a water route into the mine.
- **Wendmouth** — the harbour town at the mouth of the Wend.

### 11.3 Canon facts to lint against (quick reference)
Long Vespers: **61 years ago**. Priory founded: **~300 years ago**. Breach: **3 months ago**.
Disappearances: **3 weeks**, **6 missing before the game, Tansy the 7th**. Bounty: **500 crowns, raised to
800**. Mooring's Watch abandoned **~40 years** ago (Mooring died at his post after the garrison left).
Tansy Pell is **12**. Horn is **the last** Hornfolk. Goblins **cannot read and do not dream**.
Priory built of the first glenstone cut **~300 years ago**. Stone mine, river trade, Kestrel Lock and the
Wendmouth charter: **~250 years ago** (the Millweir is older). The Vanes have run the Deepworks for **five
generations**. Silver struck **~35 years ago**, above the Bell Line, by Harrow Vane's **grandfather**. The empire
is **unnamed** in the MVP; its coin is the **crown**. Barge journey:
**1 day downriver, 2 days up** (towed). Relic shipments: began **~2 months ago** (after the breach);
the crate in bay nine is the **fourth**; the ledger's "12 pcs" was the first shipment; the bay-nine crate
holds **40 horn-coins, 3 carved stones, 1 name-stone**. Brass trinkets ordered: **40**. The Gilded Tern
sails **when Act III begins** (no real-time clock). Wendmouth is **optional**; the main quest is
completable without visiting it. Mags has carried stone for **30 years** and Vane's crates for **2 months**.
Bay nine's seal clerk **E. Ardley** has been **dead a year**. Wendmouth adds **no new creature types**
(roster stays at **10**). Rootcellar clan: **~20** goblins. Oswin's father cast the replacement clapper
**~80 years ago**.

**Ages and sizes.** Tansy **12**; Mirela **fifties**; Hale **sixty**; Vane **forty**; Juniper **thirties**;
Oswin **seventy**; Horn **nine feet** (≈ 2.75 m), old; Mags **fifties**; Nell **sixty**; Cray **forties**;
Tereza **forties**; Quell **thirties**.

**Counts (what downstream e39 items reference).**
- **12 principal characters** (§5.1–5.12): Mirela Thorne, Brannoc Hale, Harrow Vane, Dot Farrow, Hollis Pell
  (with Tansy), Juniper Fenn, Oswin Brand, Brother Horn, Clatter, Mother Kettleback, Snig, the Sleepless
  Abbot. Plus **5 harbour principals** (§5.13): Mags Oakum, Nell Gannet, Prudence Cray, Tereza Maelo,
  Jasper Quell.
- **10 creature types** (§8): the Forgotten, Rootcellar Goblins, Brother Horn, Loom Spiders, Briar Wolves,
  Hushlings, Tallow Ooze, Mimics, Hollow Sentinels, the Sleepless Abbot.
- **8 side quests** (§6.1): 5 in the valley (The Bookshop Burglar, The Captain's Boots, The Watch Still
  Stands, Framed in Brass, The Name on the Bones) and 3 in Wendmouth (The Crate for Mr. S—, The Tidefair,
  Contraband Pages).
- **4 headline endings** (§4.4): Vespers Rung, The Last Warden, The Hireling's Silence, The Long Vespers.
- **18 rumours** (§6.2): 12 in the valley, 6 on the river and harbour.

**Deliberately open (not placeholders).** The empire's name; the identity of Mr. S—; what the Nightjar
is beyond "a dream that hungers". All three are post-MVP hooks (§10).

---

## 12. Change log

| Version | Date | Change | Approved by |
|---|---|---|---|
| v0.1 | 2026-09-27 | First draft: premise, world, beat sheet, cast, quests, rumours, lore, creatures, glossary. | — |
| v0.2 | 2026-09-27 | Owner extension: the River Wend, Kestrel Lock and the optional harbour town of Wendmouth, with harbour cast, quests and rumours. | owner |
| v0.3 | 2026-09-27 | Retitled *The Vesper Bell* (ADR-0002). Stone-first economy: glenstone barged down the Wend for export built the valley and Wendmouth's monumental stone harbour; silver, struck ~35 years ago, is the empire's cash cow and drives Vane below the Bell Line (PR #13). | owner |
| **CANON v1** | 2026-09-27 | Owner sign-off. Canon counts, ages and deliberately open questions added to §11.3. | owner |
| v1.1 | 2026-10-04 | Added Marsh's General Store (§3.5) and Ottilie Marsh (§5.15) from owner-approved concept art (mw-ju8.8); names confirmed by the owner the same day. No plot-changing canon. | owner |
| v1.2 | 2026-10-04 | Owner canon: the Miners' Bridge (built ~200 years ago for miners; guarded day and night by the Bridge Watch), the Bridgeward College (fighting and archery) and the robed sorcery teacher under the bridge at night (§3.5). Supersedes the 'stone bridge' open question from v1.1. | owner |
| v1.3 | 2026-10-24 | Greybox decisions for the Bridgeward College (§3.5, §5.16, mw-ju8.13): instructors Sergeant Maud Garrick and Master Ewan Rooke, their lessons and fees. Owner-reviewable; no plot-changing canon. | Claude, owner-delegated |
