# Spell VFX hooks (magic group)

Every spell looks good from day one by naming **templates** for the standard **slots**, plus an
optional tint and scale. There is no VFX code per spell. Bespoke art later replaces a template's
effects (a file drop), never the spell. (mw-e29.10)

Field reference for templates: [`docs/content/spell-vfx-template-schema.md`](../content/spell-vfx-template-schema.md).
Field reference for the spell's `vfx` block: [`docs/content/spell-schema.md`](../content/spell-schema.md).

## The block

An optional `vfx` object on a `spell` (`src/content/data/spell/<id>.json`). Each key is a slot; each
value names the template to use and may override its tint and scale. A slot the spell leaves out is
**skipped when cast**, without error.

```json
"vfx": {
  "castWindup":  { "template": "svt-windup-gather", "tint": "#FF7A1A" },
  "projectile":  { "template": "svt-projectile-bolt", "tint": "#FF7A1A" },
  "impact":      { "template": "svt-impact-burst", "tint": "#FF7A1A", "scale": 1.3 },
  "area":        { "template": "svt-area-rune-ring", "tint": "#FF7A1A" }
}
```

`vfxCue` (the single cue id every spell already carries) stays: it is the spell's headline cue for
the cue sheets and the audio bible. The `vfx` block is the richer per-slot form.

A template must fill the slot it is put in: a ring template in `beam` fails the content load
(`checkSpellVfx`), naming the spell, the slot and the template.

## Slots

| Slot              | Plays on / at                               | Draws                                                          | Template params (data)                          |
| ----------------- | ------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| `castWindup`      | the caster (socket) while the spell charges | looping particle effect; stop it on release or cancel          | `effect`                                        |
| `castRelease`     | the caster, the moment the spell leaves     | one-shot particle effect                                       | `effect`                                        |
| `projectile`      | the projectile entity, whole flight         | `head` (looping effect) and optional `trail` (looping effect)  | `head`, `trail?`                                |
| `impact`          | the hit point, turned to the surface normal | one-shot particle effect                                       | `effect`                                        |
| `area`            | the area centre, flat on the ground         | the magical-material rune ring, **edge exactly at the spell radius**, growing out over `growSeconds`, plus optional motes spread over the radius | `ring` (`intensity`, `spin`, `growSeconds`, `pulseHz`), `effect?` |
| `beam`            | caster socket to end point/entity           | a streaming strip, start re-read from the cast socket **every frame**, plus an optional end flare | `beam` (`width`, `alpha`, `scrollSpeed`, `pulseHz`), `endEffect?` |
| `sustainOnTarget` | the target, while a status or channel holds | looping particle effect                                        | `effect`                                        |
| `summon`          | where a summoned thing arrives or leaves    | particle effect, and `dissolveSeconds` for the body's dissolve | `effect`, `dissolveSeconds`                     |

Every template also has a default `tint` (`#RRGGBB`) and `scale` (0.1 to 10). Particle slots scale
particle size, launch speed and spawn radius; the area ring is sized by the radius you pass when
casting (its motes by radius times scale); the beam's `width` is multiplied by scale.

Pulses are capped at 2 Hz (the magical materials' `MAX_MAGIC_PULSE_HZ`, under the 3 Hz
photosensitivity limit) and are steady in reduced motion; a ring appears at full radius at once in
reduced motion.

## Tint

Template effects are authored in neutral light greys. A tint recolours them keeping brightness: a
light grey becomes the tint at full strength, darker stops stay darker, white stays white-hot (so
cores still read as the brightest part). Tinting makes a derived copy of the effect once when the
block is resolved (id `vfx-…~rrggbb`), so it costs nothing at cast time.

## The built-in templates

| Template                  | Slot            | Look                                                          |
| ------------------------- | --------------- | ------------------------------------------------------------- |
| `svt-windup-gather`       | castWindup      | motes gather and drift up around the caster                   |
| `svt-release-burst`       | castRelease     | ring flash and spray of sparks                                |
| `svt-projectile-bolt`     | projectile      | bright flickering head, sparks, fading glow trail             |
| `svt-projectile-head-only`| projectile      | the same head without a trail, smaller                        |
| `svt-impact-burst`        | impact          | ring flash, puff of glow, shards                              |
| `svt-area-rune-ring`      | area            | rune ring (Hornfolk meander) with rising motes                |
| `svt-beam-stream`         | beam            | streaming strip with an end flare                             |
| `svt-sustain-aura`        | sustainOnTarget | motes orbit up around the target                              |
| `svt-summon-swirl`        | summon          | ring pulse and a column of motes; body dissolves over 1.2 s   |

They are built from existing base textures (`vfx-base-soft-circle-01`, `-ring-01`, `-shard-01`,
`-spark-streak-01`) and the magical material library; no new art. Add a template by adding a JSON
file under `src/content/data/spell-vfx-template/` (and, if it needs a new look, a `vfx-effect`).

## Casting (for the spell pipeline, e06.17)

```ts
const library = new SpellVfxLibrary(content.all('spell-vfx-template'), content.all('vfx-effect'));
const resolved = library.resolve(spell.vfx);       // before the VfxSystem is built: see below
const player = new SpellVfxPlayer({ vfx, anchors, surfaces: spellVfxView });

player.castWindup(resolved, { entity: caster, socket: 'hand-r' })?.stop();  // on release
player.projectile(resolved, { entity: bolt });                              // whole flight
player.impact(resolved, hitPoint, hitNormal);
player.area(resolved, centre, spell.delivery.shape.radius);
const beam = player.beam(resolved, { entity: caster, socket: 'hand-r' }, { entity: target });
beam?.stop();
```

Each call returns a handle to stop, or `undefined` when the spell does not use that slot.

Wiring (done in `src/main.ts`): resolve every spell's block **before** building the `VfxSystem` and
add `library.derivedEffects()` to its effects, so the tinted effects exist. Call
`spellPlayer.update()` once a frame (it visits only live beams) and `spellView.update(dt)` when
`spellView.active`.

Code: `src/game/spell-vfx/` (library, tint, player, ring growth), `src/render/spell-vfx/` (ring and
beam drawing), `src/content/types/spell-vfx.ts` (schemas).

## Performance

Event-driven except beams. Per frame with no beam alive: nothing. Per live beam: two anchor reads,
one quaternion and one scale write, no allocation. Rings: one `scale` write each while alive. A beam
or ring is one draw call (a beam is two crossed quads sharing one material; the ring is the shared
rune decal material per ring). Particle effects use the existing VFX budget (priority 40 to 60).
The derived tinted effects add nothing unless a spell (or the demo) uses them.

## Testbed

`?scene=testbed&spells=demo` shows every slot in cast order (arcane defaults, then an orange tint),
one every 3.2 s, on stand-ins (a caster, a target, a summoned body) in front of the player. The
area is centred on the player's feet at radius 4 m; the caster walks while the beam is up so its
start is seen following the socket. `?spells=<slot>` (for example `?spells=area`, `?spells=beam`)
shows one slot. Off by default; the shared testbed scene is untouched. The demo spells are in
`src/tools/spell-vfx-demo/demo-spells.json`. `#app[data-spell-vfx]` publishes what is drawn (e2e).

## Not here

Which sim event plays which slot (e06.17), spell numbers and effects (e06), and bespoke or signature
spell art (asset groups: swap a template's effects).
