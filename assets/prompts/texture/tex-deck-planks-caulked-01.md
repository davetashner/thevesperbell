# tex-deck-planks-caulked-01

**Status: owner-approved concept** (2026-11-15, "They all look great!"). Made from the owner's dock and ship reference photos.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `tex-deck-planks-caulked-01` |
| Category | texture |
| Consuming bead(s) | `e37-asset-ship-gilded-tern-*` (`model-ship-gilded-tern-hull-01` deck), `e40-gilded-tern`; candidate for `e37-asset-barge-patient-ann-*` deck |
| Template | `_templates/tileable-texture.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, resolution 2k, aspect 1:1, account plan "plus" |
| Higgsfield job | `d6f8a400-7ded-48f2-8969-b1ae2b39a625` |
| Output | `assets/source/texture/tex-deck-planks-caulked-01/tex-deck-planks-caulked-01.png` (SHA-256 `d2b4bd47acf9c59e9118aaa43b57f09a4e59d9008717c5174e3a34cfc435c53a`) |
| Staging copy | `assets/_incoming/tex-deck-planks-caulked-01/v1.png` (gitignored) |

### Reference inputs

- Owner's reference photo IMG_5578 — deck grating, rudder head and tiller, caulked deck, bulwark cleats (Higgsfield media `4913f70d-3a82-4009-85a9-a38f213a90f4`); used for form and construction only, people cropped out
- Owner's reference photo IMG_5581 — quarterdeck: tiller, companionway hutch, pin rails, caulked deck, masts (Higgsfield media `2cb278fd-dac4-4b02-8453-0fb89facfb8d`); used for form and construction only, people cropped out
- `assets/source/concept/concept-wendmouth-stone-wharf-probe-01/concept-wendmouth-stone-wharf-probe-01.png` — approved style anchor (Higgsfield media `8c809b35-0b79-46df-8732-5cde83abc6ce`)

The owner supplied the photos as reference for this set (2026-11-15). They are used only as reference inputs for form and construction: they are never shipped and never pasted into an asset.

## 2. Brief

Ship deck planking with dark caulked seams and round bung plugs over the fastenings, from the Tern deck photos. New id (not in `plan/assets-harbor.json`); proposed for the Gilded Tern hull atlas.

## 3. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Seamless tileable texture, perfectly repeating on all four edges, top-down orthographic, flat even lighting with no directional shadows or highlights, no perspective, low contrast at the edges, no single standout feature, hand-painted stylized surface.

MATERIAL: ship's deck of narrow straight planks running vertically and parallel, separated by thin dark caulked seams, with staggered butt joints and small round wooden bung plugs over the fastenings in neat pairs.
REAL-WORLD SCALE: one tile = 2 m × 2 m; planks about 12–15 cm wide.
COLOURS: pale weathered grey planks #A89A84 toward #9C9788 with subtle warm variation; caulked seams ink-violet #1E1B2E (never pure black); bung plugs a touch lighter than the planks.
SURFACE CHARACTER: broad painted shapes, soft value variation plank to plank, crisp straight seams, gently rounded plank edges, painted grain as a few long soft strokes.
WEAR: light scrubbed-holystone wear, faint salt bloom; no standout stain or knot.
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

Preamble verbatim, palette, no text/logos, lighting and shape language checked by Claude on v1; per-asset notes in §7. Owner approved v1 on 2026-11-15.

## 6. Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | approved | owner | 2026-11-15 | "They all look great!" (session chat; `assets/approvals.json` does not exist yet) |

## 7. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/tex-deck-planks-caulked-01/v1.png` | approved — Tiles cleanly in a 2×2 check; dark seams and paired bung plugs read well. Tone is fine for a scrubbed deck. |

## 8. Provenance (recorded in `assets/CREDITS.md`)

| Asset id | Tool / model | Tier | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|
| `tex-deck-planks-caulked-01` | generated:higgsfield/gpt_image_2_6 | Higgsfield plus (quality high, 2k) | 2026-11-15 | GEN-OWNED — Higgsfield Terms of Use §4.4 (see the door-wood-01 row in CREDITS.md). https://higgsfield.ai/terms-of-use-agreement | this file |
