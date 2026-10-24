# The sorcery teacher under the bridge (mw-ju8.14)

Canon: story bible §3.5 (the Miners' Bridge, the robed figure) and §5.17 (Idris Quillon). Owner direction
(2026-10-04): sorcery is taught by a robed figure met at night underneath the bridge, not by the college.
Owner, 2026-10-24: "make good decisions". Everything below is an owner-reviewable greybox decision.

## What is built

- **Where.** A new scene `under-the-bridge`: a 14 x 8 m shingle bank between two bridge piers, reached from
  `briar-glen-lane` by the `riverbank-path` transition at the end of a short lit alley (a gap in the east wall
  just past the Bridge Watch post). `path-up` leads back (`arrive-from-under-the-bridge`).
- **When (AC-1).** The clock decides. A scene spawn may carry `presence: { phases: [...] }` (the ids of the
  `time.phase` fact). Idris's creature spawn (`npc-quillon`) and his lesson table (`quillon-lessons`, the
  counter that opens the shop) both carry `{dusk, night}`: by day he is not spawned and the table has no
  Talk prompt; at dusk he appears. If the clock crosses a boundary while the player is there, he arrives
  or leaves (`syncPresence`, `watchPresence`). The Bridge Watch uses the same field for its shifts.
- **Who.** `npc-quillon`: a friendly, unarmed `townsfolk` NPC on the `shopkeeper` stand behaviour; a Tripo placeholder body.
- **What he teaches (AC-2).** Ember (`spell.ember`), for 200 crowns, as a merchant `train` service
  (`bridge-sorcerer`, channel `trainer:bridge-sorcerer`; Ember's unlock gained the `trainer` channel). Paying
  takes the crowns, learns the capability and puts `ember` on the player's known-spells list
  (`learnSpell`, in `Shops.train`). Book study (mw-e07.2) is a separate route to the same spell.
- **Discovery (AC-3, manual).** Dot and Mirela's rumours (story bible §6.2, 19-20), a lit path in the lane
  and a lantern on the bank. No dialogue system yet, so the rumour lines are canon text. Whether a first-time
  player finds him without a guide is a playtest question (needs-human bead).

## Decisions

| Call | Decision | Why |
|---|---|---|
| Name and look | Idris Quillon, indigo-violet robe, struck off the Court's register | Names the Lantern Court as his antagonist; "unlicensed" is a status, not a cartoon villain |
| School and spell | Fire school, Ember first | The only sorcerer chain with data and a real spell (ADR-0004); Fire is a licensed school, so the crime is the teaching |
| Price | 200 crowns | Inside the 100-400 trainer band; above the college's first steps for the secrecy |
| Favours | Not built | No favour system; crowns only |
| Hours | Dusk 18:00 to dawn 05:00 | The bead says night; dusk gives the player the evening to find the path |
| Somnomancy | He refuses; no lesson | The forbidden school stays an abbot's temptation (story bible) |

## Not built

Favour payment, further lessons (Firebolt onward come from books), dialogue and barks (E22), a lantern
that is only lit at night, the bridge arch art.
