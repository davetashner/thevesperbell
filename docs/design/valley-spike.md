# Valley spike: backdrop layers and tight-path terrain (mw-ju8.1)

Question: can the "grand feel" (owner decision) come from a tight walkable path plus painted
backdrop layers, within the High and Low budgets (style bible §13, contract §1), or does it need
heightfield terrain?

## What was built

Three grey-box outdoor scenes from the e00 kit only (`src/content/data/scene/valley-0N.json`):

| Scene | Content | Backdrop (placeholder, unapproved) |
|---|---|---|
| `valley-01` | 3 m path between 4 m rock walls, dog-leg, two boulders; about 52 m start to end | `far-mountains-castle.png`, follow 1 |
| `valley-02` | 46 m forest-ish lane, 19 trunks (pillars), rail on the river side, river 3 m lower | `mid-forest-river.png`, follow 0.9 |
| `valley-03` | approach, fenced 16 x 18 m overlook, stone bridge over a river, far bank towards the village | `far-mountains-castle.png` (stand-in; `overlook-concept.png` is a concept, not used) |

The river in valley-02 and valley-03 is a tagged region (`regions[]`, tag `water`). Since mw-e02.14
the player wades, swims and sinks in it (src/sim/character/water.ts): valley-02's river is a 1 m
ford (bed at -3 m, surface at -2 m), valley-03's is 4 m deep (bed -6 m, surface -2 m) with a ramp
up each bank (x = +-6.5, from the south wall to the near bank) so anyone who falls off the Miners'
Bridge, even a character in plate that sinks, can walk or swim out. Area transitions (mw-e01.11)
join the scenes; they can also be reached with `?scene=`.

New data: scene `environment` (`sky`, `fog`, `backdrop`) and `regions` (schema, generated docs
`docs/content/scene-schema.md`). New renderer module `src/render/environment/index.ts`.

## How a backdrop is authored

- One painted image (the current ones are 1344 x 752) on an open cylinder arc `radius` m from the
  camera (default 150, camera far plane is 200), centred on `bearing` (0 = +z, 90 = +x), spanning
  `arc` degrees. Height follows the image aspect ratio, so the image is never stretched. `centreY` sets
  where the image centre sits in world height: tune it so the painted horizon meets the
  level's horizon.
- Unlit `MeshBasicMaterial`, no fog, no depth test or write, `renderOrder` -1000, so it is drawn
  first and the level covers it. One draw call, 64 triangles, one texture.
- It follows the camera in x/z by `follow`. 1 never parallaxes (true infinity); 0.9 slides slightly so
  a mid layer reads as nearer. Several layers (far, mid) would be several cards with different
  `follow` and radius; the schema holds one per scene for now.
- Fog (`environment.fog`) blends the level into the vista; pick the fog colour from the image's
  haze colour. The sky colour is the flat fallback.
- Loading: images stay in `assets/_incoming/` (gitignored, owner approval pending). Vite dev serves
  them at `/assets/_incoming/...`. Production builds do not load backdrops at all (`import.meta.env.DEV`
  gate), so a missing file can never log a console error in the e2e; in dev a failing load logs one
  info line and the flat sky stays. Once approved, move the image to the shipped assets folder and
  drop the gate.

Seam and tiling caveat: the card is one non-tiled image over a partial arc (about 110 degrees), so
there is no seam to hide, but there are two limits. First, it is a fixed vista: looking away from
`bearing` shows the flat sky colour (add cards or use a 360 degree equirect/cube per style bible §13.3
if scenes need all-round views). Second, the image's left and right edges are not painted to meet,
so a 360 degree wrap would show a hard seam; wrapping needs a purpose-painted seamless panorama.
At 150 m the painted detail is magnified (about 1.1 px/cm at 1440p); it reads as a painting, which is
the intent, but it cannot hold close parallax.

## Measurements

Dev server (Vite), headless Chromium on software GL (SwiftShader) on a Mac, via `?perf` (120 frames,
2 s warm-up). High = 1280 x 720 at DPR 2 (2560 x 1440 buffer), Low = 1920 x 1080 at DPR 1. There is
no quality-tier switch in the renderer yet, so Low differs only by resolution (shadow map stays
2048). **Frame times are software-rasterised and not indicative of the M1 Pro or Iris Xe; the
reference-mode run (`pnpm perf:ref`, headed Chrome on the reference machine) still has to be done by
the owner for AC-1.** Draw calls and triangles are renderer-reported and hardware independent.

| Scene | Preset | Frame p50 / p95 (ms, software GL) | Draw calls | Triangles |
|---|---|---|---|---|
| valley-01 | High | 105.9 / 113.3 | 21 | 24,778 |
| valley-01 | Low | 63.7 / 68.3 | 21 | 24,778 |
| valley-02 | High | 104.3 / 109.2 | 21 | 25,066 |
| valley-02 | Low | 63.5 / 69.7 | 21 | 25,066 |
| valley-03 | High | 129.5 / 133.6 | 21 | 25,018 |
| valley-03 | Low | 77.1 / 81.7 | 21 | 25,018 |
| perf-baseline (reference) | High | 93.9 / 100.7 | 167 | 2,360 |
| perf-baseline (reference) | Low | 56.3 / 60.7 | 167 | 2,382 |

CPU time per frame (sim plus render submission) is 1.2 to 1.5 ms p50 in the valleys. Draw calls
(including the knight, HUD-free) are about 8 to 14 percent of the High budget (250) and 14 percent of
Low (150); triangles about 2 percent of High (1.2 M) and 5 percent of Low (500 k). The software-GL
frame time tracks pixel count (Low at 2.1 MP is faster than High at 3.7 MP) and shadow/fill work, not
geometry, and the valleys are within about 10 to 40 percent of the perf-baseline scene, whose
fill cost is the same. The backdrop adds one draw call and one 1344 x 752 texture (about 4 MB
resident uncompressed; KTX2 would be about 1 MB).

### Reference machine (mw-ju8.2)

`pnpm perf:ref` on the M1 Pro (Chrome 156, headed, uncapped, 1,800 frames after a 3 s warm-up), p50 / p95 / p99 in ms,
production build (no backdrop card):

| Scene | High (2560 x 1440) | Low (1920 x 1080, `?quality=low`) |
|---|---|---|
| valley-01 | 2.4 / 3.2 / 3.9 | 1.6 / 2.8 / 3.2 |
| valley-02 | 2.4 / 3.4 / 3.9 | 1.6 / 2.9 / 3.2 |
| valley-03 | 2.5 / 3.2 / 3.8 | 1.8 / 2.8 / 3.2 |

Low changes only the buffer size (and the magic materials' heat haze, which the valleys do not use); it is
not measured on the integrated-GPU class the contract names. The dev build with the backdrop card and its skirt
gives the same numbers within 0.1 ms.

The backdrop's bottom edge used to leave a band of flat sky colour between the painted ground and the floor
whenever the camera looked down past the floor's far edge; a skirt hung from the card's bottom edge now
stretches the image's last row downwards (`src/render/environment/index.ts`).

## Recommendation

Use **kit pieces plus backdrop cards** for the walkable valley, not a heightfield, for the first
areas.

- Geometry cost is negligible: all three scenes are about 25 k triangles and 21 draw calls, so the
  budgets are bound by fill rate (shadows, resolution), not by the level or the backdrop. A
  heightfield would add triangles and a new collider path for little gain on a 3 m path.
- Tight paths hide the lack of terrain: the walls and trunks that make the path tight also hide the
  seams between backdrop and level. Where the camera sees past the edge (overlooks), the backdrop plus
  fog carry the depth.
- Build for a heightfield only where the player must walk slopes wider than the kit's ramps allow
  (open meadows). That is a separate decision and bead; this spike gives no evidence for needing it.

Follow-ups for owners: approve or replace the placeholder images (the overlook image for valley-03 and
a panorama if all-round views are wanted); confirm the Low preset (shadow size, DPR) when a quality
switch exists; run `pnpm perf:ref` on the M1 Pro against `?scene=valley-01..03`.

AC-1b (village, mountains and castle as a continuous vista) and the reference-hardware figures for
AC-1 are manual and not verified here; the greybox renders and the backdrop appears in dev.

## Viewing

`pnpm dev`, then `/?scene=valley-01`, `/?scene=valley-02`, `/?scene=valley-03`. Click to play.
