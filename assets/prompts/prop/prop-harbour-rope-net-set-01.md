# prop-harbour-rope-net-set-01

**Status: owner-approved concept** (2026-11-15, "They all look great!"). Made from the owner's dock and ship reference photos.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `prop-harbour-rope-net-set-01` |
| Category | prop |
| Consuming bead(s) | `e37-asset-props-harbour-waterfront-kit-*` (`model-prop-cargo-net-01`, `model-prop-drying-net-01`), `e40-stone-wharf`, `e40-rooftops-net-lofts`, `e40-gilded-tern` |
| Template | `_templates/prop-sheet.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, resolution 2k, aspect 3:2, account plan "plus" |
| Higgsfield job | `f5ae8a00-dab0-4eba-8a1d-9ca3d25ebdde` |
| Output | `assets/source/prop/prop-harbour-rope-net-set-01/prop-harbour-rope-net-set-01.png` (SHA-256 `17d5461100b1072cda84e0e5faae5871ac69d857f6aa7825f168d434d986de74`) |
| Staging copy | `assets/_incoming/prop-harbour-rope-net-set-01/v1.png` (gitignored) |

### Reference inputs

- Owner's reference photo IMG_5574 — hemp, cotton and tarred rope coils and a net hung on hull frames (cropped right third) (Higgsfield media `cdf7dc61-ccd4-460b-931d-96354afa8533`); used for form and construction only, people cropped out
- Owner's reference photo IMG_5581 — quarterdeck: tiller, companionway hutch, pin rails, caulked deck, masts (Higgsfield media `2cb278fd-dac4-4b02-8453-0fb89facfb8d`); used for form and construction only, people cropped out
- `assets/source/prop/prop-marsh-store-set-01/prop-marsh-store-set-01.png` — approved style anchor (Higgsfield media `13347870-e15e-4ec9-936c-465b447fc295`)

The owner supplied the photos as reference for this set (2026-11-15). They are used only as reference inputs for form and construction: they are never shipped and never pasted into an asset.

## 2. Brief

Rope, coils, pin rails and nets — the harbour’s most important legibility props (style bible §5.4, §7): drying nets hang loose and are never taut; climbable nets are taut, flat and carry pale knotted handholds; a cuttable cargo-net load line wears the red-white band at its cut point. All cargo rope is tan hemp; tarred hawser and pale cotton line are dressing only.

## 3. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: harbour and shipboard rope, coils and nets. Wendmouth palette: salt-grey glenstone #9C9788, harbour stone #7E8584, tarred plank #2F2A28, sea grey-green #5E7A7A, sail canvas #E6D9BC, net tan #B08A58; worked wood #8A6440 and bark #5A3E2B; iron in ink-violet #1E1B2E; mechanism red-white #C8553D / #EFE2C4; climbable handholds #D9C38A.
PROPS (left to right, top to bottom): 1. a flat spiral coil of tan hemp rope lying on the ground; 2. a long hanging coil of tan hemp hung from a wooden belaying pin; 3. a heavy coil of tarred black-brown hawser with a spliced iron thimble eye; 4. a hank of pale canvas-coloured cotton line hung in long loops with a hitch at the top; 5. a short timber pin rail with five turned belaying pins, two of them holding hung coils; 6. a decorative drying net hanging loose in soft swags between two pegs; 7. a climbable cargo net stretched taut, flat and vertical on a timber frame, with pale worn knotted handholds; 8. a crate wrapped in a tan hemp cargo net hanging from an iron hook by a single taut load line that wears a painted red-white ring band at the cut point, the line visibly straining.
SYSTEMIC CUES: tan hemp is flammable (props 1, 2, 7, 8); prop 6 is decorative — loose, sagging, never taut and vertical; prop 7 is climbable — taut, flat, pale worn knotted handholds #D9C38A; prop 8 is a cuttable load — red-white #C8553D/#EFE2C4 ring on the tan rope at the cut point.
SHAPE: chunky, thick readable rope with big twisted strands, soft bevelled coils; big–medium–small; readable at 10 m.
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

Preamble verbatim, palette, no text/logos, lighting and shape language checked by Claude on v1; per-asset notes in §7. Owner approved v1 on 2026-11-15.

## 6. Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | approved | owner | 2026-11-15 | "They all look great!" (session chat; `assets/approvals.json` does not exist yet) |

## 7. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/prop-harbour-rope-net-set-01/v1.png` | approved — Strongest sheet: drying net loose in swags, climbable net taut with pale knots, cargo load line carries the red-white band; tarred hawser and pale cotton line read as dressing. |

## 8. Provenance (recorded in `assets/CREDITS.md`)

| Asset id | Tool / model | Tier | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|
| `prop-harbour-rope-net-set-01` | generated:higgsfield/gpt_image_2_6 | Higgsfield plus (quality high, 2k) | 2026-11-15 | GEN-OWNED — Higgsfield Terms of Use §4.4 (see the door-wood-01 row in CREDITS.md). https://higgsfield.ai/terms-of-use-agreement | this file |
