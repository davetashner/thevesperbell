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
Not yet: noise arrows (mw-e05 payloads), footstep noise (mw-e09.5, below), ice cracking,
electrical crackle and rope snaps.

## Footsteps

The character controller's one footstep event, `LocomotionEvents` kind `footstep` (mw-e02.11), is what
footstep noise (mw-e09.5) will read; it is not itself a noise and nothing propagates from it. It comes
from ground distance travelled at each gait's stride (never from animation), only while grounded and
moving, and carries: `position` (feet), `foot`, `gait`, `material` (the ground's material, `water` while
wading), `wet`, `frozen`, `burning`, `profileNoise` (the movement profile: stance x gait x encumbrance,
0-1), `surfaceDb` and `loudness`.

```
surfaceDb = material footstepLoudness + wetDb if wet + frozenDb if frozen      (dB relative to stone)
loudness  = profileNoise x 10^(surfaceDb / 20)                                  (normalised, 1 = sprint on stone)
```

`wetFrom`, `wetDb` and `frozenDb` are the controller profile's `stealth.surfaces`. Landings are the
separate `land` event (with `impactSpeed`). Audio plays the same event, so footsteps have one detector.
