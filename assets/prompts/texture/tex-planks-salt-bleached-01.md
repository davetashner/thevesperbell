# tex-planks-salt-bleached-01

**Status: owner-approved concept** (2026-11-15, "They all look great!"). Made from the owner's dock and ship reference photos.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `tex-planks-salt-bleached-01` |
| Category | texture |
| Consuming bead(s) | `e37-asset-tex-harbour-*` (planned id), `e40-stone-wharf` timber jetties and plank bridges, `e40-rooftops-net-lofts` |
| Template | `_templates/tileable-texture.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, resolution 2k, aspect 1:1, account plan "plus" |
| Higgsfield job | `26cf2a8e-e811-445a-8553-761b2f2a87cd` |
| Output | `assets/source/texture/tex-planks-salt-bleached-01/tex-planks-salt-bleached-01.png` (SHA-256 `b0d651d810e8ac5b28f1a250ff9eb76da04d1e1a2cd4bf07046606eff20934d2`) |
| Staging copy | `assets/_incoming/tex-planks-salt-bleached-01/v1.png` (gitignored) |

### Reference inputs

- Owner's reference photo IMG_5582 — weathered and honey-oak barrels with rope-coiled lids on a grey plank dock (Higgsfield media `f03966df-9654-4c36-b73c-0421e5be7aa6`); used for form and construction only, people cropped out
- `assets/source/concept/concept-wendmouth-stone-wharf-probe-01/concept-wendmouth-stone-wharf-probe-01.png` — approved style anchor (Higgsfield media `8c809b35-0b79-46df-8732-5cde83abc6ce`)

The owner supplied the photos as reference for this set (2026-11-15). They are used only as reference inputs for form and construction: they are never shipped and never pasted into an asset.

## 2. Brief

Sea-weathered wharf decking for timber jetties, gangways and net-loft floors: silver-grey salt-bleached boards with dark gaps, from the dock boards in the barrels photo. Planned id from `e37-asset-tex-harbour-prompts`.

## 3. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Seamless tileable texture, perfectly repeating on all four edges, top-down orthographic, flat even lighting with no directional shadows or highlights, no perspective, low contrast at the edges, no single standout feature, hand-painted stylized surface.

MATERIAL: sea-weathered wharf decking of long straight timber boards laid side by side, running vertically, with staggered butt joints and a few round iron bolt heads.
REAL-WORLD SCALE: one tile = 2 m × 2 m; boards about 15–20 cm wide.
COLOURS: salt-bleached silver-grey #9C9788 boards with soft warm-grey #A89A84 variation; narrow dark gaps between boards in tarred plank #2F2A28; bolt heads ink-violet #1E1B2E.
SURFACE CHARACTER: broad painted shapes, soft value variation along each board, gently rounded worn edges, painted grain as a few long soft strokes, shallow painted ambient occlusion only in the gaps.
WEAR: faint salt bloom, a few pale scuffs; no knot or stain big enough to become a focal point.
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
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/tex-planks-salt-bleached-01/v1.png` | approved — Tiles cleanly in a 2×2 check. A little warmer/browner than the target silver-grey; bolt heads evenly spread, no focal feature. |

## 8. Provenance (recorded in `assets/CREDITS.md`)

| Asset id | Tool / model | Tier | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|
| `tex-planks-salt-bleached-01` | generated:higgsfield/gpt_image_2_6 | Higgsfield plus (quality high, 2k) | 2026-11-15 | GEN-OWNED — Higgsfield Terms of Use §4.4 (see the door-wood-01 row in CREDITS.md). https://higgsfield.ai/terms-of-use-agreement | this file |

## 9. Runtime file and integration (2026-11-15)

| Field | Value |
|---|---|
| Runtime file | `public/assets/texture/tex-planks-salt-bleached-01.webp` — 1024², WebP quality 88 (SHA-256 `d231041d6ead4001beec0f92f342ab551b2b216ffd6fa21f83f1ec185dcbb46f`) |
| Seam repair | Cross-board axis x (boards run vertically): cropped from one real board gap to the next so the wrap lands on a gap. Along-board axis: overlap blend (the extra band past the tile faded into the start). Edge discontinuity checked equal to the interior and a 2×2 tile checked by eye. |
| Format | WebP until the KTX2 import pipeline (`mw-e37.8`) exists, as with `tex-glenstone-quay-wendmouth-probe-01`. |
| Tile | one tile = 2 m × 2 m, laid in world units; boards run along world z. |
| Where it is used | Wendmouth Harbour surface regions `tern-gangway`, `loft-bridge-west`, `loft-bridge-east`, `loft-stair-customs` (`src/content/data/scene/wendmouth-harbour.json`). |
