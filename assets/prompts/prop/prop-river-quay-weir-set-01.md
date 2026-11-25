# prop-river-quay-weir-set-01

**Status: approved concept** (v1, 2026-11-25; Claude, delegated by owner 2026-11-07). Generation replaces the CC0 kit route of `mw-e37.193`/`mw-e37.194` for these pieces, as the harbour did on 2026-11-16 (bead `mw-e37.434`).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `prop-river-quay-weir-set-01` |
| Category | prop |
| Consuming bead(s) | `mw-e37.434` → `model-prop-stone-barge-01`, `model-prop-mooring-bollard-01`, `model-prop-glenstone-cradle-01`, `model-prop-quay-toll-shed-01`, `model-prop-weir-sluice-gate-01`, `model-prop-weir-keystone-01` |
| Template | `_templates/prop-sheet.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 3:2, plan plus, 2026-11-25, job `78b2fa55-e74e-4059-a313-fb80bd070252` |
| Reference inputs | approved style anchors `prop-marsh-store-set-01` (media `13347870-e15e-4ec9-936c-465b447fc295`) and `prop-harbour-cask-set-01` (job `a96511e4-7938-4204-b3c9-6b7f08462886`) |
| Output | `assets/source/prop/prop-river-quay-weir-set-01/prop-river-quay-weir-set-01.png` (SHA-256 `9bb36dcc52f079da1a337d41025be92fc03dfbab14a1f1186d23bf41e34a11bc`) |

## 2. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: Briar Glen Quay and the Millweir, a stone-trade river quay below a mountain mining town, and an ancient Vesperine-built weir.
PROPS (left to right, top to bottom): 1. the stone barge Patient Ann: a broad flat-bottomed river barge of tarred planks, blunt bow, a short stubby mast with a furled tan sail, a tiller, a few dressed glenstone blocks lashed in the open hold; 2. a squat iron-capped timber mooring bollard with a loop of tan hemp rope; 3. three large dressed glenstone blocks stacked on a heavy timber cradle with chocks; 4. a small timber toll shed: plank walls, a hatch window with a shelf, a tarred shingle roof, a hanging iron lantern; 5. a weir sluice gate: a timber sluice board in a stone frame with an iron screw lift and a spoked wheel with worn brass wear, a narrow plank walk across its top; 6. an old Vesperine weir keystone: a big carved pale stone block with a worn bell-shaped relief mark and moss.
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
| 1 | 2026-11-25 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/prop-river-quay-weir-set-01/v1.png` | approved |
