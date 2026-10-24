# The Bridgeward College (mw-ju8.13)

Canon: story bible §3.5 (the college) and §5.16 (its instructors). Owner direction (2026-10-04): a soldierly
training college in Briar Glen teaches fighting and archery, charges for lessons and does not teach sorcery.
Owner, 2026-10-24: "make good decisions". Everything below is an owner-reviewable greybox decision.

## What is built

- **Where.** A new scene `bridgeward-college` (16 x 8 m hall, kit pieces only), entered from the far end of
  the west side of `briar-glen-lane` by `bridgeward-college-door` (past the Sleeping Ox). The west half is the
  fighting hall (three practice dummies), the east half the archery butts (three straw targets). The
  dev-only archery range of mw-e05.14 stays a tuning scene; the butts are greybox here.
- **Who.** Sergeant Maud Garrick (`npc-garrick`, merchant `bridgeward-fighting-hall`) and Master Ewan Rooke
  (`npc-rooke`, merchant `bridgeward-archery-butts`): friendly `townsfolk`, the `shopkeeper` stand behaviour,
  Tripo placeholder bodies.
- **How a lesson works.** Lessons are a new merchant service kind `train` (`teaches: <capability>`); the shop
  window's Services tab lists them. `Shops.train` checks the ADR-0004 unlock rules first (channel
  `trainer:<merchant>`, prerequisites), then the crowns, then charges and teaches; a refusal changes nothing.
  The dialogue-service form of mw-e19.8 (barks, tests, favours instead of crowns) will replace the window later;
  the data (`teaches`, prices, chains) carries over.
- **Lessons and fees** (inside the economy doc's trainer band, 100-400 crowns, rising with the tier):

| Instructor | Technique | Chain step | Needs | Crowns |
|---|---|---|---|---|
| Garrick | Shoulder Barge | barge chain, 1 | none | 100 |
| Garrick | Riposte | parry chain, 2 | Parry (knight start) | 175 |
| Garrick | Shield Charge | shield chain, 2 | Shield Bash (knight start) | 250 |
| Garrick | Disarm | parry chain, 3 | Riposte | 400 |
| Rooke | Pinning Shot | pinning chain, 1 | none | 150 |
| Rooke | Ricochet Shot | pinning chain, 2 | Pinning Shot | 275 |
| Rooke | Severing Shot | pinning chain, 3 | Ricochet Shot | 400 |

All seven are new verbs (no pure numeric unlocks, ADR-0004 P1), granted permanently, with no XP or levels.
Nobody lists a spell: `tests/integration/bridgeward-college.test.ts` asserts it.

## Known gaps

- Combat does not check these capability ids yet (as for the starting techniques); the moves arrive with mw-e04 and mw-e05.
- The archer's techniques can be bought by a knight (the cross-class simple rule, mw-e19.16, is not built).
- Instructors are static in one pose; no barks until mw-e22. The Services tab button reads "Book".
