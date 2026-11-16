# prop-tidefair-set-01

**Status: owner-approved concept** (v1, 2026-11-16, under the owner's standing pre-approval; Claude's gate check below). Replaces the CC0 kit route for `e37-asset-props-harbour-waterfront-kit-*`: the kit downloads are blocked here and half the targets had no kit piece (owner chose generation, 2026-11-16).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `prop-tidefair-set-01` |
| Category | prop |
| Consuming bead(s) | `e37-asset-props-harbour-waterfront-kit-*` → `model-prop-tidefair-boom-01`, `model-prop-wooden-gull-target-01`, `model-prop-bunting-01` |
| Template | `_templates/prop-sheet.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 3:2, plan plus, 2026-11-16, job `4d0f33d9-7a19-4772-b594-702faa71c9ba` |
| Reference inputs | approved style anchors `prop-marsh-store-set-01` (media `13347870-e15e-4ec9-936c-465b447fc295`) and `prop-harbour-cask-set-01` (job `a96511e4-7938-4204-b3c9-6b7f08462886`) |
| Output | `assets/source/prop/prop-tidefair-set-01/prop-tidefair-set-01.png` (SHA-256 `168870b1734760e20b8623acdb15a090756ac19449efdc1dd9a1ec5b7aeb838c`) |

## 2. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: the Tidefair contest props on the Stone Wharf.
PROPS (left to right): 1. the Tidefair swinging boom: a timber gallows post on a stone block with a long swinging arm and a rope hanging from its end over open space; 2. a wooden gull target: a flat cut-out painted gull on a short stake, white and grey with a yellow beak, a red-and-cream bullseye ring #C8553D/#EFE2C4 painted on its chest (the mechanism-for-arrows cue); 3. three more wooden gull targets in different flying poses; 4. a string of festival bunting: triangular cloth flags in turquoise, sunflower and coral on a sagging tan rope, with a short pole at each end.
Wendmouth palette: salt-grey glenstone #9C9788, harbour stone #7E8584, tarred plank #2F2A28, sea grey-green #5E7A7A, sail canvas #E6D9BC, net tan #B08A58; shopfront and bunting pops turquoise #2E9AA0, sunflower #E8B83A, coral #D9674E; worked wood #8A6440, bark #5A3E2B, iron ink-violet #1E1B2E.
SYSTEMIC CUES (style bible §7): climbable surfaces carry pale worn knotted handholds #D9C38A; a cuttable load line wears one red-and-cream ring band #C8553D/#EFE2C4 at the cut point; all rope is tan hemp; decorative drying nets hang loose in swags, never taut.
SHAPE: chunky, bevelled, heavy proportions; big–medium–small; readable at 10 m; each prop separate with generous spacing, no overlapping.
SCALE REFERENCE: include a small 1.8 m human outline at the edge.
REFERENCE IMAGES: the attached painted images are approved in-game style anchors for this harbour: match their brushwork, bevel size, lighting and palette.
```

## 3. Output spec

3:2, 2k flat concept on parchment for the image-to-3D flow; small props 50–400 tris, medium 400–2 k, large 2–5 k (LOD1 50 %), one prop atlas, one material per set (style bible §13.2).

## 4. Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | Claude's check: every prop present, §7 cues present (climb wraps, red-and-cream cut band), drying net loose, no lettering, palette on Wendmouth tokens |

## 5. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-16 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/prop-tidefair-set-01/v1.png` | approved — swinging boom with climbable pegs, four wooden gull targets with bullseyes, bunting on a sagging rope |
