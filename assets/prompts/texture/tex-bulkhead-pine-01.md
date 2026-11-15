# tex-bulkhead-pine-01

**Status: generated v1, awaiting owner approval** (2026-11-15). Made from the owner's dock and ship reference photos.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `tex-bulkhead-pine-01` |
| Category | texture |
| Consuming bead(s) | `e37-asset-ship-gilded-tern-*` (`model-ship-gilded-tern-interior-01` bulkheads and berth walls), `e40-gilded-tern`; also harbour interiors (`e40-bonded-warehouse` partitions) |
| Template | `_templates/tileable-texture.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, resolution 2k, aspect 1:1, account plan "plus" |
| Higgsfield job | `e5858355-4d43-4580-b857-e3f7f90b20ce` |
| Staging copy | `assets/_incoming/tex-bulkhead-pine-01/v1.png` (gitignored) |

### Reference inputs

- Owner's reference photo IMG_5575 — pine plank bulkhead with rows of black nail-heads (cropped right edge) (Higgsfield media `4fcacb4e-e595-4c70-befc-d9d093dd27e9`); used for form and construction only, people cropped out
- Owner's reference photo IMG_5572 — between-decks: mast trunks, rope-wrapped mast, chests, kegs (cropped to the right half) (Higgsfield media `da9bdb29-3715-4cbd-a981-fdb2ccf4e514`); used for form and construction only, people cropped out
- `assets/source/prop/prop-marsh-store-set-01/prop-marsh-store-set-01.png` — approved style anchor (Higgsfield media `13347870-e15e-4ec9-936c-465b447fc295`)

The owner supplied the photos as reference for this set (2026-11-15). They are used only as reference inputs for form and construction: they are never shipped and never pasted into an asset.

## 2. Brief

Honey-pine plank bulkhead with rows of black forged nail-heads, from the berth-wall photo. Wall surface for the Tern’s interior and harbour partitions. New id (not in `plan/assets-harbor.json`).

## 3. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Seamless tileable texture, perfectly repeating on all four edges, top-down orthographic, flat even lighting with no directional shadows or highlights, no perspective, low contrast at the edges, no single standout feature, hand-painted stylized surface.

MATERIAL: an interior wall of horizontal pine planks stacked edge to edge, with thin dark seams between boards and vertical rows of square black forged nail-heads where the boards are fixed to hidden studs.
REAL-WORLD SCALE: one tile = 2 m × 2 m; boards about 20–25 cm tall; a nail row every 1 m (two rows per tile, evenly spaced, so it tiles cleanly).
COLOURS: honey-gold pine (#C9A06A to #8A6440) with soft painted bands of warmer grain; seams bark #5A3E2B; nail-heads ink-violet #1E1B2E.
SURFACE CHARACTER: broad painted shapes, gentle wavy grain bands painted with wide soft strokes, softly rounded board edges, shallow painted ambient occlusion only in the seams.
WEAR: light handling smudges, very faint scuffs; no knot or stain big enough to become a focal point.
REFERENCE IMAGES: the attached photographs show real construction to borrow — shapes, proportions, joinery, hardware and how things are used. Reinterpret them completely in the painted style above: never copy photographic texture, lighting, noise or framing, and leave out anything modern. The attached painted image is an approved in-game style anchor: match its brushwork, bevel size, lighting and palette.
```

## 4. Output spec

| Property | Value |
|---|---|
| Aspect / size | 1:1, 2k (2048²) |
| Background | n/a (full-bleed surface) |
| Format | PNG |
| Downstream | downsample to 1024²/512² KTX2 ETC1S with mips; seamless on both axes; vertex-colour blend variant (style bible §6.3). The generator does not guarantee a seamless tile: an offset-and-repair pass is needed before integration. |

## 5. Consistency checklist (Claude self-check of v1; owner confirms at the gate)

Preamble verbatim, palette, no text/logos, lighting and shape language checked by Claude on v1; per-asset notes in §7. Owner approval pending.

## 6. Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | pending | owner | — | — |

## 7. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/tex-bulkhead-pine-01/v1.png` | candidate — Tiles cleanly in a 2×2 check; boards and nail rows are regular. Rendered as four nail columns per tile (prompt asked for two) and the pine is more orange/saturated than the photo — may want a desaturation pass toward #C9A06A. |

## 8. Provenance (copy into `assets/CREDITS.md` when approved)

| Asset id | Tool / model | Tier | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|
| `tex-bulkhead-pine-01` | generated:higgsfield/gpt_image_2_6 | Higgsfield plus (quality high, 2k) | 2026-11-15 | GEN-OWNED — Higgsfield Terms of Use §4.4 (see the door-wood-01 row in CREDITS.md). https://higgsfield.ai/terms-of-use-agreement | this file |
