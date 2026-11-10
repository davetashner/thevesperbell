# The Vesper Bell — Visual Style Bible

> Status: **SIGNED OFF v1.0 — 2026-09-27** (owner; bead `mw-e37.1`). Changes from here on need a change-log
> entry (§18).
> Subordinate to `CONSTITUTION.md` and `docs/backlog-contract.md`. When this document and a prompt
> disagree, this document wins; when this document and the constitution disagree, the constitution wins.
> Story/lore names, locations, creatures and motifs are reconciled with `docs/narrative/story-bible.md`
> (**story canon**). If they disagree, the story bible wins: change it there first, then update this file.
> The game's title is **The Vesper Bell** (decided in `mw-e39.2`, see `docs/adr/0002-game-title.md`).
> "Merlin's Wrath" survives only as the original codename.

---

## 0. The look in one sentence

**"A hand-painted storybook world carved from chunky low-poly shapes — warm hearth-gold light pushing back
cool violet shadow, where old stone remembers something and every crack, rope and ledge is telling you what
you can do with it."**

### Reference descriptions (described, never pasted)

We do not paste or trace copyrighted images into prompts or the repo. We describe the *qualities* we want:

| Influence | What we take | What we leave |
|---|---|---|
| *Quest for Glory V* | Painterly, warm small-town fantasy; hand-crafted signage and props with personality; humour living alongside danger. | Late-90s pre-rendered murk and low contrast. |
| *Zelda* (toon/painterly era) | Bold readable silhouettes, big simple shapes, a world that visually teaches its mechanics (cracked walls, climbable vines, grab ledges). Saturated magic against calmer environments. | Overly cute proportions; pure cel-shaded outlines everywhere. |
| *Dark Souls / Elden Ring* | Weight: heavy stone, massive doors, ruins with implied history, vertical level reveals, fog thresholds, the "light in the distance" composition. Creatures with tragic dignity. | Grey-brown desaturation, relentless bleakness, grime on everything, realistic texture noise. |
| *Divinity: Original Sin 2* | Elemental surfaces that read at a glance (oil, water, ice, fire, poison, electrified), rich colour, iconic spell VFX per school. | Busy isometric clutter, heavy UI chrome. |
| *Morrowind / Oblivion / Skyrim* | Books as physical objects worth reading; distinct regional architecture; the sense that every ruin had a purpose; wayshrine-like landmarks. | Photogrammetry realism, bland mid-grey lighting, clutter without meaning. |
| CC0 low-poly kits (KayKit, Quaternius, Kenney) | Chunky bevelled geometry with gradient/atlas colouring — this is our **geometry baseline** because it is achievable solo and consistently licensable. | Toy-like plastic sheen; generic "asset store" look without our palette, lighting and painted surfaces. |

Imagine: a crooked timber-and-thatch town at golden hour; lanterns already lit; Mooring's Watch, overgrown, on
the eastern spur, the signal mirror on its roof catching the last of the sun. Everything is slightly too big and slightly too soft — doors are heavy,
chimneys lean, stones have rounded corners — and it looks like it was painted with a wide brush by someone who
loves the place.

---

## 1. Visual pillars

1. **Warm light, deep mystery.** Every scene has a warm source (hearth, torch, sun, spell) and a cool shadow
   region. Darkness is a *place to explore*, never a void. The warm/cool split is also the stealth language
   (light = seen, shadow = hidden).
2. **Readable before beautiful.** Silhouettes, affordances and element states read at 20 m on the Low preset
   before any detail pass. If a player can't tell a wall is breakable, the art has failed the design.
3. **Chunky, soft, heavy.** Low-poly forms with bevelled edges, exaggerated thickness and slightly squashed
   proportions. Things feel hand-made and weighty — doors thud, stones sag, beams are too thick.
4. **Magic owns saturation.** The world sits in a restrained earthy palette so that spells, fire, glyphs and
   points of interest can be the most saturated things on screen.
5. **Every ruin remembers.** Environments carry history: repaired walls, faded frescoes, carved warnings,
   thieves' chalk marks, offerings on shrines. Visual storytelling rewards curiosity (constitution: "The world
   rewards curiosity").
6. **Cheap to make, cheap to run.** Style choices must be achievable by one developer with Claude-generated
   GPT images, CC0 kits and API-driven image-to-3D — **zero manual 3D/DCC work by the owner** (§17) — and
   must hit the budgets in §13 on Iris Xe.

---

> **Key-art exception (owner, 2026-09-27):** marketing key art and the logo (`keyart-*`) may be richer and
> more painterly than the in-game look, as long as they keep this palette and the world's canon. They are not
> style anchors for in-game assets; `e37-asset-style-lock` uses in-game-style approvals only.

## 2. Palette

All values are sRGB hex. The palette is enforced by a **palette LUT/ramp texture** (`tex-palette-master-01`)
used by the shared stylized material and by kit recolouring (see §6). Pure black `#000000` and pure white
`#FFFFFF` never appear in albedo.

### 2.1 Global core palette

| Token | Hex | Use |
|---|---|---|
| `ink` | `#1E1B2E` | Deepest shadow, outlines on UI, darkest albedo allowed. Violet-ink, never black. |
| `dusk` | `#3B3A5A` | Shadow fill, far silhouettes, night ambient. |
| `moss` | `#2F4A3A` | Foliage base, damp stone tint. |
| `leaf` | `#6B8F4E` | Mid foliage, grass. |
| `bark` | `#5A3E2B` | Wood, leather, earth. |
| `timber` | `#8A6440` | Worked wood, planks, furniture. |
| `stone` | `#8C8A80` | Neutral stone. |
| `stone-warm` | `#A89A84` | Sunlit / sandstone-leaning stone. |
| `parchment` | `#EFE2C4` | Plaster, paper, cloth highlights, UI panels. |
| `cream` | `#FFF4DC` | Highest albedo allowed; specular glints. |
| `hearth` | `#E8A24A` | Key warm light, lanterns, torch tint, UI accent. |
| `ember` | `#C8553D` | Warm accent, banners, roofs, danger-warm. |
| `sky` | `#8FA8C8` | Daytime sky/ambient fill. |
| `fog` | `#A7B3B8` | Distance fog (day). |
| `wayfinder` | `#F2C94C` | Reserved: focus highlight on interactables, quest markers. |

**Ratio rule (60/30/10):** 60 % earthy neutrals (stone, bark, moss, parchment), 30 % location secondary colour,
10 % accent (hearth, ember, magic). Saturation above ~70 % HSV is reserved for magic, fire, UI accents and
gameplay-legibility cues.

### 2.2 Per-location palettes

| Location | Base | Secondary | Accent | Light / mood |
|---|---|---|---|---|
| **Briar Glen** (town) | thatch `#C9A66B`, plaster `#EADFC8`, timber `#4E3524` | roof slate `#4A5568`, garden `#6B8F4E` | briar rose `#B5485D`, painted doors `#3F7A8C` | Golden hour default; lantern `#FFB85C`. Cosy, lived-in, safe. Key interiors: **the Sleeping Ox** inn (sign: a peaceful ox asleep under a moon) and **the Lamplit Stacks** (crooked three-storey bookshop leaning on Brand's Forge; lamp-lit, book-warm). One warm room, one uneasy thing. |
| **The Briarwood** (wilderness) | canopy `#2E5E3E`, bark `#4A3528`, fern `#5E8C3A` | moss floor `#445F37`, fog `#A7B8B0` | foxglove `#9B5FA8`, glow-cap mushrooms `#7FD1C1` | Dappled shafts `#F3E6A8`; cooler and bluer as you go deeper. Oak, holly and bramble. Landmarks: the Standing Horn menhir, the Sleepers' Path (trampled ferns, readable only at night or to a sharp eye), the millpond and drowned lane. |
| **Mooring's Watch** (watchtower) | weathered stone `#8C8A80`, lichen `#A3B35E` | faded barony banner `#8E3B3B`, rust `#9A5A34` | signal-mirror flash `#FF9B3D` (reflected sun; **no beacon brazier**) | Windy, open sky `#9FB4CF`; high contrast, long shadows. The signal mirror on the roof is a light-reactive puzzle object (§7). Hollow Sentinels above, goblin lookout below. |
| **The Deepworks** (Vane glenstone and silver mine) | rock `#4B4640`, cut glenstone `#CDB89A`, shoring timber `#6B4B2E` | coal `#2A2628`, rail iron `#5C5A58` | copper ore `#C07A3E`, crystal `#6FB7C9`, silver seams (`cream` highlights) | Pools of lantern light `#F0A04B` in `#1C1A22` dark. Two kinds of working: the **old glenstone galleries** (square pillared halls, pale cut faces with tool marks, half-cut blocks still in the walls, hand-crane frames; the cutting hall is the goblin camp) and the **silver galleries** (narrow, dark, following frost-bright silver seams in the stone, which thicken toward the Bell Line). The Bell Line rule is carved over the boarded main gate (carving shape only, no legible text). Below the Line: Vane's sealed gallery, Hornfolk carvings, the breach. |
| **Bellwater Priory** (ruined Vesperine monastery) | sandstone `#CDB89A`, grey marble `#B8B4AA` | ivy `#4F6F3A`, fresco blue `#5D7FA3` | gilt `#C9A042`, stained-glass rose `#B04A6A` | Cathedral god-rays; candle `#FFD89A`; dust motes. Melancholy but beautiful. Roofless nave, singing-monk choir statues, scriptorium, the belfry with the cracked **Vesper Bell** (§5.3), crypt, cistern. |
| **The Knot** (labyrinth) | ancient basalt `#3A3A44`, worn bronze `#8C6A3A` | verdigris `#4F9A8A`, bone `#E5DCC5` | glyph glow `#9FD8E0`, torch `#F08A3C` | Cold, geometric, echoing; Hornfolk runes on every wall (§5.3). Areas: Outer Ring, Ossuary Galleries, Chapel of Echoes, Horn's Hall, the Fold, the Sounding Shaft's foot, the Cradle. **Exception — Horn's Hall and the Fold** (the sleepers' vault): warm moss `#7A9A4A`, flowers `#E0B64A`, light-well glow `#F6E7B0` — moss beds, goblin-brought bread, chalk tallies: the visual reveal that it is not a monster's lair. |
| **The Cradle** (heart of the Knot) | ancient basalt `#3A3A44`, carved-face stone `#6E6A78` | dream-fog `#9C98C2`, moth-mottle brown-grey `#7A6A5A` | Nightjar song shimmer `#CFC6F2`, abbot's anchor lanterns `#FFD27A` | Round chamber where the dream leaks into the physical. Sourceless cool dream-light from the centre; geometry softens and blurs toward the middle; every carved face in the room turned toward the centre. The abbot's anchor lanterns are the **only warm light** here, so they read as targets. Unsettling beauty, not horror. |
| **The River Wend** (connective route) | brown river water `#6B5A3E`, towpath clay `#9A8466`, lock stone `#8C8A80` | reeds `#8FA05A`, willow `#6E8A52`, tarred barge timber `#3A2E26` | barge hull stripe ochre `#C9923A`, lock-gate red `#A8473A` | Day or misty dawn; water mirrors `sky` and stays readable as water (§7 water cue; not a flowing-water sim). Places: Briar Glen Quay and the Stone Stair (stepped slipway for dressed blocks, pale stone dust); the **Millweir** (Vesperine stonework with a bell-mark keystone; the sluice walk is a clear walkable top); the towpath; **Kestrel Lock** (balance-beam gates, windlasses, the keeper's cottage, a flaking toll board with no legible text). **The Weeping Adit**: a cold, dark, dripping tunnel mouth where the river springs; a faint Nightjar shimmer `#CFC6F2` on the water is the only sign it is humming. |
| **Wendmouth** (optional harbour town) | glenstone `#CDB89A` weathered to salt-grey `#9C9788`, harbour stone `#7E8584`, tarred plank `#2F2A28` | sea grey-green `#5E7A7A`, sail canvas `#E6D9BC`, net tan `#B08A58` | painted shopfronts and bunting: turquoise `#2E9AA0`, sunflower `#E8B83A`, coral `#D9674E` | **Loud, cheerful, crooked, and built like a city.** Two and a half centuries of the valley's stone trade stayed behind as monumental glenstone: colossal stepped quays worn smooth by hulls, a great curving breakwater of reject blocks each showing its mason's mark, vaulted stone warehouses, a columned Customs House, treadwheel cranes on stone piers, and block yards of cut stone stacked in rows awaiting ships. **Scale contrast is the point:** people, sheds and boats look small against the stone. Everyday life is timber on stone bones: net lofts, tarred sheds, bright shopfronts and laundry perch on and lean against the stonework. The timber leans at the steepest angles in the game (1–3° rule still applies to gameplay geometry); the stone never leans. Default preset **Day**: bright, breezy, high-key light with sea-fog mornings; cooler and higher in value than Briar Glen, with busier pops of colour (bunting, laundry, painted doors) against pale stone. Night: lantern pools on wet flagstones. Places: Stone Wharf (and the gated Silver Quay, imperial guards), Customs House (Lantern Court flag: brass lantern-in-ring on parchment), Bonded Warehouse (bay nine), the Drowned Gull, the Tidemarket, the Undertow (low vaulted block-vaults, candle and lamp-oil light), net-loft rooftops, the **Gilded Tern**, the breakwater with its sunken figurehead and sea-door. |

### 2.3 Magic school palettes (VFX colour language)

Each school is identified by **hue + value + motion signature + shape**, never hue alone (13 schools cannot all
have unique hues, and colour-blind players need the other channels).

| School | Core | Highlight | Shadow/accent | Motion signature | Shape |
|---|---|---|---|---|---|
| **Fire** | `#FF7A1A` | `#FFD36B` | `#C8331A` + smoke `#3A2A22` | Rising, licking, flicker 8–12 Hz | Teardrop flames, embers |
| **Frost** | `#8FD8FF` | `#EAF9FF` | `#2F6FA3` | Slow, crystallising, settles | Hexagonal shards, frost ferns |
| **Storm** | `#FFF36B` | `#FFFFFF`\* | `#5B6CFF` | Instant, jagged, strobing (≤ 3 Hz flash, photosensitivity-safe) | Zig-zag bolts, arcs |
| **Arcane** | `#8B5CF6` | `#D8C8FF` | `#3B1F7A` | Orbiting, precise, steady | Circles, runic rings, motes |
| **Illusion** | `#FF8AD8` | `#8AF0FF` (hue-shift) | `#FFFFFF`\* shimmer | Wavering, doubling, heat-haze | Mirror shards, prismatic fringes |
| **Alteration** | `#2EC4A6` | `#B8F5E6` | `#11614F` | Morphing, rippling | Flowing ribbons, tessellation |
| **Conjuration** | `#3D6BFF` | `#A9C1FF` | `#16235E` | Spiralling in, portal-open | Portal rings, sigil circles on ground |
| **Necromancy** | `#A6D66A` | `#E8FFC8` | rot-violet `#2A1633` | Seeping, dripping, crawling | Wisps, tendrils, bone motes |
| **Nature** | `#5DBB4C` | pollen `#F2E27A` | bark `#6B4A2B` | Growing, blooming, bursting | Leaves, petals, roots |
| **Light** | `#FFE9A8` | `#FFFBEA` | gold `#D9A640` | Radiating, gentle bloom | Rays, halos, sun-discs |
| **Shadow** | `#4A3A6B` | `#8C7BB8` rim | `#120E1C` | Absorbing, inward, smoke-like | Negative space, smoke, eyes |
| **Gravity** | `#2B2D6E` | lensing rim `#E6E0FF` | `#FF5C8A` | Pulling in, orbital debris | Spheres, distortion rings |
| **Time** | `#D9B26F` | `#F7E7C1` | sepia `#6B5335` | Stutter, rewind, freeze-frame | Clock-rings, tick marks, afterimages; affected area desaturates |

\* `#FFFFFF` is allowed **only** in emissive VFX cores and never in albedo.

Physical/non-magic elements share the language: **oil** `#3B2F1E` glossy; **water** `#3F7FA0` clear;
**poison gas** `#9BBF3A` low cloud; **acid** `#C6E03A`; **blood** stylised dark `#6E1F2A` (small, no gore).

---

## 3. Lighting & time-of-day

- **One warm key, one cool fill.** Sun/moon or dominant torch as key; hemisphere ambient as cool fill
  (`sky`/`dusk`). Never flat grey ambient.
- **Shadow colour is never neutral:** shadows tint toward `dusk #3B3A5A`; lit areas toward `hearth`.
- **Baked where possible.** Static environments use vertex-baked AO + light or engine-side baked lighting
  (automatable, no DCC — approach confirmed by `e37-3d-pipeline-decision`); dynamic lights are reserved for torches, spells and gameplay light
  (stealth-relevant — must match `e03-light-field`).
- **Gameplay-true lighting:** anything that visually looks lit must be lit in the sim light field and vice
  versa. A visually dark alcove is a real hiding place. No "fake dark" for mood.
- **Time-of-day presets** (not a continuous cycle in MVP unless design asks):

| Preset | Sun elev. | Key colour | Ambient sky / ground | Fog | Use |
|---|---|---|---|---|---|
| Dawn | 8° | `#F6C38B` | `#8FA8C8` / `#4E4A5A` | `#C9B8B0`, dense | Departures, forest mornings |
| Day | 45° | `#FFF1D6` | `#9FB8D8` / `#6B6250` | `#A7B3B8`, light | Default exploration; **Wendmouth default** |
| Golden hour | 15° | `#FFB870` | `#8C98C0` / `#5A4A3E` | `#D8B890`, medium | **Briar Glen default**, key art |
| Dusk | 3° | `#E07A5A` | `#5A5A8A` / `#3A3040` | `#6A6A8A`, medium | Tension, returning to town |
| Night | moon 30° | `#8FA0D8` (low intensity) | `#2A2E4A` / `#1E1B2E` | `#2E3050`, dense | Stealth, the sleepwalkers |
| Interior/underground | — | torch `#F08A3C` | `#1E1B2E` / `#2A2628` | local, short | The Deepworks, the Knot, cellars |

- **Exposure:** tone mapping ACES-filmic-lite or AgX (renderer permitting), fixed per preset — no auto-exposure
  "blinding" transitions longer than 0.5 s.
- **Post-processing budget (High):** tone mapping, subtle bloom (emissive only), vignette ≤ 15 %, colour-grade
  LUT per location, optional SSAO. **Low:** tone mapping + LUT only; bloom off or half-res.

---

## 4. Shape language

| Shape | Meaning | Where |
|---|---|---|
| **Circles / soft rounds** | Safety, friendliness, home | Briar Glen buildings, NPC faces, Brother Horn's face, the Fold, healing |
| **Squares / blocks** | Strength, stability, order | Knight, stonework, Mooring's Watch, Hollow Sentinels, Bellwater Priory, Hornfolk carving |
| **Triangles / spikes** | Danger, aggression, magic | Goblin weapons, Loom Spiders, briars, traps, fire, storm |
| **Spirals / rings** | Mystery, the old magic, the Knot | Glyphs, the Knot's plan, the Cradle, Arcane/Conjuration/Time VFX |

Rules:
- **Proportions:** characters ~6.5 heads tall (heroic-stylised, not chibi); hands, feet, weapons and
  shoulders exaggerated ~120 %.
- **Bevel everything.** No razor-sharp 90° edges on anything the camera sees up close; chamfer at ~5 % of the
  object's size. Hard edges only for Storm/Frost VFX and danger (spikes, blades).
- **Lean and sag.** Architecture leans 1–3°, rooflines sag, stacks are imperfect — but *gameplay geometry*
  (walkable floors, ledges, climb surfaces) stays true to the collision so the player isn't misled.
- **Big–medium–small:** every asset reads as one big shape, 2–3 medium shapes, then small detail. Never more
  than ~20 % of surface area in small detail.

---

## 5. Silhouette rules

Test: fill the model/concept in solid `ink` on a `parchment` background at 64 px tall. It must be
identifiable. Silhouette checks are part of the consistency checklist in every character/creature template.

### 5.1 The four classes

| Class | Primary shape | Silhouette signature | Palette accent | Materials |
|---|---|---|---|---|
| **Sorcerer** | Tall triangle / A-frame | Deep hood or wide-brimmed hat, long robe flaring at the hem, staff breaking the silhouette vertically, a book or satchel on the hip. | Deep blue-violet `#3E3A7A` robe, parchment `#EFE2C4` trim, arcane accent glow on staff tip. | Cloth, leather, brass clasps, paper. |
| **Knight** | Inverted triangle / block | Broad pauldrons, round or heater shield as a big secondary shape, helmet with a distinct crest or visor slit, heavy boots — widest at the shoulders. | Steel `#9AA3AD`, tabard crimson `#8E2F2F`, gold trim `#C9A042`. | Plate, chain, cloth tabard, leather straps. |
| **Archer** | Lean vertical + diagonal | Longbow arc as a large curve, quiver at a diagonal across the back, short cape or hood, asymmetric (one bracer, one pauldron). | Forest green `#3F6B3A`, leather `#8A6440`, feather accent `#D9C38A`. | Leather, wool, wood, fletching. |
| **Thief** | Low, compact teardrop | Hood + face scarf, no flaring cloth (quiet), tight wraps, many small pouches, daggers kept small; crouch pose is iconic. | Charcoal `#2E2B33`, plum `#4A3350`, one muted warm accent (scarf `#8C4A3A`). Lowest value of the four. | Soft leather, wool, dark cloth. |

- Classes must be distinguishable **by silhouette alone** in the character-select lineup and at 30 m in-game.
- Each class has one **signature prop** that is always visible in silhouette: staff, shield, bow, hood/scarf.
- Equipment variants may change colour and trim but must preserve the primary shape.

### 5.2 Creature families

MVP roster = story bible §8 (10 types). Asset ids use the canon short names (`forgotten`, `goblin`,
`briar-wolf`, `loom-spider`, `hushling`, `tallow-ooze`, `mimic-book|lectern|chest`, `mimic-mortimer`,
`hollow-sentinel`, `abbot`, `horn`).

| Family | Primary shape | Rules | Palette cue |
|---|---|---|---|
| **The Forgotten** (skeletons) | Tall, angular, gappy | Negative space between ribs/limbs is the read; cold eye-glow points. Monks and miners who walked into the song and forgot themselves: **monk-Forgotten** in rotted Vesperine habits with staves and censers, **miner-Forgotten** with picks and lamp-hooks. Posed mid-habit (sweeping, praying, hauling) — "a skeleton might remember". **Clatter** (Brother Anselm Hobb) is the social one: rotted habit, gardener's stoop, tends a patch of pale mushrooms; hunched, apologetic posture distinguishes him in silhouette. | Bone `#E5DCC5`, eye glow `#9FD8E0` (cold, not red); habit cloth in `bark`/`dusk` |
| **Rootcellar Goblins** | Round head, triangle ears, pear body | Head ≈ 1/3 height, huge ears and hands; patched, *lived-in* clothing and tools — they are people with a camp, not vermin. **Kettle helmets signal rank**; slings, nets, noisemakers. **Mother Kettleback**: child-sized (big for a goblin), copper kettle as armour and another as a hat. Snig: small, quick, sticky-fingered, a stolen primer tucked somewhere. | Warm greens `#7A9A4A`–`#9AB85A`, patchwork cloth, copper `#C07A3E` kettles |
| **Briar Wolves** | Horizontal wedge | Lean grey wolves of the Briarwood. Low, forward-leaning; head lowered = threat, raised = curious/neutral (readable disposition). Since the breach they are silent and uneasy: mouths closed, ears swivelled toward the mine. | Lean grey fur in the `stone`/`dusk` range, `bark` undercoat |
| **Loom Spiders** | Radial spikes | Pale, dog-sized, Outer Ring only. Legs break silhouette into spikes; body small relative to leg span. Keep hairy detail painted, not modelled. Their **webs copy the Hornfolk runes in silk** (web lines follow the carved rune paths and are readable as puzzle clues); webs are flammable (§7 flammable cue: cobweb sheets). They shy from light. | Pale bone `#E5DCC5`/`stone` with one warning colour (`ember`) |
| **Hushlings** (dream creatures) | Small, soft-edged teardrop, no feet | Child-sized figures of grey fog shed by the Nightjar's dream. **Blind: smooth, eyeless faces**; heads cocked to listen. Silhouette rules: child proportions (large head) but **never read as a real child** — no clothing detail beyond a fog suggestion of a nightshirt, fingers slightly too long, body fraying into wisps below the knees. Disposition: drifting and swaying = unaware; head snapped toward a sound, leaning in = hunting. Loud sounds tear them apart (VFX: shredding into wisps). Must be distinct from sleepwalkers (real, warm-skinned people, eyes open) and from the abbot (tall, lantern-lit). | Fog grey `#A7B3B8`→`#8E93A6`, faint inner Nightjar shimmer `#CFC6F2`; no eye glow at all |
| **Hollow Sentinels** (animated armour) | Rectangles, hollow | Sergeant Mooring's garrison armour stands, still holding the tower on a forty-year-old order. Visible hollow or glowing seams — the binding inside is the read. Barony tabard remnants; men's names painted on the stands as brush-mark shapes (no legible text). Rigid, formal "on watch" stance; relieved Sentinels salute and fall still. | Steel `#9AA3AD`, faded barony red `#8E3B3B`, faint seam glow |
| **Tallow Ooze** (slime) | Circles, soft blobs | The priory's candle-wax animated by stray dream-magic. Soft blob with **visible contents: wicks, candle stubs, a snuffer**. **Wax, not element-coloured.** Fire melts it into glossy spreading puddles (flammable cue); frost turns it matte, cracked and brittle. | Tallow cream `#E9DDB8`, soot-grey drips `#6A625A`, lit wick `#FFD89A` |
| **Mimics** (book, lectern, chest) | Box / slab | **Book-mimics** in the priory scriptorium, **lectern- and chest-mimics** in the Knot — once Vesperine guardians of the library. *Almost* perfect objects with one tell (ribbon-bookmark tongue, a teeth line in the page edges, a wrong hinge). **Mortimer** (the Lamplit Stacks' tame book-mimic) is a plump, well-oiled, slightly smug book with a red ribbon tongue. | Object materials (leather, oak, brass); no special colour — the tell is shape |
| **The Sleepless Abbot** (wraith, unique) | Tall tapering robe, no feet | Corvin Ashgrove: a monk made of **lantern-lit dream-fog**, gentle and courteous in posture (hands folded, head inclined). Silhouette dissolves at the hem; **solid only while singing** — fog condenses into a firm form, mouth open like a Vesperine choir statue. Carries the Vesper Bell's bronze tongue on his belt and is anchored by floating lanterns (shootable targets). Never skeletal, never snarling. | Dream-fog `#9C98C2`, cold rim `#CFC6F2`, lantern `#FFD27A` |
| **Brother Horn** (minotaur, hero creature) | Massive inverted triangle, horns | Nine feet (≈ 2.75 m), grey-muzzled and old; horns chipped and **bound in bronze wire**; stone-headed axe carved with his true name in Hornfolk runes. Enormous and intimidating at first read (horns, shoulders, the axe), but face shapes are *soft*: big expressive eyes, heavy brow that can read sad, no red glowing eyes, no drool/gore. Small tended details — moss on his shoulders, a cloth bundle, a pouch of bread for the sleepers — hint at gentleness before the reveal. | Warm brown `#6B4A34`, horn ivory `#E5DCC5`, bronze `#8C6A3A`, moss `#7A9A4A`, grey muzzle `#A89A84` |
| *Post-MVP (not in the story bible roster)* — trolls/ogres, boars, golems | Bottom-heavy pear (trolls/ogres); horizontal wedge (boars) | Do not generate for MVP. Rules retained for later: huge forearms, small heads, slow weight. | Moss/stone skin |

**The Nightjar** is **never shown as a creature**. It is suggested only: a vast sleeping shape half-seen in the
Cradle's fog, a moth-mottled brown-grey pattern like a nightjar's plumage, a fallen-star glint. No face, no
eyes, no teeth.

**Sleepwalkers** (the missing, Tansy Pell, Captain Hale at night) are ordinary townsfolk: nightclothes,
barefoot, eyes open, serene; in the Fold they lie on moss beds, breathing, bread at their sides.

**Disposition readability:** creatures communicate state through pose and a small set of consistent cues —
weapons lowered/raised, head up/down, ears/hackles — so social creatures (E14) read as approachable
before any UI appears.

### 5.3 Lore visual language (factions, motifs, signature objects)

| Subject | Visual rules | Palette |
|---|---|---|
| **Hornfolk runes** | Hornfolk magic is inscription: the Knot is a sentence carved as corridors. Runes are **one continuous deep-cut line** that turns at right angles and doubles back (a meander band that never ends), run at hand height along walls, with paired **horn-crescent marks** as word breaks. **Guide-runes** (the ones that lead somewhere) carry a small horn-crescent pointing along the route; ignored runes loop back on themselves. Uncoloured carved stone by default; a rune only glows if it is a light-reactive puzzle object (then it uses the §7 light-reactive cue, never decoratively). Also on Horn's axe, the Standing Horn and horn-coins (a tiny ox asleep on the back). | Carved into basalt `#3A3A44`/bronze `#8C6A3A`; worn highlights `stone-warm` |
| **Hornfolk statues** | Tall, bull-headed, slow and heavy — and **always covering their ears** (the Standing Horn menhir included). Near the Cradle every carved face turns toward the centre. | Basalt, lichen, moss |
| **Vesperine motifs** | Bell shapes and open-mouthed **singing** statues (the opposite of the Hornfolk's covered ears). Habits, hymnals, candle-lit lecterns, bell-shaped niches and window heads. Graves in the lychgate cemetery carry a small bell mark. | Priory palette; gilt `#C9A042` accents |
| **The Vesper Bell** | Large bronze bell in the priory belfry: green with age, **cracked clean through** (a visible, readable crack), **no tongue** until the player rehangs it. Must read from the foot of the Sounding Shaft as a dark bell-mouth against the sky. Its **tongue** (key item): a heavy bronze clapper, green with age, with a faint warm rim to suggest it is "warm to the touch". | Bronze `#8C6A3A`, verdigris `#4F9A8A`, crack shadow `ink`; tongue rim `hearth` |
| **The Sounding Shaft** | A perfectly vertical shaft from the belfry straight down to the Cradle: a column of pale daylight at the top, darkness below. Old bell-ropes, counterweights and rope wraps are its climbing affordances — all obey §7 (tan hemp = flammable, pale-worn edges = climbable). | `dusk` walls, daylight `#F6E7B0` at the top |
| **Lantern Court seals** | The Court's mark is a **pressed lantern inside a ring**. Status reads by shape, not text: **licensed** = lantern seal pressed in red wax on the spine/cover; **restricted** = the same seal plus a parchment writ ribbon tied through it; **forbidden** = no seal — a scraped, scorched or chained patch where a seal would be. Also on the posted edict and the Court letter (seal only; text is font-rendered). | Seal wax `ember #C8553D`, lantern brass `#C9A042`, writ ribbon `parchment` |
| **"A friend below" marks** | The abbot's chalk arrows and notes: a neat, old-fashioned single-line arrow ending in a small open circle (a lantern). They must **never** use the thieves' chalk glyph shapes (§7 alternate-route cue) or its colour. | Lilac-grey chalk `#B8AFCB` |
| **Horn's chalk tallies** | Groups of heavy tally strokes on the Fold's walls (the sleepers, later the player's rescues) — thick, deliberate, made by a big hand. | Chalk `#E8E2D0` on basalt |
| **Vane Deepworks mark** | A simple stamped maker's mark (a pick crossed with a key) on the backs of the planted "goblin trinkets" and on mine gear. | Stamped brass/iron |

### 5.4 River and harbour readability (Wendmouth)

Wendmouth adds **no new creature types** (story bible §8); its opposition is human and social. What it
adds is a dense set of readability rules:

- **Rigging and net lofts are climbables.** Ratlines, shrouds and taut wall-hung nets use the §7 climbable
  cue: pale worn knotted handholds and rope wraps. **Climbable nets hang taut and flat; decorative drying
  nets hang loose in swags and are never taut and vertical.** The net-loft roof route reads as one continuous
  line of pale ridge-edges from the wharf.
- **Cargo nets are cuttables.** A net holding a load that can be cut (e.g. Vane's crate mid-hoist) has its
  load-bearing line marked at the cut point with the §7 **mechanism-for-arrows** band (red-white ring wrap).
  All cargo rope is tan hemp, so it is also flammable, consistent with §7.
- **Crowds for pickpocketing.** Pickpocketable NPCs carry a **visible purse or pouch on a cord at the hip**;
  crowd filler that cannot be picked shows no purse. Crowds are dense, colourful and moving so the thief can
  vanish into them.
- **Disguise legibility (read by hat and coat shape at 30 m, colour second):**

| Group | Silhouette | Colour |
|---|---|---|
| Dockhands (disguise source) | Knit cap, rolled sleeves, tarred canvas smock, cargo hook on the belt | Tar `#2F2A28`, canvas `#E6D9BC` |
| Harbour watch (non-lethal) | Long coat, round brimmed hat, lantern-pole or cudgel | Navy `#2F3E5C`, brass buttons `#C9A042` |
| Customs / Lantern Court (Inspector Cray, clerks) | Starched high-collared coat, spectacles, ledger or scale | `ink` coat, brass lantern-in-ring badge |
| Low Tide Company (smugglers) | Mixed dockside clothes; clubs, knives, nets, whistles | One tell: a sea-green neckerchief `#3E7F6E` |
| Gilded Tern crew | Sailor's short jacket, tarred pigtail, bare feet | Faded blue `#4A6A8A`, canvas |

  A disguised player swaps to the group's full silhouette but keeps **one small class tell** (for example
  the thief's scarf colour at the collar) so players always recognise themselves. Suspicion uses the existing
  §8 eye-glyph; disguises never add UI outlines.
- **Ambient life:** harbour gulls carry stolen shinies with the §7 pickup glint, and their rooftop hoards
  glint too. Wharf rats are small, dark and scatter from light.
- **Named harbour cast** (Mags Oakum, Nell Gannet, Inspector Prudence Cray, Tereza Maelo, Jasper Quell, Big
  Oona, Old Reed, Captain Hesketh) follow the key-NPC rules. Silhouette hooks: Mags has a pipe and forearms
  like hawsers; Nell is tiny, with a gold-toothed grin; Cray is starched, with spectacles; Tereza is elegant
  in Saltmarch cut, with scarred hands; Quell has ink-stained cuffs and a nervous stoop. "Mr. S—'s agent" is
  veiled and is only glimpsed.

### 5.5 Saltmarch import visual language

Tidemarket and Undertow imports from the **Saltmarch Isles** must read as **foreign at a glance**, distinct
from local barony and valley kit, which is squared, iron-and-oak, leather and plain.

- **Shape:** crescents, gull-wing curves and wave scallops. Local kit is blocks and straight edges.
- **Materials:** red and black lacquer, sharkskin (pebbled grey-green), mother-of-pearl inlay, sea-glass,
  knotted cord wraps in place of leather grips.
- **Palette:** lacquer red `#8E2B2B`, lacquer black `ink`, sharkskin `#7D8A84`, sea-glass `#7FC4B8`, pearl
  `cream`.
- **Items:**
  - Curved **Saltmarch sabres** ("curved like a gull's wing").
  - **Harpoon-spears.**
  - **Lacquered round shields.**
  - **Sharkskin brigandine** and other light armour.
  - **Exotic arrows**, each with a distinct head shape: whistling (pierced bone head), netting (weighted net
    pod), tar (black-dipped), glass-headed (sea-glass), grapple (hooked iron).
- **Foreign spellbooks:** sharkskin or lacquered-board bindings with knotted cord ties and a foreign
  wave-knot mark. They carry **no Lantern Court seal**. A book held at customs gets a parchment "held" tag
  (§5.3 seal rules still apply once licensed).
- **Undertow smuggler tools:** tide-silk rope (faint sheen, visibly distinct from tan hemp; flammability follows its `e03-world-properties` entry and the §7 cue),
  glue-soled boots, smoke pearls, a skeleton-key ring, and a customs-seal stamp.
- **Icons:** Saltmarch items share a lacquer or sea-glass accent so they read as imports in the inventory
  grid.

### 5.6 Ships and barges

- **Stone barges** (e.g. Mags Oakum's *Patient Ann*): flat-bottomed, low and tarred, with dressed blocks lashed on timber cradles, a
  stern tiller, a small cabin, and a tow-rope to a horse on the towpath. *Patient Ann* is identified by her
  ochre hull stripe and her skipper's pipe smoke. **Ship names are never painted as legible text.**
- **The Gilded Tern:** a three-masted merchantman anchored in the pool, with a gilded tern figurehead,
  climbable rigging (§5.4), a hold, the captain's cabin and a locked passenger berth. It is built from
  modular pieces within the §13 budgets.
- **Lighters and rowing boats:** small, bright, patched. Regatta boats carry coloured pennants.
- **The sunken figurehead:** an old serpent-headed figurehead with two glass "lantern eyes" under the
  breakwater. It is the truth behind the sea-serpent rumour and marks the barnacled, iron-bound
  smugglers' **sea-door** at the tide line.

---

## 6. Materials & textures

### 6.1 Surface approach

- **Primary:** a single shared **stylized lit material** (soft 3-band ramp diffuse, gentle rim light, no
  physically-accurate specular except wet/metal masks). Implemented once in `src/render`; every model uses it.
- **Colour sources, in order of preference:**
  1. **Palette/gradient atlas** (KayKit-style): UVs index a small 256–512 px palette/gradient texture. Cheapest,
     perfectly consistent, trivially recolourable. Used for kits and most props.
  2. **Hand-painted/GPT-generated tileables** for large surfaces (ground, walls, roofs, cave rock) — painted
     look, low noise, low frequency.
  3. **Unique painted texture** only for hero assets (player classes, Brother Horn, key NPCs, key props).
- No PBR scan textures, no photo-sourced textures, no high-frequency normal-map noise. Normal maps only on
  hero assets and tileables where they read (stone, bark), and never on Low.

### 6.2 Texel density & resolution tiers

| Tier | Size | Use |
|---|---|---|
| T0 | 256² | Palette/gradient atlases, tiny props, decals |
| T1 | 512² | NPCs, standard creatures, prop atlases (Low) |
| T2 | 1024² | Player classes, tileables, prop atlases (High), UI atlases |
| T3 | 2048² | Hero creature (Brother Horn), environment atlases, key-art only on High |
| — | 4096² | **Never** for runtime textures (skybox/backdrop equirect excepted, see §13) |

- **Target texel density:** environment **256 px/m** at High (Low drops the top mip → 128 px/m);
  characters **512 px/m**; hero faces up to 1024 px/m.
- Painted/GPT textures are generated at the largest size (typically 1024² or 1536²) and **downsampled** by the
  pipeline — never upscaled.

### 6.3 Atlasing & tileables

- Props that appear together (e.g. "Sleeping Ox interior", "Deepworks props") share **one atlas + one material**.
- Target **≤ 1 material per character** and **≤ 1 material per prop set**.
- **Tileables** must tile seamlessly on both axes, be low-contrast at the tile boundary, have no single
  recognisable feature that makes repetition obvious, and ship with a **vertex-colour blend** variant
  (e.g. stone ↔ moss) to break repetition without extra textures.
- Trim sheets (1024×256 or 1024×1024 strips) for mouldings, beams, edges, stair noses.
- **Compression:** all runtime textures are **KTX2/Basis** — ETC1S for albedo/palette, UASTC for normal maps
  and UI where artefacts matter. Mipmaps always (except UI).
- **Channel packing:** ORM-style packing where masks are needed (R = AO, G = roughness/wet mask, B = emissive
  mask).

---

## 7. Gameplay readability — the Legibility Language

The constitution says the world is systemic: flammable ropes, freezable water, breakable walls, climbable
ledges. **Players can only use what they can read.** Every world property from `e03-world-properties` that
the player can exploit gets a *consistent, diegetic* visual cue. Same cue everywhere, in every location,
in every art pass. The cue is authored into the asset, not added as UI.

| Property / affordance | Diegetic cue (always) | Colour cue | Secondary cue |
|---|---|---|---|
| **Interactable** (door, lever, chest, book) | Worn brass/polished wear on handles, pull-rings, levers | Brass `#C9A042` wear | On focus: `wayfinder #F2C94C` rim highlight (UI layer, only when in range) |
| **Pickup / loot** | Sits on a readable surface, slight colour pop | — | Glint sparkle every ~3 s (setting to increase) |
| **Climbable** | Pale worn edges, chalk-white scuffs, rope wraps, knotted handholds, or **pale briar-ivy** (one specific plant species used only for climbables) | Ledge top-bevel `#D9C38A`, climb-ivy leaves `#C9D98A` | Consistent geometric lip; never on non-climbable surfaces |
| **Flammable** | Dry straw, hemp rope, oil stains, cobweb sheets, dry brush | Straw `#C9A45C`, oil `#3B2F1E` glossy | Oil barrels have drip marks; hemp rope is always tan (non-flammable chain is iron grey) |
| **Weak / breakable wall** | Diagonal crack pattern, lighter patched mortar, a few fallen bricks at the base | Mortar `#C8BBA6` | Faint dust motes / draught particles, subtle air audio (see audio bible) |
| **Breakable object** | Lighter, thinner wood; visible nail-heads; cracked planks | Pale wood `#B98B5E` | — |
| **Movable / pushable heavy** | Rope lashings, drag scuffs on the floor behind it | Scuff `#A89A84` | Floor scuff decals |
| **Freezable water** | Visible flow/ripple, clear blue | `#3F7FA0` | Surface animated normal/flow |
| **Conductive** | Copper/iron with a coppery sheen | Copper `#C07A3E` | Wet surfaces darker + specular |
| **Wet** | Darker albedo (≈ −25 % value) + specular sheen | — | Drips |
| **Light-reactive** (mirrors, glyphs, sun-dials) | Carved spiral glyph motif | Glyph `#9FD8E0` faint | Glows brighter when lit |
| **Lockable / pickable** | Visible keyhole plate | Brass | Lock quality readable by plate style (iron = simple, brass = medium, black-steel = hard) |
| **Hiding place** | Deep shadow, tall grass, barrels, curtains — must be *actually dark* in the light field | `dusk` | — |
| **Alternate route** | **Thieves' chalk marks** — a small in-world glyph set (circle-slash, arrow-in-circle, three dots) near vents, windows and weak points | Chalk `#E8E2D0` | Doubles as world-building for the thief guild |
| **Mechanism for arrows** | Bullseye target plate / bell / counterweight rope | Painted red-white `#C8553D`/`#EFE2C4` ring | Visible from ≥ 30 m |
| **Cuttable load** (cargo nets, hoist lines) | Taut tan hemp holding a visible load; the cut point wears the mechanism-for-arrows red-white band | Red-white ring on tan rope | Load visibly strains the line (§5.4) |
| **Pickpocketable** | Visible purse or pouch on a cord at the hip | — | Only on NPCs that can actually be picked (§5.4) |

Rules:
- **Consistency beats subtlety.** Once a cue exists it is used 100 % of the time and never for anything else.
  (Pale ivy = climbable. Always. No decorative pale ivy.)
- Cues must survive the Low preset (no reliance on normal maps, bloom or SSAO).
- **Accessibility:** a "highlight affordances" setting (E31) may tint cue categories more strongly; the base
  art must still pass without it.
- **Colour-blind safety:** every cue pairs colour with shape/pattern (cracks, scuffs, glyphs).

---

## 8. VFX colour language

- School colours and motion signatures are defined in §2.3. Elemental surfaces (oil, water, ice, fire,
  poison, electrified water) follow the same colours.
- **Additive vs alpha:** magic cores are additive/emissive; smoke, dust and debris are alpha-blended and use
  environment palette values so they sit *in* the world.
- **Telegraphs:** enemy attack wind-ups use a consistent warm-red ground decal (`#C8553D` at 40 % alpha) with a
  shape matching the hit area; player-owned AoEs use the school colour. Hostile vs friendly is always
  distinguishable.
- **Stealth feedback:** detection is conveyed in the world first (creature pose, a small eye-glyph above the
  head in `parchment` → `hearth` → `ember` as alertness rises). No full-screen red vignettes.
- **Photosensitivity:** no full-screen flashes > 3 per second; flash area ≤ 25 % of screen; Storm uses a
  capped strobe.
- **Flipbooks:** 8×8 or 4×4 frame grids, 512² or 1024² sheets, painted/stylised (see template
  `vfx-flipbook-texture`).
- **Budget:** see §13 (particles, overdraw).

---

## 9. UI / HUD style

**Direction: "illuminated field journal."** Parchment and ink, brass fittings, hand-inked frames, used sparingly.
The HUD is minimal and diegetic-leaning; menus feel like a well-loved adventurer's book.

- **HUD:** health/stamina/mana as short curved brushstroke bars top-right; quickslots bottom-centre as
  small brass-rimmed circles; compass strip top-centre (optional); no permanent minimap in MVP (encourages
  landmarks). HUD elements fade when full/idle.
- **Menus:** parchment panels `#EFE2C4` with `ink #1E1B2E` text, `hearth` hover, `ember` warnings, deckle
  edges; 9-slice frames (see `ui-element` template).
- **Spellbook UI:** each school has a coloured ribbon bookmark (school core colour) and a school glyph.
- **Contrast:** body text on panels ≥ 7:1 (WCAG AAA); HUD text over world always has an ink shadow/backing.
- **Scale:** UI designed at 1920×1080, scales 75–200 % (E31 text size setting).

### 9.1 Fonts (all SIL Open Font License, Google Fonts)

| Role | Font | Notes |
|---|---|---|
| Display / titles | **Cinzel Decorative** (logo accents) + **Cinzel** (headings) | Roman capitals; headings only, never body. |
| UI body & numbers | **Alegreya Sans** (+ Alegreya Sans SC for labels) | Humanist, legible at small sizes, tabular figures. |
| In-world books & letters | **IM Fell English** / **IM Fell DW Pica** | Period letterpress feel; used inside book pages only. |
| Arcane script / runes | **Uncial Antiqua** | Flavour text, spell names on scrolls; never for instructions. |
| Accessibility option | **Atkinson Hyperlegible** | Replaces body/book fonts when "legible font" is on. |

Fonts are self-hosted (WOFF2, subset to Latin + Latin-Extended) — no runtime calls to Google.
OFL texts are copied into `assets/fonts/<font>/OFL.txt` and listed in `assets/CREDITS.md`.

### 9.1a Colour is never the only cue

Every gameplay cue pairs colour with a shape, pattern, sign or label, so a player who cannot tell the
colours apart loses nothing (mw-e31.8). Awareness markers have five silhouettes (disc, diamond,
crescent, triangle, star); HUD bars wear patterns (health solid, stamina diagonal stripes, mana dots,
breath bars, poise ticks); hit markers have four glyphs; damage taken carries a minus sign; an
unaffordable spell cost is struck through; warning toasts have a double rule. The optional
colour-blind palettes (`src/ui/indicator-palette.ts`: deuteranopia, protanopia, tritanopia) re-pick the
bar and alert colours so adjacent ones also differ by at least 3:1 in lightness under the simulated
deficiency. New UI must add its non-colour channel before it ships.

### 9.2 Icon style

- **Item icons:** painted objects, ¾ top-down view, lit from top-left with warm key, soft `ink` drop shadow,
  on transparent background, filling ~80 % of a 256² canvas (exported 128² and 64²). Consistent camera angle.
- **Spell icons:** painted circular medallions; school colour dominant; single simple central symbol;
  readable at 48 px; shared rim frame per school (the frame, not the symbol, carries the school).
- **UI glyphs** (interact, lock, eye, etc.): flat single-colour ink-brush glyphs, 64² SVG/PNG, no painting.
- No photoreal icons, no text in icons, no drop-shadow direction changes between icons.

---

## 10. Camera & FOV

| Parameter | Default | Range / notes |
|---|---|---|
| Vertical FOV (explore) | **60°** | Setting 50–80°. |
| FOV (combat) | 62° | Slight widen, 0.3 s ease. |
| FOV (archer aim) | 42° | 0.2 s ease in, 0.15 s out. |
| Follow distance | 3.8 m explore / 4.6 m combat / 2.2 m interior-tight | Collision pull-in, no clipping into walls. |
| Shoulder offset | 0.45 m right (swappable) | Centre when locked-on. |
| Pitch limits | −60° / +70° | |
| Near plane | 0.1 m | Art must hold up at 1.5 m from the camera (player character back). |

Composition implications for art: player character is seen from behind and above most of the time — backs of
characters (capes, quivers, hoods, shield backs) get as much design love as fronts. Environments are built at
≥ 1.2× real-world scale for doorways and corridors so the camera fits.

---

## 11. "We never do" list

1. Photorealism, photobashing or scan-based textures.
2. Paste, trace or name copyrighted artwork/artists in prompts; imitate a living artist's style by name.
3. Pure black shadows or pure white albedo.
4. Gore, dismemberment, or shock horror. Menace yes, cruelty no. Blood is small, dark and stylised.
5. Grey-brown "gritty" desaturation as a default mood — bleakness is used for contrast, not as the baseline.
6. Glowing red eyes as shorthand for "evil" (especially on Brother Horn and the goblins — creatures are not target
   dummies).
7. Decorative use of a gameplay-legibility cue (e.g. pale ivy that isn't climbable, cracked walls that don't
   break) — the "lying world" breaks the systemic promise.
8. Text baked into generated images (signs, books, UI) — text is always real, localisable, font-rendered.
9. Oversexualised armour/costume; impractical "boob plate".
10. Modern objects, sci-fi elements, anachronistic tech.
11. Full-screen flashing, chromatic aberration abuse, film grain as a crutch.
12. More than one material per character or unique textures for filler props.
13. Assets without a `CREDITS.md` provenance entry, or under licences that forbid free public distribution
    (NC-ND, "editorial", unknown).
14. Cheap loot-box glitter: rarity rainbows, beam-of-light loot pillars.

---

## 12. Reference-free consistency rules for GPT generation

Images are generated **by Claude**, not by hand: `e37-image-gen-runner` runs the OpenAI Codex CLI
non-interactively (`codex exec`, signed in with the owner's ChatGPT subscription, built-in gpt-image tool) with
the filled prompt file, and copies the result to `assets/_incoming/<asset-id>/vN.png`. Fallback when
subscription image generation is unavailable or rate-limited: the OpenAI Images API with `OPENAI_API_KEY`
from the environment. The owner's only job is the **approval gate** (§17).

- **Usage-limit risk:** the ChatGPT subscription has image usage limits. Generate in **planned batches**
  (e.g. one icon series per session) rather than bursts; the runner backs off and resumes on limit errors.
- The **GPT STYLE PREAMBLE** (§14) is pasted verbatim at the top of every image prompt.
- For series (icons, portraits, prop sheets), attach the **approved anchor image** for that series (a
  previously accepted asset from our own repo, recorded in the prompt file) as a reference input — never
  third-party art.
- Generate at the tool's native size (1024², 1536×1024, 1024×1536); request **transparent background** for
  icons, sprites, UI and flipbooks.
- Accept/reject against the category checklist; log every iteration in the prompt file.
- One asset per image unless the template explicitly asks for a sheet.

---

## 13. Technical budgets (derived from the hardware baseline)

Baseline (contract §1): High = 60 fps @ 1440p-equivalent on M1 Pro; Low = 60 fps @ 1080p (30 fps floor in
worst-case combat) on Iris Xe / base M1; initial download ≤ 50 MB; load ≤ 10 s @ 50 Mbps; JS heap ≤ 1.5 GB.
16.7 ms frame; we allocate ≈ 8 ms GPU to opaque geometry + shadows, ≈ 2 ms to VFX/transparency, ≈ 2 ms to post,
leaving headroom. `e32-perf-budgets` enforces the numbers below; if measurement says otherwise, update both.
Numeric budgets are reconciled into a single `perf-budgets.json` owned by `e32-perf-budgets` and read by
`e37-asset-validator`; that file is the machine-readable source, and the tables below must match it.

### 13.1 Per-frame scene budgets

| Budget | High | Low |
|---|---|---|
| Draw calls (after instancing/batching) | ≤ 250 | ≤ 150 |
| Visible triangles | ≤ 1.2 M | ≤ 500 k |
| Unique materials in a loaded scene/area | ≤ 24 | ≤ 24 (same assets) |
| Skinned meshes on screen | ≤ 16 | ≤ 10 |
| Shadow-casting lights | 1 directional, 2 cascades @ 2048² | 1 directional, 1 cascade @ 1024² |
| Dynamic (non-shadow) point lights affecting a pixel | ≤ 8 | ≤ 4 |
| Live particles | ≤ 2 000 | ≤ 800 |
| Full-screen transparent layers (overdraw) | ≤ 3 | ≤ 2 |
| Texture memory resident (GPU) | ≤ 512 MB | ≤ 256 MB |

### 13.2 Per-asset budgets

| Asset class | Triangles (LOD0) | LODs | Texture | Materials | Bones |
|---|---|---|---|---|---|
| Player class character (incl. equipment) | 8 k – 12 k | LOD1 50 % | T2 1024² (one atlas) | 1 | ≤ 65 |
| Key NPC | 4 k – 7 k | LOD1 50 % | T1–T2 | 1 | ≤ 65 |
| Background NPC | 2 k – 4 k | LOD1 50 % | T1 (shared atlas) | 1 | ≤ 65 |
| Standard creature (Forgotten, goblin, Briar Wolf) | 2 k – 6 k | LOD1 50 %, LOD2 20 % | T1 512² | 1 | ≤ 65 |
| Hero creature (Brother Horn) | ≤ 20 k | LOD1 50 %, LOD2 25 % | T3 2048² High / T2 Low | 1–2 | ≤ 80 |
| Small prop (cup, book, bottle) | 50 – 400 | none | prop atlas | shared | — |
| Medium prop (chair, chest, barrel) | 400 – 2 k | LOD1 or impostor | prop atlas | shared | — |
| Large prop (cart, statue, forge) | 2 k – 5 k | LOD1 50 % | prop atlas / T2 | ≤ 1 | — |
| Modular architecture piece | ≤ 1.5 k | merged per cell | env atlas + trims | shared | — |
| Tree | ≤ 3 k | LOD1 + billboard impostor | foliage atlas | 1 | — |
| Held weapon | 300 – 1.5 k | none | character atlas or prop atlas | shared | — |

### 13.3 Download & audio-adjacent budgets

- **Initial download ≤ 50 MB total:** JS/WASM ≤ 8 MB, of which initial JS ≤ 1.5 MB gzipped (the rest is
  WASM, e.g. physics), first playable area (Briar Glen) geometry + textures
  ≤ 28 MB, UI/fonts ≤ 4 MB, audio needed at start ≤ 8 MB (music streams), headroom 2 MB.
- Other locations stream on demand; each location package target ≤ 25 MB.
- **Per-asset caps** (enforced per PR by `mw-e32.3`): a single texture ≤ 4 MB, a single audio loop ≤ 3 MB.
- Skybox/backdrop: equirect 4096×2048 KTX2 (High), 2048×1024 (Low), or cubemap 1024²/face (High), 512²/face (Low).
- Model format: **glTF 2.0 binary (.glb)** with meshopt compression + KTX2 textures; Draco only if the engine
  ADR prefers it.

---

## 14. GPT STYLE PREAMBLE (verbatim — paste at the top of every image prompt)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.
```

> **Title:** the preamble names the game as "The Vesper Bell" (decided in `e39-title-decision`). Any future title change updates this block via a bead and bumps the bible version.

### 14.1 Per-category add-ons (appended after the preamble)

| Category | Add-on text |
|---|---|
| **Concept art** | `Painterly concept illustration, cinematic composition, clear focal point, value structure readable in greyscale, 16:9.` |
| **Character reference sheet** | `Character turnaround sheet: front, three-quarter, side and back views of the same character in a neutral A-pose, full body, identical proportions and colours in every view, evenly lit, plain flat parchment (#EFE2C4) background, no cast shadows, orthographic feel, no perspective distortion.` |
| **Creature reference sheet** | `Creature turnaround sheet: front, side, back and three-quarter views in a neutral stance, full body, consistent proportions, plain flat parchment background, plus one small silhouette inset in solid ink colour. Readable disposition through pose.` |
| **Environment concept** | `Environment concept painting, eye-level third-person game camera about 4 m behind and 2 m above a small figure for scale, strong foreground-midground-background separation, warm light source and cool shadow region, visible gameplay affordances.` |
| **Tileable texture** | `Seamless tileable texture, perfectly repeating on all four edges, top-down orthographic, flat even lighting with no directional shadows or highlights, no perspective, low contrast at the edges, no single standout feature, hand-painted stylized surface.` |
| **Prop sheet** | `Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.` |
| **UI element** | `Game UI element, flat front-facing, clean crisp edges, parchment and ink with brass fittings, designed for 9-slice scaling with plain stretchable centre and edges, transparent background, no text.` |
| **Item icon** | `Single game inventory icon, one object, three-quarter top-down view, centred, filling about 80% of the frame, warm key light from upper left, soft ink drop shadow, transparent background, readable at 64 pixels.` |
| **Spell icon** | `Circular painted spell medallion icon, one simple bold central symbol, school colour dominant, ornate but simple rim frame, centred, transparent background, readable at 48 pixels.` |
| **NPC portrait** | `Head-and-shoulders character portrait, three-quarter view, expressive but natural face, painted, soft warm key light and cool rim, simple softly blurred background in the location's colours, bust framing with space above the head.` |
| **Book cover / page** | `In-world book asset, flat front-facing orthographic, aged leather or cloth binding with embossed motif, no readable text or letters (blank title plate or abstract ornament), even lighting.` |
| **VFX flipbook** | `Stylized hand-painted VFX animation frames arranged in an exact grid of equal cells, one frame per cell, centred in each cell, pure black background for additive blending (or transparent for alpha), no background elements, smooth frame-to-frame progression, loopable.` |
| **Skybox / backdrop** | `Wide panoramic painted sky and distant landscape backdrop, seamless left-right wrap, horizon at vertical centre, no foreground objects, soft painterly clouds, atmospheric perspective.` |
| **Key art / title** | `Key art illustration, epic but warm, strong central composition with negative space reserved for a title logo (added later, do not draw text), cinematic lighting, rich detail at the focal point only.` |

---

## 15. File naming & folder structure

### 15.1 Asset IDs

`<category>-<subject>-<variant>` in lower-kebab-case, ASCII only, ≤ 64 chars; the asset ID **is** the filename
stem (contract §6). Numbered variants use two digits (`-01`). Examples:

| Category prefix | Example |
|---|---|
| `concept-` | `concept-briar-glen-market-01` |
| `char-` (reference sheet) | `char-knight-base-01` |
| `creature-` (reference sheet) | `creature-horn-base-01` |
| `env-` (environment concept) | `env-knot-cradle-01`, `env-knot-fold-01` |
| `tex-` (tileable/trim/atlas) | `tex-stone-cobble-briar-01`, `tex-palette-master-01` |
| `prop-` (prop sheet or single) | `prop-deepworks-shoring-set-01` |
| `model-` (3D) | `model-creature-horn-01` |
| `anim-` | `anim-humanoid-sword-attack-01` |
| `ui-` | `ui-panel-parchment-9slice-01` |
| `icon-item-` | `icon-item-lockpick-iron-01` |
| `icon-spell-` | `icon-spell-fire-ember-01` |
| `portrait-` | `portrait-npc-mirela-bookseller` |
| `book-` | `book-frostglass-careful-cover-01` |
| `vfx-` | `vfx-fire-flame-loop-8x8-01` |
| `sky-` | `sky-briar-glen-golden-hour-01` |
| `keyart-` | `keyart-title-screen-01` |

### 15.2 Folders

```
assets/
  CREDITS.md                         provenance + licence for every shipped asset
  approvals.json                     owner approval records per gate (e37-asset-approval-log)
  _incoming/                         staging for unapproved candidates (recommend gitignored)
    <asset-id>/vN.<ext>              + vN.json (prompt file, tool, model, date)
    music/<asset-id>.wav             owner drops the chosen Suno take here
  prompts/
    README.md                        workflow
    _templates/                      one template per category
    <category>/<asset-id>.md         filled prompt files (one per prompt bead)
  source/                            raw, as-generated/downloaded files (Git LFS recommended)
    <category>/<asset-id>/<asset-id>.<ext>
    <category>/<asset-id>/iterations/   rejected-but-kept iterations (optional)
  kits/<kit-name>/                   unmodified third-party kits + their LICENSE files
  fonts/<font>/                      WOFF2 + OFL.txt
public/assets/                       runtime build output (glb, ktx2, ogg…) — generated by the import pipeline, never hand-edited
```

Runtime path mirrors source: `public/assets/<category>/<asset-id>.<ext>`. The validator (`e37-asset-validator`)
rejects any runtime file without a matching source folder and CREDITS entry.

---

## 16. Provenance & licence tracking

- **Every** asset that ships (or is committed) has an entry in `assets/CREDITS.md` **in the same commit**.
- Allowed licences: CC0, CC-BY 4.0 (attribution in-game credits screen), OFL (fonts), MIT/Apache (code-ish
  assets), our own generations where the tool's terms grant us usage rights for free public distribution.
- **Not allowed:** CC-BY-NC, CC-BY-ND, CC-BY-SA (avoid — viral into the repo), "editorial only",
  "royalty-free, no redistribution" (the repo is public — raw files are redistributed), unknown provenance.
- AI generation entries record: tool + model/version, account tier at generation time, date, prompt file
  path, and the tool's terms URL. Tier matters (e.g. some tools only grant commercial/ownership rights on paid
  tiers — re-check before generating a batch).
- Third-party kits are kept unmodified under `assets/kits/<kit>/` with their original licence file;
  derivatives live in `assets/source/` and reference the kit.
- `e37-credits-audit` runs before every milestone exit.
- Every final asset also has an **approval record** in `assets/approvals.json` matching its file hash; CI
  refuses final assets without one (§17).

---

## 17. Production workflow — who does what

**The owner does no 3D work and no image editing.** Claude produces assets through tool APIs/CLIs; the owner
approves at explicit gates. Every gate decision is recorded in `assets/approvals.json`
(`e37-asset-approval-log`): asset id, gate, version, file SHA-256, approver, date, notes.

### 17.1 2D images (concept, texture, UI, icon, portrait, book, VFX, sky, key art)

1. Prompt bead: Claude fills the template → `assets/prompts/<category>/<asset-id>.md`.
2. Claude runs `e37-image-gen-runner` (`codex exec` → gpt-image; fallback Images API) → `assets/_incoming/<asset-id>/vN.png`.
3. Claude self-checks against the template checklist; iterates (logged).
4. **OWNER APPROVAL GATE — image** (approve / reject with note).
5. Claude promotes the approved version to `assets/source/…`, adds CREDITS + approval record, runs pipeline + validator, commits.

### 17.2 3D models (characters, creatures, unique props)

Bulk props/environments use **CC0 kits** (recoloured, §6). Hero/unique models:

1. Concept/reference sheet generated as in §17.1 (flat, front-facing, clean background — image-to-3D friendly).
2. **OWNER APPROVAL GATE — flat concept image.**
3. Claude calls the image-to-3D API (**Meshy or Tripo**, per `e37-3d-pipeline-decision`) via `e37-3d-gen-api-client`.
4. Remesh / smart low-poly retopo to the §13.2 triangle budget (API).
5. Rig + animations via API where applicable (humanoids may instead use the retarget pipeline, `e37-animation-pipeline`).
6. Download .glb → `assets/_incoming/<asset-id>/vN.glb`.
7. Automated validation (budgets, naming, licence) → import pipeline (meshopt + KTX2).
8. Claude renders a **turntable preview** (headless render of the .glb → PNG strip + GIF, `e37-turntable-preview`).
9. **OWNER APPROVAL GATE — turntable.**
10. Commit with provenance in `CREDITS.md` + approval records for both gates.

Per-model "generate" tasks are therefore **Claude-run**; only the two approval gates are `needs-human`.

### 17.3 Music and SFX

See `docs/audio/audio-bible.md` §9: music stays human-in-the-loop in Suno (owner pastes Claude's prompt,
picks a take, drops it in `assets/_incoming/music/`); SFX are generated by Claude via the ElevenLabs Sound
Effects API (recommended) with an owner listening gate.

### 17.4 Secrets

API keys (`OPENAI_API_KEY`, `MESHY_API_KEY`, `TRIPO_API_KEY`, `ELEVENLABS_API_KEY`) come **only** from
environment variables — never committed, never logged, never written to prompt files, iteration logs or
sidecar JSON.

---

## 18. Change log

| Version | Date | Change | Approved by |
|---|---|---|---|
| v0.1 | 2026-09-27 | First draft: look, palette and location colour keys, lighting, shape language, creatures, legibility language, materials, budgets, GPT STYLE PREAMBLE, naming, provenance, workflow. | — |
| v0.2 | 2026-09-27 | Story canon v0.3: Deepworks as a glenstone and silver mine; the Stone Stair; Wendmouth as a monumental glenstone harbour; stone barges (PR #13). | owner |
| **v1.0** | 2026-09-27 | Owner sign-off. §13.3 cites the same initial-JS and per-asset caps as the perf budget beads (`mw-e32.1`, `mw-e32.3`). | owner |

**Open at sign-off (filed as beads, not blockers):**
- Probe the GPT STYLE PREAMBLE on four samples (concept, icon, tileable, portrait) with CREDITS rows
  (`mw-e37.431`). Any preamble revision it forces is logged here.
