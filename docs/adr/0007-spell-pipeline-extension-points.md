# ADR-0007: Spell pipeline extension points — gates, op and delivery registries, pending deliveries, free casts

- **Status:** Accepted
- **Date:** 2026-10-24
- **Decider:** Owner (delegated the design decisions on 2026-10-24)
- **Bead:** `mw-e06.21`

## Decision

Every spell, whatever its school, goes through **one pipeline in `src/sim/magic`** (built in `mw-e06.2`,
PR #264), and later magic beads extend it only through five named seams. They never edit the pipeline's
control flow and never name a spell.

1. **`installSpells(world, {spells})` returns a `SpellPipeline`.** `pipeline.cast(world, {caster, spell,
   source?, target?, aim?})` runs a request now; the `cast` input command calls it for learned spells.
2. **Gates (`pipeline.addGate({name, check, spend?})`)** hold anything that decides whether a learned
   spell may be cast and what it costs: mana, cooldowns, silence, cast-phase state. `check` returns a
   refusal reason or `undefined` and must not change the world. `spend` runs once, only after the
   delivery has started and every gate passed. Gates run in registration order and names are unique
   (a duplicate throws).
3. **Effect ops (`pipeline.ops.register(name, handler)`)** and **delivery kinds
   (`pipeline.deliveries.register(kind, handler)`)** are the only way to add capability. A name the
   spell schema does not know, or one already registered, throws. Handlers get a context (world, caster,
   target, point, delivery) and never the spell's id.
4. **A delivery may be `pending`.** Its handler returns `{kind: 'pending'}`; the `magic.delivery` entity
   stays alive, and whichever system owns it (projectile, beam) later calls `pipeline.land(world,
   delivery, hits)` or `pipeline.cancel(world, delivery)`. The pipeline resolves effects only in those
   calls.
5. **`source: 'free'` casts skip the known-spell check, every gate and every cost.** This is what a
   scroll is, for any class (owner decision, 2026-10-24: scroll casts are free). Learning is
   `learnSpell` / the `magic.known` component.

**Validation order** (all failures are a `SpellFizzled` at stage `validate`, with nothing spent): unknown
spell, unknown caster, not learned (known source only), gates (known source only), unregistered delivery
(`unsupported-delivery`), unregistered op (`unsupported-op`). A delivery that cannot reach anything
fizzles at stage `deliver`, also with nothing spent. After delivery starts: gates `spend`, `SpellCast`,
then for each hit `SpellHit` and one `SpellEffectApplied` per op that took effect.

**Rules for extenders.** Put a resource or restriction in a gate, a new effect in an op, a new way to
reach targets in a delivery. Do not add resource logic to `pipeline.ts`. State a gate needs is its own
component, registered by its own `install…` function, which also registers the gate and any system. The
reasons a gate returns are stable strings that tests and the HUD match on.

## Context

- `mw-e06.2` made spells data (`src/content`) run by a pipeline. Seven more beads build on it: mana
  (`mw-e06.3`), cast times, channeling and cooldowns (`mw-e06.4`), projectile and beam delivery
  (`mw-e06.6`), the remaining ops, statuses (`mw-e06.9`), miscasts (`mw-e06.13`) and scroll items
  (`mw-e07.2`). Several are built in parallel. If each edited `pipeline.ts`, they would conflict and the
  "one path for every spell" property (`CONSTITUTION.md`, magic pillar) would erode.
- Contract §2 requires rules in `src/sim` to be deterministic and property-based, never pairwise scripted;
  §3 requires 100 % sim coverage, and sim tests may not load content at runtime.
- Costs must not be charged for casts that never start (a fizzled delivery), which is why `check` and
  `spend` are separate hooks.

## Options considered

| Option | Summary | Result |
|---|---|---|
| **Gates, registries, pending deliveries** | Small interfaces in the pipeline; each bead adds a module that registers into them. | **Chosen** |
| Mana, cooldown and cast-time fields inside `cast()` | Simplest first patch. | **Rejected**: every later bead edits the same function; resource rules mix with delivery |
| Event-driven veto (listeners cancel a `CastRequested` event) | Decoupled. | **Rejected**: event order decides outcomes; refusals and charges would not be atomic |
| Free casts as a gate that always passes | Scrolls handled by a "scroll" gate. | **Rejected**: every future gate would have to remember the exception; skipping all gates in one place cannot be forgotten |
| Per-spell scripts for odd spells | Escape hatch for special cases. | **Rejected**: the pillar forbids it; an odd spell is a new op or delivery |

## Evidence

- `src/sim/magic/magic.test.ts` and `tests/integration/spell-pipeline-content.test.ts` cover the
  validation order, pending/land/cancel, free casts, and that no pipeline source names a spell id.
- Worked example, mana (`mw-e06.3`, `src/sim/magic/mana.ts`): the whole feature is a component
  (`magic.mana`), a regen system, and `manaGate()`, registered by `installMana(world, pipeline)`.
  `pipeline.ts` was not touched for it beyond a comment. See below.
- Not tested: gates that depend on each other's state (cooldown and mana together) and a gate whose
  `spend` throws. A throwing `spend` would leave earlier gates charged; gates must make `spend` total.

### Worked example: the mana gate

| Part | Behaviour |
|---|---|
| `check` | Cost 0 passes without a pool. No pool: `no-mana-pool`. Available (current − reserved) below the cost: `insufficient-mana`, unless the spell has `flags.allowOvercast`. |
| `spend` | Takes the cost, or what is available for an over-cast, and restarts the regen pause. An over-cast also emits `MiscastRequested{deficit, severity = deficit / cost}` for `mw-e06.13`. |
| System | Regen after `regenDelayTicks` at `regenPerSecond`, in 1/6000-point quanta like stamina so 5/s is exact. |
| Events | `ManaChanged{entity, current, max, delta, reason}` for the HUD on every change. |
| Numbers | Sorcerer profile: 100 max, 5/s, 90 ticks (1.5 s) delay, 50 % interrupt refund (ADR-0004: other classes start at 20-30; max grows by +10 shrine steps, rates never grow). |

## Consequences

- `mw-e06.4` adds a cooldown gate and cast-phase state in its own module; `mw-e06.6` registers
  projectile and beam deliveries and calls `land` / `cancel`; `mw-e06.13` listens for
  `MiscastRequested`; `mw-e07.2` casts scrolls with `source: 'free'`.
- A scroll is never gated: a silence or cooldown mechanic that must stop scrolls needs a new ADR.
- Cast-phase refunds use `refundInterrupted`; whether the cost is spent at release or reserved at
  wind-up is `mw-e06.4`'s call, and the mana module supports both (`reserveMana` / `releaseMana`).
- Costs we accept: gate order is registration order, so setup code decides it; a gate cannot see the
  other gates' pending charges.

## Revisit triggers

- A bead needs a gate to run on `free` casts, or to run after effects land.
- Two gates need to agree on a combined price (for example, a mana discount from a cooldown state).
- A third pipeline stage (for example, between delivery start and `SpellCast`) is requested by a
  second bead.
