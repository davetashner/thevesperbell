# Class beat audit (mw-e39.17)

Every class moment in [story-bible.md](story-bible.md) 4.3 and the content ID that carries it. A test
(`tests/integration/class-beats.test.ts`, AC-2) reads this table: each ID must exist and, for a
`narration:` ID, must have the class's own variant.

ID forms:

- `narration:<beat>` is a sequence of `src/content/data/narration/narration-class-beats.json`, looked up
  for the class with `classBeat()`; its prompt or text is the player-facing moment.
- `dialogue:<file>/<node>` is a node of `src/content/data/dialogue/<file>.json`.
- `bead:<id>` is a moment that needs an encounter, level or scene that is not built yet; the narration
  text is written and the bead binds it (the same `narration:` ID appears on the row).

| Class | Bible 4.3 moment | Content IDs |
| --- | --- | --- |
| knight | Arrival: Vane courts you personally | `narration:arrival`, `narration:first-journal`, `dialogue:vane-bounty/greet-knight` |
| knight | Mooring's Watch: formally relieve the Hollow Sentinels | `narration:mooring-watch`, `bead:mw-e25.7` |
| knight | Getting in: shoulder the boards, clear the supply tunnel | `narration:getting-in`, `bead:mw-e25.9` |
| knight | Wendmouth: arm-wrestling table, brawl, duel with Tereza | `narration:wendmouth`, `dialogue:oona-arm-wrestling/greet-knight`, `dialogue:tereza-arms-stall/greet-knight` |
| knight | Horn: the Trial of Horns and "You stand like the barony's men stood" | `narration:horn`, `dialogue:horn-warden/greet-knight-2`, `bead:mw-e13.14` |
| knight | Climax: hold the shaft's foot while Clatter climbs | `narration:climax`, `bead:mw-e26.19` |
| archer | Arrival: Juniper treats you as a peer, Hale asks you to scout | `narration:arrival`, `narration:first-journal`, `dialogue:juniper-fenn/greet-archer`, `dialogue:hale-watch/greet-archer` |
| archer | Night one: the Sleepers' Path in the ferns | `narration:night-one`, `bead:mw-e25.2` |
| archer | Mooring's Watch: signal mirror and the bell cord | `narration:mooring-watch`, `bead:mw-e25.8` |
| archer | Getting in: the rope to the winch house | `narration:getting-in`, `objective:quest-labyrinth-beneath-briar-glen/enter-by-winch-cage` |
| archer | Wendmouth: the Gull Shoot and the cargo net | `narration:wendmouth`, `bead:mw-e40.8` |
| archer | Horn: drop the Chapel portcullis in one shot | `narration:horn`, `dialogue:horn-warden/greet-archer-2`, `bead:mw-e26.14` |
| archer | Climax: shoot a rope line up the shaft, shoot out the anchor lanterns | `narration:climax`, `bead:mw-e26.19` |
| sorcerer | Arrival: the letter, and Mirela opens the back room | `narration:arrival`, `narration:first-journal`, `dialogue:mirela-stacks/greet-sorcerer` |
| sorcerer | The abbot's temptation: Somnomancy | `dialogue:abbot-cradle/tempt-sorcerer`, `bead:mw-e39.43` |
| sorcerer | Night one: the tune that is not a hymn | `narration:night-one` |
| sorcerer | Mooring's Watch: dismiss the Sentinels from the keeper's log | `narration:mooring-watch`, `bead:mw-e25.7` |
| sorcerer | Getting in: a gate-name read aloud | `narration:getting-in`, `objective:quest-labyrinth-beneath-briar-glen/enter-by-inner-bar` |
| sorcerer | Wendmouth: Cray at the dock, the regatta gust, the frozen pool | `narration:wendmouth`, `dialogue:cray-customs/greet-sorcerer`, `bead:mw-e40.9` |
| sorcerer | Horn: read the runes on his axe aloud (his name) | `narration:horn`, `dialogue:horn-warden/runes-1`, `bead:mw-e13.14` |
| sorcerer | Climax: mend the bell's crack before ringing | `narration:climax`, `bead:mw-e26.19` |
| thief | Arrival: the commission from "Mr. S" and Dot's back room | `narration:arrival`, `narration:first-journal`, `dialogue:dot-sleeping-ox/greet-thief` |
| thief | Vane House: rooftop route, strongbox, ledger | `narration:getting-in`, `dialogue:vane-bounty/thief-night`, `bead:mw-e24.9`, `bead:mw-e24.12` |
| thief | Night one: follow in the shadows, mark the barred doors | `narration:night-one` |
| thief | Goblins treat you as kin: "You smell like pockets" | `dialogue:kettleback-kitchen/kin-thief-1` |
| thief | Mooring's Watch: go round the outside wall | `narration:mooring-watch`, `bead:mw-e25.7` |
| thief | Wendmouth: bonded-warehouse heist, disguises, pickpocket race, the drop | `narration:wendmouth`, `dialogue:nell-drowned-gull/commission-deliver-1`, `bead:mw-e40.4`, `bead:mw-e40.8` |
| thief | Horn: sneak all the way to the Fold; "You walk quietly" | `narration:horn`, `dialogue:horn-warden/greet-thief-2`, `bead:mw-e13.14` |
| thief | Climax: pickpocket the tongue from the abbot mid-song | `narration:climax`, `bead:mw-e26.19` |

The wiring of these narration IDs into the game (arrival pages and first journal entry on a new game,
each beat's prompt at its encounter) is mw-aw1y. The thief's buyer stays "Mr. S" and unresolved (post-MVP
hook, bible 4.3).
