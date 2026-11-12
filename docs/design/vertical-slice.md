# The m1 vertical slice

The m1 slice is the first time the whole loop runs in a browser: title → class select → spawn room →
corridor → skeleton fight room → loot alcove → locked exit → slice complete. This document is the
single shared definition of "done" for everyone building toward it (mw-e01.1, key `e01-slice-spec`).
It is subordinate to `CONSTITUTION.md` and follows `docs/backlog-contract.md`.

- **Done means one thing:** the world fact `slice.complete` is `true` (§5).
- **Knight only.** Owner decision, 2026-10-02: the slice supports the Knight; the other classes come
  after it (m2 gauntlet, mw-e01.13). Class select still shows all four (§3, beat B1).
- **Under 5 minutes** for a first-time player who knows the controls (§3, time budget). Playtest
  bar: at least 4 of 5 testers finish within 8 minutes without help (mw-e01.10 AC-1).
- **It is the stimulus for the fun tests.** The arena fight is the fight that
  `e35-greybox-combat-test` (mw-e35.4) and `e04-skeleton-fun-validation` (mw-e04.24) judge:
  "fighting a skeleton should be enjoyable even when the player doesn't need XP or loot".

Bead references use the anchor key and the id, e.g. `e04-parry-riposte` (mw-e04.12). Status is as of
2026-10-02: **done** = closed, **open** = still to build. The mapping from keys to ids is in §9.

## 1. Flow at a glance

| #   | Beat                         | Player does                                                     | Required for pass |
| --- | ---------------------------- | --------------------------------------------------------------- | ----------------- |
| B0  | Title                        | New Game (Continue/Load when a save exists)                     | yes               |
| B1  | Class select                 | Confirms the Knight; three other classes shown locked           | yes               |
| B2  | Spawn room                   | Learns to move and look, opens the wooden door                  | yes               |
| B3  | Corridor                     | Walks 20 m in low light; optional ivy climb to a torch ledge    | walk: yes; climb: no |
| B4  | Skeleton fight room (arena)  | Wakes and fights a Forgotten miner: lock on, block, parry, dodge | yes               |
| B5  | Key drop                     | Picks up the "Rusted gallery key" from the skeleton's body      | yes               |
| B6  | Loot alcove                  | Mantles (or steps off a crate) into a raised alcove, opens a chest | no             |
| B7  | Locked exit                  | Iron door opens from the keyring; locked prompt without the key | yes               |
| B8  | Slice complete               | Walks through into the vestibule; `slice.complete = true`       | yes (the pass)    |

Cross-cutting, available on every beat after B2: pause (Esc / Menu), manual save, death and reload
(§6). Autosaves happen at two checkpoints, CP-1 and CP-2, and on completion.

## 2. Coordinates and conventions

Metres; x east, z north, y up; origin at the centre of the spawn-room floor. One scene,
`src/content/data/scene/slice.json` (`e01-slice-greybox-level`, mw-e01.4), built only from the e00 grey-box
kit (`src/content/data/kit`: floor 2×2 m, wall 2×3 m, doorway 2 m with a 1.2×2.2 m opening, pillar
0.6 m square × 3 m, platform 2×2×1 m, crate 1 m). Walls are 3 m high and there are no roofs, as in the
testbed. The coordinate table in §4 is authoritative; the sketch is accurate to ±0.5 m.

Design rules the layout follows:

- **No drop over 2 m.** Falls only hurt above 4 m (`src/content/data/environment-damage/default.json`,
  `e04-environmental-damage`, mw-e04.19), so traversal in the slice never costs health by accident.
- **No soft-locks.** Every floor cell the skeleton can die on is reachable by the knight, and the key
  is a no-drop quest item, so the key can never be lost.
- **The required route is flat.** Climbing and mantling are on optional branches, so the e2e route
  and a cold player never depend on a traversal move they have not discovered.

## 3. Beats

Each beat lists what the player does, then the systems it exercises with their owning bead.

### B0 — Title

The game boots to a grey-box title: New Game, Continue, Load, and the build SHA. With no saves,
Continue is **disabled with an accessible "no saves yet" reason** (mw-e01.2 AC-2). mw-e30.11 AC-2 says
"hidden"; this spec picks disabled-with-reason for the same reason locked class cards stay visible
(B1), and a note on mw-e30.11 asks for its AC to be reconciled. **Owner decision, 2026-10-03:** `/`
is the front door (the title over `game.startScene`); dev and e2e URLs with `?scene=` and friends
skip it, and the testbed is `?scene=testbed` (docs/design/ui.md, "The front door").

| System                                  | Bead                                           | Status |
| --------------------------------------- | ---------------------------------------------- | ------ |
| Title, New Game/Continue, scene hand-off | `e01-title-new-game-flow` (mw-e01.2)          | open   |
| Continue / Load / Save screens          | `e30-save-load-ui` (mw-e30.11)                 | open   |
| Menu kit, focus navigation              | `e00-ui-framework` (mw-e00.23)                 | done   |
| Renderer and physics boot               | `e00-render-bootstrap` (mw-e00.19)             | done   |
| Fixed-step sim bound to rAF             | `e00-game-loop-bridge` (mw-e00.20), `e00-sim-core` (mw-e00.15) | done |
| Start scene from data (`game.startScene`) | `e01-title-new-game-flow` (mw-e01.2 AC-4)    | open   |

### B1 — Class select (Knight only)

**Decision: all four class cards are shown; Archer, Sorcerer and Thief are visibly locked.** The
Knight card is focused by default and is the only one Confirm accepts. Locked cards keep their name,
pitch and three signature verbs, are greyed with a lock badge and the reason "Not playable in this
build yet", and stay focusable so a screen reader announces why.

Why locked rather than absent or skipped:

1. **The class choice is the game's core promise** (CONSTITUTION §1–2: "choosing a class genuinely
   changes how you interact with the world"). A one-card screen hides it; testers should see that
   four fantasies are coming, and e01-slice-playtest can then ask which they would pick.
2. **The screen stays the one m2 ships.** `e19-class-selection` (mw-e19.5) builds a four-card screen.
   Gating by data (`game.playableClasses = ["knight"]`, next to `game.startScene`) means m2 unlocks
   classes by editing one list, with no new UI work and no change to the e2e's input log for B1.
3. **Skipping the screen breaks the flow under test.** mw-e01.2 AC-1 is "selects Knight and
   confirms"; skipping would also skip apply-class, which is what puts the kit and
   `player.class = knight` into the sim and the save.
4. **Confirm can only start a supported run.** Other classes' verbs (bow, spells, lockpicking) are not
   all in the slice's kit, and the slice's encounter is only tuned for the knight.

Debug and test builds can override the list so mw-e19.5's per-class tests (AC-1 thief, AC-3 sorcerer)
still run. This gating did not exist in the backlog; it is new bead `e01-playable-classes`
(mw-e01.15), which mw-e01.2 now depends on.

| System                                   | Bead                                     | Status |
| ---------------------------------------- | ---------------------------------------- | ------ |
| Class select screen, apply-class          | `e19-class-selection` (mw-e19.5)        | open   |
| Class data: knight kit (sword, wooden shield, mail) and capabilities (Parry) | `e19-class-definitions` (mw-e19.4), ADR-0004 | open |
| Capability registry                       | `e19-capability-registry` (mw-e19.2)    | open   |
| Equip the kit (sword, wooden shield)      | `e17-equipment-slots` (mw-e17.4)        | open   |
| Locked cards, `game.playableClasses`      | `e01-playable-classes` (mw-e01.15)      | open (new) |

### B2 — Spawn room (10 × 10 m)

The knight appears at `player-start` (0, −2) facing north, in a 10 × 10 m room lit by one wall torch.
Nothing in this room can hurt them: it is where the player learns move, look, camera and sprint. A
wooden hinged door in the north wall is closed but not locked; Interact opens it ("Open door"). Just
past it, **CP-1** (a player-filtered trigger volume) requests the first autosave, so from about ten
seconds in there is always a save to go back to.

| System                                   | Bead                                                       | Status |
| ---------------------------------------- | ---------------------------------------------------------- | ------ |
| Scene loader and grey-box kit             | `e00-greybox-testbed` (mw-e00.21)                         | done   |
| Movement, sprint, step-up                 | `e02-player-controller` (mw-e02.2)                        | done   |
| Remappable keyboard/mouse and gamepad     | `e02-input-actions` (mw-e02.1), `e02-input-gamepad` (mw-e02.9) | done |
| Orbit camera with collision               | `e02-camera` (mw-e02.4)                                   | done   |
| Animation from sim locomotion             | `e02-animation-hooks` (mw-e02.6), `e02-animation-system` (mw-e02.20) | done |
| Focus, prompt and Interact                | `e02-interaction` (mw-e02.5)                              | done   |
| Door (open/closed/locked), signals        | `e03-doors-locks-switches` (mw-e03.18), `e03-triggers` (mw-e03.21) | open / done |
| Torch as a sim light source, render parity | `e03-light-field` (mw-e03.15), mw-e03.37                 | done   |
| Health and stamina HUD                    | `e04-hud-vitals` (mw-e04.10)                              | open   |
| Footsteps by surface and armour           | `e28-footsteps` (mw-e28.6)                                | done   |
| CP-1 autosave                             | `e30-autosave` (mw-e30.5), `e01-slice-save-points` (mw-e01.7) | done   |

### B3 — Corridor (20 m × 2 m, side alcove)

A straight 2 m-wide corridor runs 20 m north, deliberately dim (an ambient zone of 0.06) with one
wall torch near the far end, so the arena's torchlight reads as a destination. Halfway along, an east
side alcove (3 × 4 m) has a 2 m-high ledge whose face is ivy; a torch burns on top. Walking into the
ivy starts a climb and the knight pulls up onto the ledge; dropping back down is 2 m, so it is safe.
The slice's knight wears mail, a Medium load under ADR-0003 (`docs/adr/0003-encumbrance-model.md`), so
the ivy climbs at ×0.85 speed. A knight in plate (Heavy) is refused with "Too heavy to climb", which is
one more reason no required route uses ivy.
It is optional and gives nothing but the view and the "wait, I can climb that?" moment; it also
matters in the fight (F5: an out-of-reach perch the skeleton cannot follow onto). **CP-2**, at the
corridor's end, requests the second autosave while the knight is still outside the arena, before the
skeleton's awareness can build to Combat.

| System                                    | Bead                                                       | Status |
| ----------------------------------------- | ---------------------------------------------------------- | ------ |
| Ambient zones and sim light field         | `e03-light-field` (mw-e03.15), mw-e03.37                  | done   |
| Climb ivy, pull up onto the ledge         | `e02-climb-surfaces` (mw-e02.13), `e03-climbable-surfaces` (mw-e03.22) | done |
| Climbing drains stamina (5/s)             | `e04-stamina` (mw-e04.5)                                  | done   |
| Load class from armour (climb, jump, noise) | `e04-armor-weight` (mw-e04.16), ADR-0003               | open   |
| Safe 2 m drop (falls hurt above 4 m)      | `e04-environmental-damage` (mw-e04.19), `e02-external-impulses` (mw-e02.15) | done |
| CP-2 autosave, combat veto                | `e30-autosave` (mw-e30.5), `e01-slice-save-points` (mw-e01.7) | done   |

### B4 — Skeleton fight room (arena, 12 × 12 m)

The arena is open to the corridor through a doorway (no door, so retreat is always possible). Two
pillars break lines of attack and let the skeleton's lunge whiff. Two wall torches and a floor brazier
light it. A **Forgotten miner** (`forgotten-miner`) sits in a resting idle with its back to the far
pillar, about 8 m from the doorway, in light. On sight or on noise in the arena it stands and enters
Combat (mw-e01.5 AC-1: Combat within 2 s of the player entering in view). In grey box the resting
idle is the Forgotten's post idle: it stands at its post facing the doorway until the rig brings a
seated pose (E37).

Its three moves are the e04 grey-box set: overhead chop (parryable), two-hit slash (parryable) and
lunging thrust (unparryable, blockable, longer telegraph). The knight's tools are everything the
combat epic has shipped: lock-on and target cycling, the light chain, shield block with guard break,
the parry (10-tick window), dodge roll and backstep with i-frames, hit reactions, hit-stop, stamina.
The riposte is used only if the knight's starting capabilities grant it: ADR-0004
(`docs/adr/0004-progression-model.md`) makes Riposte the second step of the Parry chain, learned from
trainers, so the slice does not depend on it. Heavy/charged attacks, shield bash and kick join if they land before m1 but are not
needed. The brazier deals fire damage to anything within 0.75 m (8 per second), the skeleton included,
so luring it into the fire is a systemic option, not a scripted one.

| System                                       | Bead                                                     | Status |
| -------------------------------------------- | -------------------------------------------------------- | ------ |
| Encounter: placement, resting idle, wake     | `e01-slice-skeleton-encounter` (mw-e01.5)               | open   |
| The skeleton: data, resistances, 3 moves     | `e13-forgotten-skeleton` (mw-e13.1)                     | open   |
| Spawn data-defined creatures                 | `e12-creature-spawner` (mw-e12.4)                       | done   |
| Creature attacks with readable telegraphs    | `e04-creature-attack-hooks` (mw-e04.20), `e12-attack-definitions` (mw-e12.5) | open / done |
| Perception: sight and hearing                | `e11-perception` (mw-e11.5), `e11-awareness-accumulation` (mw-e11.6) | open |
| Alert states, Unaware → Combat → Searching   | `e11-alert-states` (mw-e11.7)                           | open   |
| Engage, space, pick attacks, out-of-reach    | `e11-combat-behaviour` (mw-e11.13)                      | open   |
| Navmesh and paths                            | `e11-navigation` (mw-e11.4)                             | open   |
| Post idle and resume                         | `e11-patrol-routines` (mw-e11.9)                        | open   |
| Leash 25 m and walk home                     | `e01-creature-leash` (mw-e01.17)                        | open (new) |
| Lock on and cycle                            | `e02-lock-on` (mw-e02.16), mw-e02.31 (lock-on facing)  | done   |
| Light chain, block, guard break              | `e04-melee-core` (mw-e04.6)                             | done   |
| Parry window and riposte                     | `e04-parry-riposte` (mw-e04.12)                         | done   |
| Dodge roll, backstep, i-frames               | `e04-dodge-iframes` (mw-e04.8), mw-e04.28              | done   |
| Damage, poise, death; hit volumes            | `e04-damage-model` (mw-e04.1), `e04-hit-volumes` (mw-e04.2) | done |
| Hit reactions and hit-stop                   | `e04-hit-reactions` (mw-e04.7), `e04-hit-stop` (mw-e04.11) | done |
| Stamina                                      | `e04-stamina` (mw-e04.5)                                | done   |
| Fire hazard damage (brazier)                 | `e04-environmental-damage` (mw-e04.19), `e03-element-propagation` (mw-e03.5) | done |
| Hit, block and parry audio                   | `e28-combat-hit-audio` (mw-e28.4), mw-e28.16 (parry cues) | done |
| Placeholder impact VFX                       | `e29-vfx-cue-sheets` (mw-e29.3), `e29-placeholder-vfx` (mw-e29.2) | open |
| Target health bar, lock reticle (nice to have) | `e04-hud-target` (mw-e04.21)                          | done   |

### B5 — Key drop

When the skeleton dies, its Died event drops the **Rusted gallery key** as a world item within 1 m of
the body (mw-e01.5 AC-2). Interact ("Take Rusted gallery key") adds it to the keyring. The key is a
quest item, so it cannot be dropped (mw-e17.7 AC-4) and can never be lost in the level.
The skeleton's scene spawn carries the key (`"carries": [{ "item": "rusted-gallery-key" }]`), and
creature drops (`src/sim/loot/drops.ts`) lay what a dying creature carries, then its definition's loot
table roll, at its body; nothing places the key on the floor any more (mw-e01.5 replaced mw-e01.6's
stand-in at the post). The loot validator counts a carried unique as a placement, so the key stays
the one key in the world.

| System                          | Bead                                                   | Status |
| ------------------------------- | ------------------------------------------------------ | ------ |
| Died event → key drop           | `e01-slice-skeleton-encounter` (mw-e01.5)             | open   |
| World item entity and pickup    | `e17-world-pickup-drop` (mw-e17.7, now P0)            | open   |
| Inventory and keyring           | `e17-inventory-core` (mw-e17.3), `e17-item-schema` (mw-e17.2) | open |
| Key item data                   | `e01-slice-loot` (mw-e01.6)                           | open   |

### B6 — Loot alcove (optional)

Off the arena's east side, a 3 × 4 m alcove sits 1.4 m above the arena floor. Two ways up: jump at the
sill and mantle (jump-mantle reaches 1.6 m, a little less in mail: ADR-0003 jump ×0.95), or step onto the loose crate beside it (1 m, an automatic
mantle) and then up the remaining 0.4 m. The crate is a physics object, so it may get knocked about in
the fight. Inside is a chest with the slice loot table: a healing draught, a few coins and one oddity
whose text follows the bible's item voice (story bible §7.4). Looted once, it stays empty across saves
(mw-e01.6 AC-3).

| System                                   | Bead                                                       | Status |
| ---------------------------------------- | ---------------------------------------------------------- | ------ |
| Mantle (auto ≤ 1.0 m, jump ≤ 1.6 m)      | `e02-ledge-mantle` (mw-e02.12)                            | done   |
| Loose crate as a physics object           | `e03-physics-objects` (mw-e03.10), mw-e03.39              | done   |
| Container that persists its contents      | `e18-containers` (mw-e18.3)                               | open   |
| Container window, pickup notifications    | `e18-container-ui` (mw-e18.4)                             | open   |
| Loot table and seeded roller; validator   | `e18-loot-tables` (mw-e18.1), `e18-loot-validator` (mw-e18.2) | open |
| Slice loot data and chest placement       | `e01-slice-loot` (mw-e01.6)                               | open   |
| Drink the draught (optional)              | `e17-consumables-quickslots` (mw-e17.6)                   | open   |

### B7 — Locked exit

The iron door in the arena's north wall carries lock `slice-exit`. Without the key, Interact leaves it
locked and shows the lock's hint ("Locked.") and nothing completes (mw-e01.4 AC-3). With the key on
the keyring it unlocks and opens straight away, with no inventory screen (mw-e01.6 AC-2,
mw-e17.5). The door is iron, not wood, so it does not burn and the brazier cannot open a second route.

| System                         | Bead                                     | Status |
| ------------------------------ | ---------------------------------------- | ------ |
| Lock with a key id; door state | `e03-doors-locks-switches` (mw-e03.18)   | open   |
| Keyring auto-use on locks      | `e17-keys-keyring` (mw-e17.5)            | open   |
| Locked prompt                  | `e02-interaction` (mw-e02.5)             | done   |

### B8 — Slice complete

Beyond the door, a 2 × 3 m vestibule holds the **slice-complete volume**. Entering it fires a signal
graph whose `fact` receiver writes `slice.complete = true` (§5). The completion autosave follows, then
a "Slice complete" card (run time, class, Return to title, Continue on the mountain road). The card is
new bead `e01-slice-complete-card` (mw-e01.18); the e2e does not depend on it.

The vestibule is no longer a dead end (mw-e24.21): its north wall opens onto a 2 × 6 m passage
(z 40…46) whose `mountain-road` transition leads to valley-01's `arrive-from-slice` spawn, and
valley-01's `south-gate` leads back to the slice's `arrive-from-valley-01` spawn. From there the road
runs valley-01 → valley-02 → valley-03 → Briar Glen (see `docs/design/world-map.md` once merged).

| System                                | Bead                                                         | Status |
| ------------------------------------- | ------------------------------------------------------------ | ------ |
| Trigger volume → fact receiver         | `e03-triggers` (mw-e03.21)                                  | done   |
| Fact store and registry                | `e27-world-state-store` (mw-e27.1), `e27-fact-registry` (mw-e27.2) | done |
| Volume and fact wiring in the scene    | `e01-slice-greybox-level` (mw-e01.4)                        | open   |
| Completion autosave                    | `e01-slice-save-points` (mw-e01.7)                          | done   |
| Completion card                        | `e01-slice-complete-card` (mw-e01.18)                       | open (new) |
| End-to-end proof                       | `e01-slice-e2e-test` (mw-e01.9)                             | open   |

### Cross-cutting systems

| System                                       | Bead                                                        | Status |
| -------------------------------------------- | ----------------------------------------------------------- | ------ |
| Pause: resume, settings, save, load, quit    | `e01-pause-menu` (mw-e01.3), `e31-settings-framework` (mw-e31.1) | done |
| Death beat and respawn rule                  | `e01-death-respawn-loop` (mw-e01.8)                        | open   |
| Death screen, Load last save                 | `e30-death-reload` (mw-e30.7)                              | open   |
| Restart area with no save                    | `e01-slice-restart` (mw-e01.16)                            | open (new) |
| Save format, IndexedDB, slots, recovery      | `e30-save-serialization` (mw-e30.1), `e30-indexeddb-storage` (mw-e30.2), `e30-save-slots` (mw-e30.4), `e30-corruption-recovery` (mw-e30.8) | done |
| Autosave ring and safety vetoes              | `e30-autosave` (mw-e30.5)                                  | done   |
| World facts and entity deltas in saves       | `e27-entity-deltas` (mw-e27.3), `e27-save-integration` (mw-e27.4) | open |
| Creature state in saves                      | `e12-creature-save-state` (mw-e12.14, now P0)              | open   |
| Inventory in saves                           | `e17-inventory-persistence` (mw-e17.8)                     | open   |
| Replays and state hashes                     | `e00-replay-harness` (mw-e00.17), `e00-sim-state-hash` (mw-e00.16) | done |
| Perf and load budgets                        | `e32-perf-budgets` (mw-e32.1)                              | open   |

### Time budget (first-time player)

| Segment                         | Target   |
| ------------------------------- | -------- |
| Title and class select          | 0:20     |
| Spawn room and corridor         | 0:40 (+0:30 with the optional climb) |
| Arena fight                     | 1:00–2:00 |
| Key, alcove and chest           | 0:30     |
| Exit                            | 0:15     |
| **Total**                       | **2:45–4:15**, one death and reload adds about 0:30 |

The required walking route is about 50 m (7 m to the door, 20 m of corridor, 8 m to the skeleton,
about 15 m to the exit), so 10–15 s of the budget is walking at 5 m/s; the rest is the player's.

## 4. Grey-box level plan

### Sketch (top-down, north up)

One column is 0.5 m of x; one row is 1 m of z (the row number is its southern edge). x runs from −7
at the left edge to +10 at the right. Rows with nothing new are left out.

```text
   z
  40            ######
  39            #****#                      * slice-complete volume (vestibule)
  38            #****#
  37  ###########.XX.#################      X locked iron exit door (lock slice-exit)
  36  #........................:::TT:#      T chest     : alcove floor, +1.4 m
  35  #..BB....................::::::#      B brazier (fire hazard, light)
  34  #......................CC::::::#      C loose crate (1 m), a step to the sill
  33  #................OO......::::::#      O pillar B
  32  #................SS......#######      S skeleton post, resting, facing south
  31  #t.......................#            t wall torch (2.25 m up)
  30  #........................#
  29  #......OO...............t#            O pillar A
  28  #........................#
  27  #........................#                ARENA 12 x 12 m
  26  #........................#
  25  #........................#
  24  ###########....###########            open doorway, 1.2 m
  23            #2222#                      2 CP-2 checkpoint volume
  22            #2222#
  21            #...t#
  20            #....#
  19            #....#
  18            #....#                          CORRIDOR 20 m x 2 m
  17            #....#######
  16            #........tt#                t torch on the ledge top
  15            #........iL#                i ivy face (climbable)
  14            #........iL#                L ledge, 2 m high
  13            #........LL#                    side alcove 3 x 4 m
  12            #....#######
  11            #....#
  ...           (z 7-10: plain corridor)
   6            #1111#                      1 CP-1 checkpoint volume
   5    #########1DD1#########              D wooden door (closed, unlocked)
   4    #....................#
   1    #....................#
   0    #t...................#                  SPAWN ROOM 10 x 10 m
  -2    #.........PP.........#              P player-start, facing north
  -5    #....................#
  -6    ######################
       x=-7   -5    -1 0 1    5   9
```

### Spaces

| Space         | Extent (x, z)                | Size           | Floor | Notes |
| ------------- | ---------------------------- | -------------- | ----- | ----- |
| Spawn room    | x −5…5, z −5…5               | 10 × 10 m      | 0     | Wooden door at (0, 5) in the north wall |
| Corridor      | x −1…1, z 5…25               | 2 × 20 m       | 0     | Ambient zone 0.06 (dim) |
| Side alcove   | x 1…4, z 13…17               | 3 × 4 m        | 0     | Ledge x 3…4, z 13…17, 2 m high; ivy on its west face, z 14…16 |
| Arena         | x −6…6, z 25…37              | 12 × 12 m      | 0     | Open doorway (1.2 m) at (0, 25) |
| Loot alcove   | x 6…9, z 33…37               | 3 × 4 m        | +1.4 m | Open to the arena along x = 6 (the sill) |
| Exit vestibule | x −1…1, z 37…40             | 2 × 3 m        | 0     | Behind the iron door at (0, 37) |
| Mountain-road passage | x −1…1, z 40…46      | 2 × 6 m        | 0     | Open doorway from the vestibule; transition to valley-01 at z 44.25…45.75 |

### Placements and volumes

| Id                 | Kind                               | At (x, y, z)        | Data |
| ------------------ | ---------------------------------- | ------------------- | ---- |
| `player-start`     | spawn marker                       | (0, 0, −2), yaw 0   | Faces north |
| `spawn-door`       | door, hinged, wood (flammable)     | (0, 0, 5)           | Closed, unlocked; Interact "Open door" |
| `torch-spawn`      | light (burning, fuel 3600)         | (−4.75, 2.25, 0)    | As in `lighting-room.json` |
| `cp-1`             | trigger volume, player tag         | x −1…1, z 5.5…7     | Checkpoint autosave |
| `alcove-ivy`       | climbable surface, material `ivy`  | x 3, z 14…16, 0…2 m | |
| `alcove-ledge`     | platform                           | x 3…4, z 13…17, 2 m high | Top is the perch |
| `torch-ledge`      | light (burning)                    | (3.5, 2.25, 16.5)   | On the ledge top |
| `torch-corridor`   | light (burning)                    | (0.75, 2.25, 21)    | |
| `cp-2`             | trigger volume, player tag         | x −1…1, z 22…24     | Checkpoint autosave, before the arena |
| `pillar-a`         | pillar                             | (−2.5, 0, 29.5)     | |
| `pillar-b`         | pillar                             | (2.5, 0, 33.5)      | |
| `skeleton`         | creature `forgotten-miner`         | (2.5, 0, 32.5), yaw 180 | Resting idle; leash 25 m around this post; carries `rusted-gallery-key` |
| `torch-arena-west` | light (burning)                    | (−5.75, 2.25, 31)   | |
| `torch-arena-east` | light (burning)                    | (5.75, 2.25, 29)    | |
| `arena-brazier`    | light + hazard (burning, fuel 3600) | (−4.5, 0.75, 35.5) | 8 fire/s within 0.75 m; y is the height of the coals in the bowl (the model stands on the floor), so the flame burns in the bowl |
| `step-crate`       | physics prop `crate`               | (5.5, 0, 34)        | |
| `alcove-chest`     | container, slice loot table        | (8, 1.4, 36), yaw 270 | Faces the arena |
| `exit-door`        | door, hinged, iron                 | (0, 0, 37)          | Lock `slice-exit`, key `rusted-gallery-key` |
| `slice-complete`   | trigger volume, player tag         | x −1…1, z 38.5…40   | Signal graph → fact receiver `slice.complete` |

As built (mw-e01.4): the scene places one signal graph, `src/content/data/signal-graph/slice.json`,
holding the three player-filtered volumes; the scene marks `cp-1` and `cp-2` as checkpoints with
`signals[].checkpoints`, which the game reads through `sceneCheckpoints` and hands to the autosave's
`autosaveAtCheckpoints` through the game's `GameAutosave` (mw-e01.7), with `slice.complete` as a
milestone that autosaves too and the creatures' combat veto holding every autosave while a living
creature is in Combat. Each attempt is published on `#app[data-autosave]`; a placed creature's death
sets `entity:<level>/<spawn>.slain` (e.g. `entity:slice/skeleton.slain`). The player carries the `player` tag in every scene
that places a signal graph. The running build publishes the checkpoints entered on
`#app[data-checkpoints]` and the set world facts on `#app[data-facts]`. The loot alcove's walls stand
4.5 m from the arena floor (3 m above the alcove floor), and its 1.4 m sill is above every creature's
nav jump, so only the knight's mantle gets in. The committed navmesh is
`src/content/data/navmesh/slice.json` (`pnpm nav:bake slice`).

Distances that matter: doorway to the skeleton's post is 7.9 m (inside the 10 m lit-sight range in
mw-e13.1 AC-4); CP-2 is 9–11 m from the post and mostly hidden by the doorway frame, and the save is
taken on entry, before awareness can build to Combat (about 2 s, mw-e01.5 AC-1); the leash edge (25 m from the post) crosses the corridor near
z = 7.5, so the spawn room is beyond it.

## 5. Pass criterion

**The slice is complete when, and only when, the world fact `slice.complete` is `true`.**

- **Declared** in the fact file `src/content/data/fact/slice.json` (added by mw-e01.4; mw-e01.7 adds
  the other slice facts there): `{ "key": "slice.complete", "type": "bool", "default": false, "owner": "signals" }`.
- **Written once**, only by the `fact` receiver of the `slice-complete` volume's signal graph
  (mw-e01.4). Nothing else may write it; the fact-registry check (`e27-fact-registry`) makes an
  undeclared write fail in dev and test builds.
- **It implies the whole run.** The volume is behind the iron door. The door only opens with the key.
  The key only exists after the skeleton dies. So `true` means the knight fought, looted the key,
  unlocked the door and walked through.
- **It survives saves.** Facts are saved (mw-e27.4); the completion autosave and Continue keep it.
- **How the e2e reads it.** The running build publishes it on `#app` (as the other readouts do, e.g.
  `data-creatures`), and Playwright polls it. The e2e test (mw-e01.9) passes when it reads `true`.

The e2e's other assertions (zero console errors and unhandled rejections, the golden final state hash,
load ≤ 10 s, warm reload ≤ 3 s, JS heap ≤ 1.5 GB) are guards that the run was clean. They are not part
of what "complete" means.

### The scripted run (mw-e01.9)

The recorded input log drives the full loop, including one deliberate death:

1. New Game → Knight → Confirm.
2. Walk to the door, open it, pass CP-1 (autosave).
3. Walk the corridor, pass CP-2 (autosave).
4. Enter the arena, lock on, fight. The log uses blocks and parries (and ripostes only if the knight's
   class data grants them), so the fight exercises the timing verbs and not just the light chain.
5. Take the key. Mantle into the alcove; loot the chest.
6. Pause → Save (manual, allowed because the skeleton is dead).
7. Walk into the brazier and stand there until dead (100 health at 8 per second is about 12.5 s).
8. Death screen → Load last save → back at the manual save with the skeleton dead, the chest empty and
   the key on the keyring.
9. Walk to the exit door, Interact (it unlocks), enter the vestibule → `slice.complete = true`.

A second e2e variant (mw-e01.9 AC-4) runs with IndexedDB unavailable; saves fall back to memory with
the documented message and step 9 is still reached.

## 6. Failure modes in scope

The constitution asks that failure create situations, not dead ends. Each of these has an expected
outcome, an owning bead, and a test there.

| #   | Failure                                   | Expected outcome                                                                                                             | Owner (test) |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------ |
| F1  | **Player death** (skeleton, brazier)      | Input freezes; one `player.died` event; a 1.5 s death beat; death screen with "Load last save" focused; playable (within 3 s warm, a perf-suite reference-mode budget) at the most recent save (manual beats autosave when newer); the skeleton's state matches that save. | mw-e01.8 AC-1/AC-2, mw-e30.7 AC-1/AC-2 |
| F2  | **Death with no save** (before CP-1, or a debug kill) | The death screen offers "Restart area" instead of Load; it restarts the slice at `player-start` as the knight with fresh facts and no error. | mw-e30.7 AC-3, mw-e01.16 (new) |
| F3  | **Reload with no save** (page refresh or a fresh profile) | Title shows; Continue is disabled with "no saves yet"; New Game is focused and works. | mw-e01.2 AC-2 |
| F4  | Reload with a save                        | Continue loads the most recent save; the state hash equals the saved hash; a corridor save resumes in the corridor (within 3 s warm, a perf-suite reference-mode budget). | mw-e01.2 AC-3, mw-e01.7 AC-3 |
| F5  | **Leaving the fight room mid-combat**     | The skeleton chases; beyond 25 m from its post (around z = 7.5) it drops the target, searches, walks home and settles to Unaware within 10 s, keeping its wounds. CP-2's autosave waits until combat ends. Pause → Save is disabled with "Can't save during combat"; Resume works. On the ivy ledge the knight is out of reach: the skeleton waits below and does not jitter (at most 1 path request per second). Nothing resets. | mw-e01.5 AC-3, mw-e01.17 (new), mw-e01.7 AC-2, mw-e01.3 AC-2, mw-e11.13 AC-3 |
| F6  | Exit without the key                      | The door stays locked, the locked prompt shows, `slice.complete` stays false. | mw-e01.4 AC-3, mw-e17.5 AC-3 |
| F7  | Brazier contact                           | 8 fire per second while within 0.75 m; leaving stops it; staying kills (→ F1). The skeleton takes the same damage. | mw-e04.19 |
| F8  | Quit to title with unsaved progress       | A confirmation; on confirm the title shows with zero console errors and Continue loads the last save. | mw-e01.3 AC-3 |
| F9  | Storage unavailable (no IndexedDB)        | Saves use the in-memory fallback with a visible non-persistence warning; the run still reaches `slice.complete`. | mw-e01.9 AC-4, mw-e30.11 AC-4 |
| F10 | Corrupt latest save at death              | The death screen's load goes through the recovery flow and offers the backup. | mw-e30.7 AC-4, mw-e30.8 |
| F11 | Chest reopened after reload               | Empty; no second roll. | mw-e01.6 AC-3 |
| F12 | Out of stamina mid-fight                  | Actions are rejected and the stamina bar flashes; the knight can still walk, and a block with no stamina left risks a guard break. | mw-e04.5, mw-e04.10 AC-2 |

Out of scope for m1: wake-in-place deaths (`e01-contextual-respawn`, mw-e01.12, m3), the skeleton
crumbling and reassembling (`e13-forgotten-reassembly`, mw-e13.3), area transitions between scenes
(mw-e01.11, m2), and gamepad disconnect (already pauses, mw-e02.9).

## 7. What is explicitly faked

| Faked                    | In the slice                                                                                       | Real version |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ------------ |
| Art                      | Grey-box kit, colour-coded by purpose; capsule-plus-bones skeleton; grey-box humanoid knight rig; no roofs | E37 integration beads |
| Audio                    | Placeholder sound pack keyed by final ids; no music                                               | E38, `e28-placeholder-sounds` (done) |
| VFX                      | Procedural placeholder effects                                                                     | `e29-placeholder-vfx` → E29 |
| Classes                  | **Knight only**; three cards locked                                                                | m2: `e01-class-gauntlet-level` (mw-e01.13) |
| Dialogue and story       | None. No NPCs, no barks, no quest. The place is a generic mine gallery, not a named bible location. | E22, E23, E39 |
| Item text                | The key and the oddity use placeholder text in the bible's item voice (§7.4)                      | `e39-item-creature-text` |
| The Forgotten            | Fights on sight or noise; no reassembly, no hymn calming, no "ignore quiet players" habit          | mw-e13.3, mw-e13.4 |
| Loot                     | One fixed table; one chest; no ownership or theft                                                  | E18 |
| Title and menus          | Grey-box styling                                                                                   | `e37` title art bead (mw-e37.141) |
| Settings                 | Whatever the settings skeleton offers                                                              | E31 |
| Telemetry                | None in the build; playtests observe in person                                                     | E34 |

## 8. Work this spec added

Found while writing the spec (none of it existed in the backlog):

| Bead      | Key                       | P  | What |
| --------- | ------------------------- | -- | ---- |
| mw-e01.15 | `e01-playable-classes`    | P0 | Lock classes not playable yet on class select; `game.playableClasses` (B1). mw-e01.2 depends on it. |
| mw-e01.16 | `e01-slice-restart`       | P1 | "Restart area" with no save restarts the slice as the chosen class (F2). |
| mw-e01.17 | `e01-creature-leash`      | P0 | Leash the skeleton to its post (25 m) and walk it home with its wounds (F5). mw-e01.5 depends on it. |
| mw-e01.18 | `e01-slice-complete-card` | P1 | The "Slice complete" card and Return to title (B8). |

Dependency changes:

- mw-e01.5 now depends on `e17-world-pickup-drop` (mw-e17.7), promoted to **P0**: the key is dropped
  as a world item the knight picks up.
- mw-e01.7 now depends on `e12-creature-save-state` (mw-e12.14), promoted to **P0**: saving after the
  skeleton leashes home wounded, and the e2e's golden hash after death and reload, need creature state
  in saves.
- Notes on mw-e01.2 and mw-e30.11 record the Continue-disabled decision (B0, F3); mw-e01.4 points here
  for the layout.

## 9. Bead index

| Key                              | Id        | Status |
| -------------------------------- | --------- | ------ |
| `e00-greybox-testbed`            | mw-e00.21 | done   |
| `e00-replay-harness`             | mw-e00.17 | done   |
| `e00-ui-framework`               | mw-e00.23 | done   |
| `e01-creature-leash`             | mw-e01.17 | open   |
| `e01-death-respawn-loop`         | mw-e01.8  | open   |
| `e01-pause-menu`                 | mw-e01.3  | done   |
| `e01-playable-classes`           | mw-e01.15 | open   |
| `e01-slice-complete-card`        | mw-e01.18 | open   |
| `e01-slice-e2e-test`             | mw-e01.9  | open   |
| `e01-slice-greybox-level`        | mw-e01.4  | open   |
| `e01-slice-loot`                 | mw-e01.6  | open   |
| `e01-slice-playtest`             | mw-e01.10 | open   |
| `e01-slice-restart`              | mw-e01.16 | open   |
| `e01-slice-save-points`          | mw-e01.7  | done   |
| `e01-slice-skeleton-encounter`   | mw-e01.5  | open   |
| `e01-title-new-game-flow`        | mw-e01.2  | open   |
| `e02-climb-surfaces`             | mw-e02.13 | done   |
| `e02-interaction`                | mw-e02.5  | done   |
| `e02-ledge-mantle`               | mw-e02.12 | done   |
| `e02-lock-on`                    | mw-e02.16 | done   |
| `e02-player-controller`          | mw-e02.2  | done   |
| `e03-doors-locks-switches`       | mw-e03.18 | open   |
| `e03-light-field`                | mw-e03.15 | done   |
| `e03-physics-objects`            | mw-e03.10 | done   |
| `e03-triggers`                   | mw-e03.21 | done   |
| `e04-creature-attack-hooks`      | mw-e04.20 | open   |
| `e04-damage-model`               | mw-e04.1  | done   |
| `e04-dodge-iframes`              | mw-e04.8  | done   |
| `e04-environmental-damage`       | mw-e04.19 | done   |
| `e04-hud-vitals`                 | mw-e04.10 | open   |
| `e04-melee-core`                 | mw-e04.6  | done   |
| `e04-parry-riposte`              | mw-e04.12 | done   |
| `e04-skeleton-fun-validation`    | mw-e04.24 | open   |
| `e11-alert-states`               | mw-e11.7  | open   |
| `e11-combat-behaviour`           | mw-e11.13 | open   |
| `e11-navigation`                 | mw-e11.4  | open   |
| `e11-perception`                 | mw-e11.5  | open   |
| `e12-creature-save-state`        | mw-e12.14 | open   |
| `e12-creature-spawner`           | mw-e12.4  | done   |
| `e13-forgotten-skeleton`         | mw-e13.1  | open   |
| `e17-keys-keyring`               | mw-e17.5  | open   |
| `e17-world-pickup-drop`          | mw-e17.7  | open   |
| `e18-containers`                 | mw-e18.3  | open   |
| `e18-loot-tables`                | mw-e18.1  | open   |
| `e19-class-selection`            | mw-e19.5  | open   |
| `e27-save-integration`           | mw-e27.4  | open   |
| `e27-world-state-store`          | mw-e27.1  | done   |
| `e30-autosave`                   | mw-e30.5  | done   |
| `e30-death-reload`               | mw-e30.7  | open   |
| `e30-save-load-ui`               | mw-e30.11 | open   |
| `e32-perf-budgets`               | mw-e32.1  | open   |
| `e35-greybox-combat-test`        | mw-e35.4  | open   |
