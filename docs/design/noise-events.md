# Noise events

One event, `noiseEmitted`, carries every sound the world makes, so stealth reads the world instead
of each system (mw-e03.25, mw-e09.3). Audio playback never reads it; the cue sheets decide what
something sounds like. Propagation (rooms, doors, walls) is `src/sim/noise/propagation.ts`, and
perception (`src/sim/perception`) reads the result as `noiseHeard`.

## The event

```
NoiseEvent { tick, position, loudness, kind, entity, source, tags? }
```

- `loudness`: level in dB at 1 m from the source.
- `kind`: what made it (`item-impact`, `object-impact`, `splash`, `door`, `switch`, `break`, `kick`...).
- `entity`: the thing that sounded (the crate, the door). `source`: who it is attributed to (the
  thrower, the kicker), or null when nobody is.
- A listener never hears a noise it is the `source` or the `entity` of, so a creature does not chase
  its own footfall, thrown item or arrow.

## Impacts: energy times material

Every `physicsImpact` (a crate dropped, a flask thrown, a chandelier landing, a pile falling in)
becomes a noise through one rule, `installImpactNoise` (`src/sim/noise/impacts.ts`), never through the
kind of object:

```
loudness = refDb + dbPerDecade * log10(energy / refEnergy) + max(offset(a), offset(b))    capped at maxDb
```

- The curve is data, the stealth table's `noise.impact` (`src/content/data/stealth/stealth.json`):
  `minEnergy` 1 J, `refEnergy` 10 J = `refDb` 60 dB, 10 dB per tenfold energy, `maxDb` 100.
- Below `minEnergy` nothing is emitted: a settling pile's micro-impacts make no noise (the physics
  layer also drops contacts slower than 1 m/s).
- The material offset is the material's surface loudness in dB relative to stone, its
  `footstepLoudness` (glass +12, iron +6, wood +2, cloth -8). Both surfaces ring; the louder one wins.
- Worked numbers: a 10 J impact on stone is 60 dB; a 200 J crate on stone 73 dB (75 on wood); a 7.8 kJ
  chandelier 89 dB.
- Attribution: a world item's `by` (who dropped or threw it), else the instigator the damage rules
  recorded (`BlameComponent`, set when a carried object is released).
- Splashes (`kind: splash`): a body going under a liquid's surface (`liquidEntered`) sounds by the
  kinetic energy it carries in, with the liquid's material. Water rising over a resting crate carries
  none and is silent.

## Doors

A door that starts to move emits `door` at its profile's loudness plus `20 * log10(speed)` dB, where
speed is how many times faster than by hand it swings. A kicked door (4x) is therefore 4 times the
sound pressure (+12 dB) of the same door shut by hand, and a door eased shut at a quarter speed is
quieter than either. "At least 3 times as loud" is read in sound pressure, not in decibels.

## Other emitters

Breaks (breakable profile loudness), kicks, switches and bells, spells and light sources, AI noises
(`emit-noise`) and the debug scenario emit directly with their own authored loudness.
Footsteps and landings (`footstep`, `landing`) come from the footstep rule below. Getting into and out
of a hiding spot (`hide-enter`, `hide-exit`; mw-e03.23) makes the spot's own authored noise (30 and 24
dB at 1 m by default, a wardrobe's door being quieter than a haystack's rustle if its data says so),
attributed to whoever moved, at the spot. They are not movement noise: everyone listening hears them,
which is how a guard turns round to a wardrobe that clicks shut. Not yet: noise arrows
(mw-e05 payloads), ice cracking, electrical crackle and rope snaps.

## Footsteps

The character controller's one footstep event, `LocomotionEvents` kind `footstep` (mw-e02.11), is what
footstep noise (mw-e09.5, below) reads; it is not itself a noise and nothing propagates from it. It comes
from ground distance travelled at each gait's stride (never from animation), only while grounded and
moving, and carries: `position` (feet), `foot`, `gait`, `material` (the ground's material, `water` while
wading), `wet`, `frozen`, `burning`, `profileNoise` (the movement profile: stance x gait x encumbrance,
0-1), `encumbrance` (the wearer's noise multiplier), `surfaceDb` and `loudness`.

```
surfaceDb = material footstepLoudness + wetDb if wet + frozenDb if frozen      (dB relative to stone)
loudness  = profileNoise x 10^(surfaceDb / 20)                                  (normalised, 1 = sprint on stone)
```

`wetFrom`, `wetDb` and `frozenDb` are the controller profile's `stealth.surfaces`. The `land` event adds
`fallHeight`, `position`, `material`, `surfaceDb` and `encumbrance`. Audio plays the same events, so
footsteps have one detector.

### Footstep noise (mw-e09.5)

`installFootstepNoise` (`src/sim/noise/footsteps.ts`; wired by `startSceneNoise`) turns every `footstep`
and `land` into a `noiseEmitted` (kinds `footstep` and `landing`; `entity` and `source` are the walker,
so it never hears itself). Levels are data, the stealth table's `noise.footsteps`:

```
step    = gaitDb + surfaceDb + equipmentDb + creak                      (dB at 1 m, never below 0)
gaitDb  = sneak 25 | walk 40 | run 55 | sprint 65                       (crouched or slow-walking is a sneak)
equipmentDb = 20 * log10(noise multiplier)
landing = curve(fallHeight) + surfaceDb + equipmentDb                   (silent under 0.5 m)
```

- **Equipment.** ADR-0003 sets one noise multiplier per wearer: the armor load class (1.0 / 1.3 / 1.6 /
  1.8) applied once, times each equipped item's own `noiseMultiplier` (soft boots 0.7), clamped to 0.5-2.0
  (`EquipmentState.noiseModifier`, carried by `CharacterEncumbrance` and the event). A product of
  multipliers is a sum of decibels, so `equipmentDb` is "the sum of the equipped items' noise values" the bead
  asks for, in a form that does not count four armor pieces four times. Medium is +2.3 dB, Heavy +4.1 dB, and
  the clamp caps the term at +6 dB.
- **Surface.** The event's `surfaceDb`: carpet -10, gravel +8, wet +3, frozen +2.
- **Creak.** A surface row's `creak` (hollow boards: 10% for +12 dB) is rolled from the world's
  `footstep-creak` stream, so it replays and moves no other stream. The row's `varianceDb` is not rolled:
  a step is exactly what the formula says (tests and tuning read dB), and variance stays a hint for audio.
- **Landing.** The curve is `landing.curve` (0.5 m 30 dB, 1 m 45, 2 m 60, 3 m 70, 5 m 82, 10 m 95), by the
  fall height whose free fall reaches the touchdown speed. The player's body is not a physics object, so a
  landing raises no `physicsImpact` and no impact noise: the `landing` noise is the only one.
- **Creatures** have no controller. Each tick the creature steps system reads how far a creature moved;
  its speed picks the gait (`creatureGait`: 0.2 m/s walk, 2.5 run, 6 sprint) and its stride
  (0.75 / 1.6 / 2.05 m) paces the steps, so a patrol steps and a standing guard is silent. Without a collider to
  read, a creature's feet use the scene's tagged surface regions, else stone. The state is a `noise.stride`
  component per creature.
- **Who notices.** Perception drops a footstep or landing whose source is not one of its targets, so a
  patrol never turns suspicious of its own colleagues, and the game's `noticesMovement` rule drops the
  player's footsteps for creatures that are friends of the player (stance `ally` or `friendly`: the
  townsfolk and the Bridge Watch today). They still hear a crash, a break or a shout like anyone, and
  hear footsteps again as soon as their regard turns (the stance machinery moves it: a theft they
  witness, a faction-wide change). Awareness indicators and last-known-position ghosts are likewise not
  drawn over friends, so a villager greeting you never flashes a disc. The noise ripple assist (`gameplay.noiseRipples`)
  draws a footstep or landing only when it would be heard (30 dB) where the player stands: your own sneak
  and a far guard's walk stay quiet, a run rings, still at two rings a second at most.

How far it carries (starting knight in Medium armour, stone, open air; `tests/integration/footstep-reach.test.ts`):

| Hearing | Sneak (27 dB) | Walk (42 dB) | Run (57 dB) | Sprint (67 dB) |
|---|---|---|---|---|
| Humanoid, 30 dB / 25 m (carries to hostile or neutral humanoids; friends ignore it) | not heard | 4 m | 23 m | 25 m |
| Undead, 45 dB / 20 m (the Forgotten) | not heard | not heard | 4 m | 13 m |

The player's ordinary movement is a run, so a skeleton hears you at 4 m and a person at 23 m; creeping
(crouch or slow walk) is never heard, a sprint on gravel carries further still.

### Surfaces (mw-e09.4)

`surfaceAt(map, position, tuning, ground?, groundOffsets?)` (`src/sim/surfaces`) answers what a position
sounds like. Scenes tag boxes with a footstep surface (`surfaces` in the scene: `min`, `max`, `surface`,
`priority`; a carpet on a wooden floor), and the footstep rule asks `surfaceAt` for the feet:

1. the highest-`priority` region holding the position wins (the first listed wins a tie); the event's
   `material` is then the region's surface (`carpet`) and its offset is the surface table's;
2. else the ground collider's material and that material's own `footstepLoudness`, as before;
3. else the default, `stone` (0 dB), with a dev warning through the injected `warn`, once per map.

Wet and frozen always come from the ground collider's properties, so a frozen board under a carpet
region still adds `frozenDb`. The surface table is content, `surface-table/surfaces.json`: one row for
each audio bible §7.3 surface id (a test fails on any id in only one list) with `offsetDb` (-20..+20, dB
relative to stone; carpet -10), `varianceDb`, the sound set id `sfx-foot-<surface>` and an optional
`creak` (seeded chance of an extra loud step; hollow wood 10% for +12 dB). Variance and creak are data
for the footstep noise rule (mw-e09.5), which rolls them from the seeded stream. One number per floor
(mw-1jm): a material that names a `footstepSurface` has that surface's table offset as its `footstepLoudness`
(wood 2, dirt -3, water 6; `tests/integration/scene-surfaces.test.ts` fails on a mismatch), so wood is 2 dB
whether it is a collider's material or a tagged region. The material rows remain the source for impacts
(`installImpactNoise` reads `footstepLoudness`) and for the ground; the table is the source for regions. Dry
wood used to be 4 dB; it is now 2, and creaking is the `wood-hollow` region. Audio plays a region's
surface when the manifest has its walking set (`sfx-foot-<surface>-walk`: stone, wood, dirt, grass, gravel,
water-shallow today); a region with no set yet (carpet, wood-hollow, mud) sounds as the ground under it does,
so a carpet still plays stone footsteps while its noise is -10 dB.

Tagged scenes (mw-1jm; the greybox draws each region as a flat patch of its surface's colour on the floor it
covers, `src/render/greybox/surface-patches.ts`, so a region is only tagged where the player can see it):
sleeping-ox (wood boards, door runner and hearth rug and rented-room rug in carpet), marsh-store (wood boards
down, creaky wood-hollow boards and a carpet rug in the home upstairs) and under-the-bridge (gravel shingle
bank). The slice, the lane (cobbles are stone) and the valleys are untagged; `tests/integration/scene-surfaces.test.ts`
checks every region uses a table surface, lies inside its scene and covers a visible floor.
