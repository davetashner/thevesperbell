# Route matrix: obstacles by class

The MVP obstacle x class route matrix (mw-e16.1). Classes change possibilities (CONSTITUTION §2): for every traversal, infiltration or encounter gate the player must pass, this page lists the intended route for each class, the capability that route uses and where the route comes from. Level designers (mw-e26.1 dungeon network, mw-e26.5 Bellwater Priory blockout, mw-e25 and mw-e40 level beads) build from it before blockout; mw-e16.2 turns it into validated content data using the obstacle ids here.

The data is [`route-matrix.json`](route-matrix.json) (obstacle ids are kebab-case and are the ids the registry reuses); this page explains it, and `src/content/route-matrix.test.ts` proves the ACs against the real capability registry (`src/content/data/capability`), the class files (`src/content/data/class`) and [`connectivity.json`](../../src/content/data/world/connectivity.json). Canon is the story bible: §4.1 (beat sheet), §4.2 (Warden resolutions), §4.3 (how each class experiences the beats) and §3.6 (Wendmouth). Where the bible is silent a route is marked **proposal**.

## Reading the matrix

- **Obstacle**: a traversal, infiltration or encounter gate. Puzzles are audited by mw-e15 (see [puzzle-coverage](puzzle-coverage.md)); a puzzle appears here only as the `any` route of the gate it stands in.
- **Tier**: `mandatory` is on the main quest's critical path or is one of the mine entries; `quest` is mandatory inside its own quest (Wendmouth) and optional for the main quest; `optional` is a major optional obstacle.
- **Class column**: `knight`, `archer`, `sorcerer`, `thief` are routes only that class can take, using a capability its class file or the registry grants it (`classAffinity`). `any` is a route anyone can take: a social outcome, an item, a puzzle solution or a slow, noisy fallback. It names no capability.
- **Capabilities**: real ids from the capability registry. A route whose capability does not exist yet is flagged `needs <id> (<owning epic>)`; these are listed together in "Needs capability".
- **Status**: `canon` (the bible says it), `edge` (already a route on a `connectivity.json` edge, so the world validator enforces it) or `proposal` (a designer's suggestion where the bible is silent; owner review in "Open questions").

## Summary

`yes` is a route with a real capability, `needs` a route waiting on a capability, `-` no route. The last column counts the four classes with a route; a mandatory obstacle needs 3 or more and an `any` route (AC-1).

| Obstacle | Tier | knight | archer | sorcerer | thief | any | Classes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `mine-gate` | mandatory | yes | yes | yes | yes | yes | 4 |
| `supply-tunnel` | mandatory | yes | yes | yes | yes | yes | 4 |
| `weeping-adit` | mandatory | yes | yes | needs | yes | needs | 4 |
| `goblin-camp-passage` | mandatory | yes | yes | yes | yes | yes | 4 |
| `outer-ring-gate` | mandatory | yes | yes | yes | yes | yes | 4 |
| `ossuary-crossing` | mandatory | yes | yes | yes | yes | yes | 4 |
| `chapel-of-echoes` | mandatory | yes | yes | yes | yes | yes | 4 |
| `horns-hall-fold-access` | mandatory | yes | yes | needs | yes | yes | 4 |
| `cradle` | mandatory | yes | yes | needs | yes | yes | 4 |
| `sounding-shaft` | mandatory | yes | yes | yes | yes | yes | 4 |
| `belfry` | mandatory | yes | yes | yes | yes | yes | 4 |
| `bay-nine` | quest | yes | yes | yes | yes | yes | 4 |
| `customs-strongroom` | quest | yes | yes | yes | yes | yes | 4 |
| `gilded-tern` | quest | yes | yes | needs | yes | yes | 4 |
| `undertow` | quest | yes | yes | yes | yes | yes | 4 |
| `moorings-watch` | optional | needs | yes | needs | yes | yes | 4 |
| `vane-strongbox` | optional | - | - | yes | yes | yes | 2 |
| `restricted-shelf` | optional | - | - | yes | yes | yes | 2 |

## The six mine entries

The bible (§4.1 beat 5) gives the player these ways into the Deepworks, all of which must stay open so a class is never locked out:

| # | Entry id | Way in | Obstacle |
| --- | --- | --- | --- |
| 1 | `front-gate` | Front gate: Vane's key, the padlock or the vent chimney | `mine-gate` |
| 2 | `side-boarding` | Smash the rotted side-boarding | `mine-gate` |
| 3 | `winch-cage` | Shoot the winch pulley to drop the cage | `mine-gate` |
| 4 | `inner-bar` | Mage Hand the inner bar or Ember the rope latch | `mine-gate` |
| 5 | `supply-tunnel` | The long way: Mooring's Watch and its supply tunnel | `supply-tunnel` |
| 6 | `weeping-adit` | Up the river through the flooded Weeping Adit | `weeping-adit` |

The Sleepers' Path secret (`sleepers-path-mine-gate`, archer tracking) is a seventh, optional approach to the gate, not a way past it, so it is not a counted entry.

## Mandatory obstacles (critical path and mine entries)

### `mine-gate`: The boarded mine gate

The front of the Deepworks, sealed by Vane's order. Four class routes through the gate itself and a social route with the key. Node `mine-gate`, edge `mine-gate-winch`. Beat: §4.1 beat 5.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | `technique.shoulder-barge` | Shoulder through the rotted side-boarding. | §4.1 beat 5; §4.3 knight | edge |
| archer | `arrow.pinning-shot` | Shoot the winch pulley so the cage drops and the gate opens (the edge uses Pinning Shot for the pulley pin). | §4.1 beat 5 | edge |
| sorcerer | `spell.mage-hand`, `spell.ember` | Mage Hand the inner bar, or Ember the rope latch. | §4.1 beat 5 | edge |
| thief | `tool.lockpick`, `verb.climb.rough` | Pick the padlock, or climb the ventilation chimney. | §4.1 beat 5 | edge |
| any | none (social) | Vane's key: persuade, bargain, or steal it (a thief can pickpocket it). Fact deepworks.gate-open. | §4.1 beat 5 | canon |
| any | none (fallback) | Take the long way: supply-tunnel (Briarwood and Mooring's Watch) or weeping-adit (river). | §4.1 beat 5 | canon |

### `supply-tunnel`: The collapsed supply tunnel

The 'long way' round the gate (bible §4.1 beat 5). The edge lists only knight and sorcerer; the archer and thief routes are proposed edge additions (Open questions). Node `supply-tunnel`, edge `supply-tunnel-collapse`. Beat: §4.1 beat 5.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | `technique.shoulder-barge` | Clear the collapse by hand: barge the rotted cribbing and heave the rubble. | §4.3 knight | edge |
| archer | `arrow.rope` | Loose a rope arrow into the roof timber above the fall and climb over through the gap. | proposal | proposal |
| sorcerer | `spell.firebolt` | Burn the timber cribbing that holds the fall (the edge uses Firebolt). | world-map edge | edge |
| thief | `verb.climb.rough` | Squeeze up the cracked wall and through the gap over the fall. | proposal | proposal |
| any | none (fallback) | Dig it out with the miners' picks left in the tunnel: slow and loud (game-time cost, noise event). | proposal | proposal |

### `weeping-adit`: The Weeping Adit

The river way in, found through Mags or a rumour. Every class can use the barge ride; the class routes are quicker. Node `weeping-adit-mouth`, edge `weeping-adit`. Beat: §4.1 beat 5.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | `technique.shoulder-barge` | Burst the rotted sluice boards to drop the water to a wadeable level. | proposal | proposal |
| archer | `arrow.rope` | Anchor a rope across the flooded run to the lower ledge. | proposal | proposal |
| sorcerer | needs `spell.frostglass` (mw-e08) | Frostglass the current's edge to make a footing. | §4.1 beat 5 | canon |
| thief | `verb.climb.rough` | Traverse the adit wall above the waterline. | proposal | proposal |
| any | needs `verb.swim` (mw-e02) | Swim (needs verb.swim), raft, or ride an empty stone barge being winched back up (found via Mags Oakum or rumour 16). | §4.1 beat 5 | canon |

### `goblin-camp-passage`: The Rootcellar goblin camp passage

Wary, not murderous goblins hold the cutting hall on the critical path. Node `rootcellar-camp`. Beat: §4.1 beat 6.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | `technique.shield-bash`, `technique.parry` | Fight through: shield-bash the guards and parry the spears. | §4.1 beat 6 | canon |
| archer | `arrow.pinning-shot` | Pin sentries to the timber from cover and slip past (Hushed shots). | §4.1 beat 6 (sneak) | proposal |
| sorcerer | `spell.fire-wall` | Raise a Fire Wall that scares the camp off the passage (registry capability beyond the MVP set). | §4.1 beat 6 | proposal |
| thief | `trick.pickpocket` | Walk through as kin ("You smell like pockets"); let Snig try his luck. | §4.3 thief | canon |
| any | none (social) | Talk to Mother Kettleback; sneak past; the camp can be fought, sneaked or talked (fact tracked for Framed in Brass). | §4.1 beat 6 | canon |

### `outer-ring-gate`: The Outer Ring gate

Where the player enters the Knot: Hornfolk runes and the Scales puzzle at the Outer Ring Hornfolk gate. The bible is silent on class routes; all four are proposals around the canon puzzle. Node `knot-outer-ring`, edge `breach-outer-ring`. Beat: §4.1 beat 7.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | `technique.shield-bash` | Bash the jammed pan-weights loose so the scales settle. | proposal | proposal |
| archer | `arrow.severing-shot` | Cut the gate counterweight strap from range. | proposal | proposal |
| sorcerer | `spell.mage-hand` | Lift the right weights onto the Hornfolk scales from a distance. | proposal | proposal |
| thief | `tool.lockpick` | Pick the horn-lock under the scales. | proposal | proposal |
| any | none (puzzle) | Solve the Scales puzzle (puzzle scales-room, mw-e15 audits solutions). | bible puzzle placement (mw-e26.1) | canon |

### `ossuary-crossing`: The Ossuary crossing

The pit between the Outer Ring and the Chapel, home of Clatter and the Forgotten. Node `ossuary-galleries`, edge `outer-ring-ossuary`. Beat: §4.1 beat 8.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | `technique.parry` | Hold the narrow span: parry the Forgotten across it. | proposal | proposal |
| archer | `arrow.rope` | Rope line across the pit from the near ledge. | proposal | proposal |
| sorcerer | `spell.ember` | Light the pit braziers one by one (the Dark Crossing puzzle needs light). | proposal | proposal |
| thief | `verb.climb.rough` | Go round the pit wall by hand, in the dark. | proposal | proposal |
| any | none (puzzle) | Solve the Dark Crossing puzzle (dark-crossing); or hum the hymn and Clatter guides you across. | §4.1 beat 8; bible puzzle placement | canon |

### `chapel-of-echoes`: The Chapel of Echoes

Where sound misbehaves; a portcullis bars the way to Horn's Hall. Node `chapel-of-echoes`, edge `ossuary-chapel`. Beat: §4.2.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | `technique.shoulder-barge` | Burst the rotted rood screen beside the portcullis. | proposal | proposal |
| archer | `arrow.severing-shot` | Drop the Chapel portcullis with a single shot at the counterweight. | §4.2 Trick; §4.3 archer | canon |
| sorcerer | `spell.mage-hand` | Ring the chime ropes from range so the echoes settle. | proposal | proposal |
| thief | `tool.lockpick` | Pick the winch-house lock beside the portcullis and raise it. | proposal | proposal |
| any | none (puzzle) | Solve the Chimes puzzle (chimes). | bible puzzle placement | canon |

### `horns-hall-fold-access`: Horn's Hall and the Fold

The pivotal Warden encounter: every resolution lets the player into the Fold. Node `horns-hall`, edge `horns-hall-fold`. Beat: §4.1 beat 10; §4.2.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | `technique.parry` | The Trial of Horns: first to three clean parries or blocks counts as Befriend. | §4.2 table; §4.3 knight | canon |
| archer | `arrow.severing-shot` | Trap Horn behind the dropped Chapel portcullis (shoot the counterweight). | §4.2 Trick | canon |
| sorcerer | needs `spell.mirror-self` (mw-e08) | Lure Horn away with a Mirror Self decoy, or read the runes on his axe aloud. | §4.2 Trick; §4.3 sorcerer | canon |
| thief | `trick.pickpocket` | Steal the Fold's horn-key from his belt, or sneak all the way to the Fold. | §4.2 Trick; §4.3 thief | canon |
| any | none (social) | Befriend (hum the hymn, return the horn-ring or name-stone, have Snig or Clatter vouch, lower your weapon) or fight (and spare or kill). | §4.2 | canon |

### `cradle`: The Cradle

The heart of the Knot; the abbot holds the Bell's tongue. Node `the-cradle`, edge `horns-hall-cradle`. Beat: §4.1 beat 12.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | `technique.parry`, `technique.riposte` | Fight the abbot: parry and riposte the Hushlings; sound and light break his song. | §4.1 beat 12 | canon |
| archer | `arrow.severing-shot` | Shoot out the lanterns that anchor his form. | §4.3 archer | canon |
| sorcerer | needs `spell.mirror-self` (mw-e08) | Mirror Self sings the hymn in his voice so the Forgotten turn on him. | §4.1 beat 12; §4.3 sorcerer | canon |
| thief | `trick.pickpocket` | Lift the tongue from his belt mid-song. | §4.1 beat 12; §4.3 thief | canon |
| any | none (social) | Persuade him to rest (needs Clatter to remember his name), or fight him, or join him (dark path). | §4.1 beat 12; §4.4 | canon |

### `sounding-shaft`: The Sounding Shaft climb

The vertical ascent from the Cradle to the belfry. Node `sounding-shaft-foot`, edge `sounding-shaft`. Beat: §4.1 beat 13.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | `verb.climb.ledge` | Climb the bell-ropes and ledges; or hold the shaft foot while Clatter climbs with the tongue (sacrifice beat). | §4.3 knight | canon |
| archer | `arrow.rope` | Shoot a rope line up the shaft to skip half the climb. | §4.3 archer | canon |
| sorcerer | `spell.mage-hand` | Haul the counterweight chains to make a stair from range. | proposal | proposal |
| thief | `verb.climb.rough` | Free-climb the rough shaft wall past the counterweights. | proposal | proposal |
| any | none (fallback) | Climb the old bell-ropes and counterweights with the song rising behind (a chase if nobody holds the foot). | §4.1 beat 13 | canon |

### `belfry`: The belfry

Reachable by the priory door in Act II or by the shaft in Act III; ringing the bell is the finale. Node `belfry`, edge `nave-belfry`. Beat: §4.1 beats 9 and 14.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | `technique.shoulder-barge` | Burst the jammed stair door from the nave. | proposal | proposal |
| archer | `arrow.rope` | Rope arrow up the roofless stairwell and climb. | proposal | proposal |
| sorcerer | `spell.mage-hand`, needs `spell.frostglass` (mw-e08) | Lift the stair bar from the nave side; mending the crack (Frostglass) is a better ringing. | §4.3 sorcerer | proposal |
| thief | `tool.lockpick` | Pick the stair-door lock. | proposal | proposal |
| any | none (fallback) | Arrive from below by the Sounding Shaft; hang the tongue and ring the bell. | §4.1 beats 13 and 14 | canon |

## Mandatory within their quests (Wendmouth)

### `bay-nine`: Bay nine (Bonded Warehouse)

Mandatory inside the Crate for Mr. S— quest; optional for the main quest. Node `bonded-warehouse`, edge `wharf-bonded-warehouse`. Beat: §3.6; Crate for Mr. S—.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | `technique.shoulder-barge` | Force the bay door (loud: the night watchman responds). | proposal | proposal |
| archer | `arrow.severing-shot` | Cut the hoist strap to drop the crate to the quay door. | proposal | proposal |
| sorcerer | `spell.mage-hand` | Lift the seal and manifest from the desk while the watchman is away. | proposal | proposal |
| thief | `verb.climb.rough`, `tool.lockpick` | Skylight and hoist beams in, then pick the bay seal. | §3.6; §4.3 thief | canon |
| any | none (item) | Forged manifest and customs-seal stamp from the Undertow; dockhand disguise. | §3.6 | canon |

### `customs-strongroom`: The Customs House strongroom

Holds confiscated goods, including restricted spellbooks. Node `customs-house`, edge `wharf-customs-house`. Beat: §3.6; §4.3 sorcerer.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | `technique.shoulder-barge` | Break the door (loud: Inspector Cray's clerks respond). | proposal | proposal |
| archer | `arrow.ricochet-shot` | Bank an arrow off the vault stone to knock the key from its hook. | proposal | proposal |
| sorcerer | `spell.mage-hand` | Lift confiscated books through the grille. | proposal | proposal |
| thief | `tool.lockpick` | Pick the strongroom lock; the net-lofts roof route gives a way in (edge net-lofts-customs-roof). | §3.6 | edge |
| any | none (social) | Bribe or talk Inspector Cray. | §3.6 | canon |

### `gilded-tern`: The Gilded Tern

Sails when Act III begins; the locked berth of Mr. S—'s agent. Node `gilded-tern`, edge `wharf-gilded-tern`. Beat: §3.6; §4.3.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | `technique.shoulder-barge` | Brawl up the gangway and burst the berth door. | proposal | proposal |
| archer | `arrow.severing-shot` | Cut the cargo net as the crate is hoisted so it drops into the harbour. | §4.3 archer | canon |
| sorcerer | needs `spell.frostglass` (mw-e08) | Freeze the harbour pool and walk to the Tern. | §4.3 sorcerer | canon |
| thief | `verb.climb.rough`, `tool.lockpick` | Climb the rigging and pick the passenger berth lock. | §3.6; §4.3 thief | canon |
| any | none (social) | Bribe a lighter-man to row you out; stowaway among the cargo. | proposal | proposal |

### `undertow`: The Undertow

The black market; thief tools and smuggled books. Node `undertow`, edge `gull-trapdoor`. Beat: §3.6.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | `technique.shoulder-barge` | Burst the breakwater door. | proposal | proposal |
| archer | `sense.tracking` | Follow the smugglers' wet bootprints to the Drowned Gull trapdoor (edge gull-trapdoor). | proposal | proposal |
| sorcerer | `spell.mage-hand` | Lift the latch bar through the door slats. | proposal | proposal |
| thief | `tool.lockpick` | Pick the breakwater door. | proposal | proposal |
| any | none (social) | Ask Nell Gannet at the Drowned Gull; she opens the trapdoor. | §3.6 | canon |

## Major optional obstacles

### `moorings-watch`: Mooring's Watch (Hollow Sentinels)

Optional for the main quest (the tower can be skipped); gives the signal mirror and keeper's log. Node `moorings-tower`, edge `courtyard-tower`. Beat: §4.3.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| knight | needs `technique.old-words` (mw-e04) | Formally relieve the Hollow Sentinels by speaking the old words of the watch. | §4.3 knight | canon |
| archer | `arrow.severing-shot` | Shoot the tower's bell cord to end the watch; turn the signal mirror. | §4.3 archer | canon |
| sorcerer | needs `spell.dispel` (mw-e08) | Dispel the Sentinels. | §4.1; §4.3 | canon |
| thief | `verb.climb.rough` | Climb the tower wall and sneak past. | proposal | proposal |
| any | none (fallback) | Sneak or shatter them. | §4.3 | canon |

### `vane-strongbox`: Vane House strongbox

The thief's commission; optional for everyone. Node `vane-house`, edge `rooftop-vane-house`. Beat: §4.3 thief.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| sorcerer | `spell.mage-hand` | Lift the strongbox key from the desk through the study window. | proposal | proposal |
| thief | `verb.climb.rough`, `tool.lockpick` | Rooftop route, strongbox lock, ledger. | §4.3 thief | edge |
| any | none (social) | Invited in by Vane (knight courted, bounty hirelings) and shown the ledger honestly. | §4.3 knight | canon |

### `restricted-shelf`: Mirela's restricted shelf

The back room of the Lamplit Stacks. Node `lamplit-stacks`, edge `green-stacks`. Beat: §4.3 sorcerer.

| Class | Capabilities | Route | Source | Status |
| --- | --- | --- | --- | --- |
| sorcerer | `spell.mage-hand` | Mirela opens the back room to you (restricted shelf access). | §4.3 sorcerer | canon |
| thief | `tool.lockpick` | Pick the back-room door after hours. | proposal | proposal |
| any | none (social) | Earn Mirela's trust through the Vesperine Hours quest line. | §4.1 beat 4 | canon |

## Gaps

Obstacles with only two class routes. Each carries a proposed fix as a connectivity edge (AC-3). None is on the critical path.

- **`vane-strongbox`** (class routes: thief, sorcerer). Add a secret edge vane-house-cellar-grate (market-green to vane-house, kind secret) with routes technique.shoulder-barge (knight breaks the cellar grate) and arrow.rope (archer, over the garden wall to the study roof). Owner: mw-e26.1 / mw-e24. Proposed edge `vane-house-cellar-grate`: `market-green` to `vane-house`, kind `secret`, routes `technique.shoulder-barge`, `arrow.rope`.
- **`restricted-shelf`** (class routes: sorcerer, thief). Make the back room a locked door edge lamplit-stacks-back-room (lamplit-stacks to the back room, kind door) with routes tool.lockpick, spell.mage-hand and technique.shoulder-barge (loud: Mirela's anger), giving thief, sorcerer and knight. Owner: mw-e24 (Lamplit Stacks). Proposed edge `lamplit-stacks-back-room`: `lamplit-stacks` to `lamplit-stacks-back-room`, kind `door`, routes `tool.lockpick`, `spell.mage-hand`, `technique.shoulder-barge`.

## Needs capability

Capabilities named by a route that the registry does not yet contain. Each has an owning epic that must add it (to `src/content/data/capability`) before the route can be built; until then the route is design intent, and the obstacle still meets its minimum through the other routes.

| Capability | Owning epic | Used by |
| --- | --- | --- |
| `spell.dispel` | mw-e08 | `moorings-watch` |
| `spell.frostglass` | mw-e08 | `belfry`, `gilded-tern`, `weeping-adit` |
| `spell.mirror-self` | mw-e08 | `cradle`, `horns-hall-fold-access` |
| `technique.old-words` | mw-e04 | `moorings-watch` |
| `verb.swim` | mw-e02 | `weeping-adit` |

## Proposals

Every route with status `proposal` is a suggestion where the bible is silent, not canon. In summary: the class routes at `outer-ring-gate`, `ossuary-crossing` and `belfry` (the bible places the puzzles and the gate but names no class answers); the archer and thief routes at `supply-tunnel` (so the edge lists four classes rather than two); the archer, thief and knight routes at `weeping-adit`; the knight, sorcerer and thief routes at `chapel-of-echoes`; the thief and sorcerer routes at `sounding-shaft`; and most Wendmouth class routes beyond the canon ones in §4.3.

## Open questions for the owner

1. **Proposed class routes (see Proposals).** Accept, change or strike them. Accepted ones become edge `routes` in `connectivity.json` (mw-e26.1); the `classesHint` check then enforces them.
2. **Supply tunnel edge.** Add `arrow.rope` and `verb.climb.rough` to the `supply-tunnel-collapse` edge so four classes, not two, can open the Mooring's Watch shortcut?
3. **Gap fixes.** Approve the secret edge into Vane House's cellar and the locked back-room door at the Lamplit Stacks, or choose other fixes.
4. **New capabilities.** Are `spell.frostglass`, `spell.mirror-self`, `spell.dispel` (mw-e08), `technique.old-words` (mw-e04) and `verb.swim` (mw-e02) the right ids and owners? The sorcerer's Horn and Cradle routes (Mirror Self) depend on mw-e08 delivering it; until then the sorcerer can still fight Horn and join the `any` routes.
5. **Archer at the mine gate.** The bible says "shoot the winch pulley"; the existing edge models it with `arrow.pinning-shot`. Keep that, or use `arrow.severing-shot` (cut the pulley strap)?
6. **Any-class fallbacks at Wendmouth.** Bribes, stowaway and forged manifests are proposed; the bible names the forged manifest (thief) but not the others.
