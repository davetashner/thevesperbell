# prop-harbour-cask-set-01

**Status: generated v1, awaiting owner approval** (2026-11-15). Made from the owner's dock and ship reference photos.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `prop-harbour-cask-set-01` |
| Category | prop |
| Consuming bead(s) | `e37-asset-props-harbour-waterfront-kit-*` (`model-prop-crate-stack-01`, `model-prop-smuggler-crate-01` dressing), `e40-stone-wharf`, `e40-gilded-tern` hold dressing |
| Template | `_templates/prop-sheet.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, resolution 2k, aspect 3:2, account plan "plus" |
| Higgsfield job | `a96511e4-7938-4204-b3c9-6b7f08462886` |
| Staging copy | `assets/_incoming/prop-harbour-cask-set-01/v1.png` (gitignored) |

### Reference inputs

- Owner's reference photo IMG_5582 — weathered and honey-oak barrels with rope-coiled lids on a grey plank dock (Higgsfield media `f03966df-9654-4c36-b73c-0421e5be7aa6`); used for form and construction only, people cropped out
- `assets/source/prop/prop-marsh-store-set-01/prop-marsh-store-set-01.png` — approved style anchor (Higgsfield media `13347870-e15e-4ec9-936c-465b447fc295`)

The owner supplied the photos as reference for this set (2026-11-15). They are used only as reference inputs for form and construction: they are never shipped and never pasted into an asset.

## 2. Brief

Casks and kegs for the Stone Wharf, the Undertow and the Gilded Tern hold. Two finishes from the reference photo: sea-weathered silver-grey oak and honey-brown oak, both with heavy dark hoops. Systemic: the oil barrel is flammable (drip marks), the light barrel is breakable (pale wood, nail-heads), the rope-coiled lid is tan hemp (flammable). The sturdy casks are neither breakable nor climbable and carry no cue.

## 3. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: Wendmouth waterfront casks and kegs. Wendmouth palette: salt-grey glenstone #9C9788, harbour stone #7E8584, tarred plank #2F2A28, sea grey-green #5E7A7A, sail canvas #E6D9BC, net tan #B08A58; worked wood #8A6440 and bark #5A3E2B; iron in ink-violet #1E1B2E.
PROPS (left to right, top to bottom): 1. a tall sea-weathered silver-grey oak barrel with six thick dark iron hoops and a flat spiral coil of tan hemp rope laid on its lid; 2. the same weathered barrel with a plain lid and a wooden bung; 3. a honey-brown oak cask with dark hoops lying on its side in a simple two-piece timber cradle; 4. a squat honey-brown keg with a round wooden bung plug in its belly; 5. a small honey-brown keg resting slightly off-centre on top of a larger cask; 6. an oil barrel with darker staves and glossy oil drip marks running down from the bung; 7. a light breakable barrel with thinner pale staves and visible nail-heads, one stave cracked, still standing intact.
SYSTEMIC CUES: rope on prop 1 is tan hemp (flammable); prop 6 is flammable — glossy oil #3B2F1E drips and stains; prop 7 is breakable — pale wood #B98B5E, thin staves, visible nail-heads, a cracked stave; props 1–5 are sturdy — no pale wood, no cracks, no nail-heads.
SHAPE: chunky, bevelled, gently bulging staves with readable plank lines, thick hoops, a slight lean; big–medium–small; readable at 10 m.
SCALE REFERENCE: include a small 1.8 m human outline at the edge.
REFERENCE IMAGES: the attached photographs show real construction to borrow — shapes, proportions, joinery, hardware and how things are used. Reinterpret them completely in the painted style above: never copy photographic texture, lighting, noise or framing, and leave out anything modern. The attached painted image is an approved in-game style anchor: match its brushwork, bevel size, lighting and palette.
```

## 4. Output spec

| Property | Value |
|---|---|
| Aspect / size | 3:2, 2k (about 2048×1365) |
| Background | flat parchment |
| Format | PNG |
| Downstream | small 50–400 tris, medium 400–2 k (casks, chests), large 2–5 k (hutch); one shared prop atlas, one material per set (style bible §13.2). Flat concept for the image-to-3D flow after the owner approves it (§17.2). |

## 5. Consistency checklist (Claude self-check of v1; owner confirms at the gate)

Preamble verbatim, palette, no text/logos, lighting and shape language checked by Claude on v1; per-asset notes in §7. Owner approval pending.

## 6. Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | pending | owner | — | — |

## 7. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/prop-harbour-cask-set-01/v1.png` | candidate — All 7 casks present; weathered-grey and honey-oak finishes read clearly; oil drips on #6; #7 has nail-heads and a cracked stave but its staves are only slightly paler than the sturdy casks (pale-wood cue could be stronger). Scale figure is a full character, not an outline. |

## 8. Provenance (copy into `assets/CREDITS.md` when approved)

| Asset id | Tool / model | Tier | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|
| `prop-harbour-cask-set-01` | generated:higgsfield/gpt_image_2_6 | Higgsfield plus (quality high, 2k) | 2026-11-15 | GEN-OWNED — Higgsfield Terms of Use §4.4 (see the door-wood-01 row in CREDITS.md). https://higgsfield.ai/terms-of-use-agreement | this file |
