# The Bridge Watch post (mw-ju8.12)

Canon: story bible §3.5 (The Miners' Bridge) and §5.2 (Captain Hale's Watch). The Bridge Watch keeps a
guard post at the town end of the bridge by day and night and turns away hooligans and monsters.

## What is built

- **Where.** In `briar-glen-lane`, just inside the bridge-end wall (z 2 to 3.5 on the lane, the player
  arrives at z 4 to 5): two pillars at x -3.5 and 3.5 flank the way, a banner (`watch-banner`) hangs
  between them, a lamp (`watch-lamp`) on the east pillar, a low booth on the east side and a brazier
  on a crate (`watch-brazier`) on the west. `guard-post` marks the middle of the way.
- **Who.** Three guards stand at the post facing the bridge: two of the day watch
  (`npc-watchman-day`, tag `watch-day`) and one of the night watch (`npc-watchman-night`,
  tag `watch-night`). All belong to the `bridge-watch` faction and use the `watchman` behaviour
  (a leashed shopkeeper-style stand: keep watch, glance round, turn to look at whoever they notice).
  Spawns are tagged `watch:day` / `watch:night`.
- **Factions.** `bridge-watch` is friendly to the player, allies with itself and the townsfolk, and
  hostile (mutual) to the `unaligned` faction, which is every creature without a faction today,
  the Forgotten included.

## Settled decisions (modest, owner may change)

- **Shift model.** By the game clock (mw-e27.12, mw-ju8.14): the two day guards carry `presence` {dawn, day,
  dusk} and the night guard {dusk, night}, so the day watch stands from 05:00 to 21:00 and the night guard
  from 18:00 to 05:00, with all three at the post through dusk (the handover). A guard not on shift is not
  spawned when the lane loads, and arrives or leaves as the clock crosses a phase boundary while the player is
  there (`src/sim/creatures/presence.ts`).
- **Names.** Guards are unnamed members of the Watch for now. Named guards come with dialogue.
- **Monsters.** Nothing that is not a person on business crosses. This holds structurally: creatures
  never travel through a scene transition and no monster is placed in the lane scenes (asserted in
  `tests/integration/briar-glen-lane.test.ts`). The guards' hostility is declared in the faction
  table; creatures cannot yet pick another creature as a target (the AI's only target is the player),
  so the guards do not yet fight a monster that is in the same scene. That is follow-up work.
- **Armed or armoured strangers.** The post does not stop or search the player. Weapons and armour are
  a matter for the guards' voice, not a gate: a greeting and a remark about what the traveller carries
  once barks and dialogue exist (mw-e22).
- **Attacking a guard.** Out of scope, as for the other townsfolk: no crime, bounty or retaliation
  system. Guards have no attacks.

## Not built

Guard dialogue and barks, guards fighting monsters, retaliation, bounty.
