# Spell catalogue (E08)

Every spell is one JSON file in `src/content/data/spell/<id>.json` (field reference:
`docs/content/spell-schema.md`), run by the one pipeline in `src/sim/magic` (ADR-0007). A spell never
needs a code change; a missing capability is a new generic op or delivery, never a spell-id branch.
Ember (`mw-e08.2`) is the first shipped spell and sets the pattern below. Numbers were chosen
2026-10-24 under the owner's "make good decisions" and live in the files, not here, when they differ.

## Pattern for a new spell

1. `src/content/data/spell/<id>.json`: school, tier, `cost.mana`, `castTime`, `cooldown`, one delivery,
   effect ops, `vfxCue` / `sfxCue` placeholders (`vfx-spell-<id>-cast`, `sfx-spell-<id>-cast`), `bookId`.
2. The teaching book `src/content/data/item/<id>.json`: item id equals the spell id, so the cover art id
   is `ui-book-cover-<id>`; `book.teaches` names the spell. Icons `icon-item-<id>-01` and
   `icon-spell-<id>` go in `src/ui/icons/icon-manifest.json` as placeholders.
3. The spell's scroll (`scroll-of-<id>`) gets `book.casts: "<id>"`. Reading it is `mw-ju8.17`.
4. `tests/integration/<spell>.test.ts` (or `spell-<id>.test.ts`) loads real content, marks the spell and
   book exercised (`markExercised`), and names each AC. Effects are tested through real world rules
   (fire, heat, light), never by asserting the op list.
5. The capability `spell.<id>` already exists in `capability/spells.json`.

Cue ids: a spell file names one `vfxCue` and one `sfxCue`. The finer cues (`-travel`, `-impact`, the
steam puff) are cue-sheet rules on sim events (`SpellCast`, `SpellHit`, `SpellQuenched`) and are added by
the asset integration beads (`mw-e37.73`, `mw-e38.43`).

## Ember (fire, tier 1)

A cheap, short-range ignition bolt: light a candle, rope or oil, or set a flammable creature alight.

| Field | Value | Why |
|---|---|---|
| Mana | 4 | A sorcerer's 100-point pool pays for 25; the free-to-use verb the fire chain starts from (ADR-0004) |
| Cast time / cooldown | 0.3 s / 0.5 s | Near instant, but a 2 casts/s ceiling so it cannot spam-heat a target dry |
| Delivery | projectile, 14 m/s, 12 m range, radius 0.12 m, straight | "Slow" (a walking player outruns nothing, but a guard can step aside) and "short range"; no arc, so aim is precise |
| Damage | 2 fire | 10 % of the reference Firebolt (20 fire, as the `fixture-bolt`), the AC-5 ceiling; `mw-e08.3` should keep Firebolt at 20 or more |
| Heat | 500 °C, 0.25 m sphere, no falloff | Ignites anything with an ignition point up to 450 °C (wood 300, straw, rope, paper, cloth) at once; the small radius keeps it a single target |
| Light | 25 (a torch is 100), 2.5 m, follows the bolt | A visible spark, not a lantern; it gives the caster away a little |
| Noise | 40 dB at release, 45 dB at impact | Quieter than the fire school default (65 dB): a hiss and a pop |
| Water | `quenchedByWater` | Launched underwater or flown into water, it fizzles with no effect, spends nothing, and emits `SpellQuenched` (steam cue) |

Rules it relies on, all from properties: wet objects (wetness 0.5 or more) do not ignite; each Ember
that lands boils off about 0.2 wetness (heat.evaporate, with steam), so a saturated crate is dried
below the soaked threshold by the third Ember and lit by a later one. A damp flammable material
(ivy, wetness 0.2) needs a second Ember: the first only dries it. A creature burns only if it has
the `flammable` property.

Not too useful: no `tooUseful` flag. Ember is deliberately weak in combat and strong at puzzles.

## Mage Hand (arcane, tier 1)

Telekinesis (`mw-e08.10`): hold a distant object, carry it with the aim point and use it from afar.
The generic `tether` delivery (`src/sim/magic/tether.ts`) does the work; the spell file only sets numbers.

| Field | Value | Why |
|---|---|---|
| Mana | 6 to start, then 2 a second (channel) | Sustained: cheap to grab, a real drain to hold a long time |
| Cast time / cooldown | 0.4 s / 1.5 s | A short reach-out; the cooldown starts when the hold ends, so it cannot be flicked on and off |
| Range | 15 m, line of sight | Beyond a thrown bolt, short enough to need the caster in the room |
| Weight limit | 25 kg (`weight` property) | Lifts crates, jars, keys and stools (1-10 kg); not barrels, statues or people. Above it: `ForceResisted`, the cast fizzles |
| Follow speed | 12 m/s, stopped by solid geometry | The object trails the aim by well under 0.3 m at walking-to-running aim speeds; it never passes through a wall |
| Sight | 0.5 s grace, then it drops | Lets go of what it can no longer see; the object holds still meanwhile |
| Use | `tether-use` command | Performs the held object's primary affordance through `interactRemotely`, the same door as a hand interaction, so levers, switches, doors and pick-ups behave identically. Bound to Interact (E, pad A) while a tether is held (`SpellCaster`, mw-e08.25); that press triggers no nearby interaction, and the reticle says "Use" when it would work |
| Let go | `tether-release` command | Cancel cast (B, pad D-pad down) lets go and ends the channel; releasing the cast key does the same |
| Hold | at most 60 s | A scroll's free cast has no channel to end it |

Too useful, on purpose (`tooUseful`): there are no per-object exceptions. A held object is moved by teleporting its
body each tick, so it carries no speed and cannot be used as a weapon (throwing is `mw-e08.11`). A held crate
set down on a pressure plate weighs on it like any crate.

