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
