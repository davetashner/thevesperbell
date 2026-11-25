# prop-river-kestrel-lock-set-01

**Status: approved concept** (v1, 2026-11-25; Claude, delegated by owner 2026-11-07). Generation replaces the CC0 kit route of `mw-e37.193`/`mw-e37.194` for these pieces, as the harbour did on 2026-11-16 (bead `mw-e37.434`).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `prop-river-kestrel-lock-set-01` |
| Category | prop |
| Consuming bead(s) | `mw-e37.434` → `model-prop-lock-gate-01`, `model-prop-lock-paddle-gear-01`, `model-prop-lock-toll-board-01`, `model-prop-lock-cottage-01`, `model-prop-lock-coping-stack-01` (the windlass, prop 3, is not modelled yet) |
| Template | `_templates/prop-sheet.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 3:2, plan plus, 2026-11-25, job `a04cbbd3-73fd-4709-bafd-8495661a8455` |
| Reference inputs | approved style anchors `prop-marsh-store-set-01` (media `13347870-e15e-4ec9-936c-465b447fc295`) and `prop-harbour-cask-set-01` (job `a96511e4-7938-4204-b3c9-6b7f08462886`) |
| Output | `assets/source/prop/prop-river-kestrel-lock-set-01/prop-river-kestrel-lock-set-01.png` (SHA-256 `3b6a6eb4595ef7d2d7aaaa9ce28995ecc18a3c301edb038e3b40116161c9a53d`) |

## 2. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: Kestrel Lock, a 250-year-old barony river lock halfway down the River Wend.
PROPS (left to right, top to bottom): 1. one heavy timber lock gate leaf: tall planked oak door bound with iron straps, a long squared balance beam projecting from its top, a narrow plank walkway with a single iron handrail along the top edge; 2. a lock paddle gear: a squat iron-and-timber post with a toothed rack, a ratchet and a square spindle, with worn brass wear on the turning handle; 3. a separate lock windlass: an L-shaped iron crank handle with a worn brass grip, lying on its own; 4. the lock-keeper's toll board: a flaking painted timber board on two posts under a small shingled roof, the painted panel blank and weathered (absolutely no writing); 5. a small stone lock-keeper's cottage: one storey, dressed glenstone walls, a mossy slate roof with a crooked chimney, one warm amber-lit window, a timber door with brass pull-ring, a rain barrel; 6. a short stack of four squared glenstone coping blocks for a lock chamber wall edge, pale worn top-bevel along the climbable edge.
River palette: salt-grey glenstone #9C9788, wet stone #7E8584, tarred plank #2F2A28, river green #5E7A6A, sail canvas #E6D9BC, rope tan #B08A58, worked oak #8A6440, bark #5A3E2B, iron ink-violet #1E1B2E, brass wear #C9A042.
SYSTEMIC CUES (style bible §7): interactables carry worn brass wear on handles; climbable edges carry pale worn top-bevel #D9C38A; all rope is tan hemp.
SHAPE: chunky, bevelled, heavy proportions; big–medium–small; readable at 10 m; each prop separate with generous spacing, no overlapping.
SCALE REFERENCE: include a small 1.8 m human outline at the edge.
REFERENCE IMAGES: the attached painted images are approved in-game style anchors: match their brushwork, bevel size, lighting and palette.
```

## 3. Output spec

3:2, 2k flat concept on parchment for the image-to-3D flow; small props 50–400 tris, medium 400–2 k, large 2–5 k (LOD1 50 %), one material per model (style bible §13.2).

## 4. Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | every prop present and separate, no lettering (toll board blank), brass wear on handles, tan hemp rope, palette on river tokens |

## 5. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-25 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/prop-river-kestrel-lock-set-01/v1.png` | approved |
