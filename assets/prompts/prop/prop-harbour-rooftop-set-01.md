# prop-harbour-rooftop-set-01

**Status: owner-approved concept** (v1, 2026-11-16, under the owner's standing pre-approval; Claude's gate check below). Replaces the CC0 kit route for `e37-asset-props-harbour-waterfront-kit-*`: the kit downloads are blocked here and half the targets had no kit piece (owner chose generation, 2026-11-16).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `prop-harbour-rooftop-set-01` |
| Category | prop |
| Consuming bead(s) | `e37-asset-props-harbour-waterfront-kit-*` → `model-prop-net-loft-01`, `model-prop-plank-bridge-01`, `model-prop-drying-net-01`, `model-prop-gull-hoard-nest-01`, `model-prop-smuggler-crate-01`, `model-prop-lantern-hook-01`, `model-prop-fence-counter-01` |
| Template | `_templates/prop-sheet.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 3:2, plan plus, 2026-11-16, job `462738d1-8c09-422f-86f9-dc6d64c6eb23` |
| Reference inputs | approved style anchors `prop-marsh-store-set-01` (media `13347870-e15e-4ec9-936c-465b447fc295`) and `prop-harbour-cask-set-01` (job `a96511e4-7938-4204-b3c9-6b7f08462886`) |
| Output | `assets/source/prop/prop-harbour-rooftop-set-01/prop-harbour-rooftop-set-01.png` (SHA-256 `14336c9dc06e25c82791bd3872fc7d3b0c20cb57902348da47edcb531786a541`) |

## 2. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: Wendmouth net-loft rooftops and Undertow props.
PROPS (left to right, top to bottom): 1. a crooked timber net loft: a small two-storey tarred-plank shed on a glenstone base, leaning slightly, a tar-felt roof with battens, a loft door with a hoist arm, pale climbable rope wraps on the corner post; 2. a plank rope bridge: a short span of weathered planks with tan hemp rope rails; 3. a loose drying net hung in swags between two poles, sagging, tan hemp with floats; 4. a gull hoard nest on top of a chimney pot, twigs and rope scraps with small glinting stolen shinies (a ring, a button, a coin); 5. a smuggler's crate: a battered small crate with a sea-green cloth #3E7F6E tied round it (the Low Tide Company tell) and a visible false bottom slat; 6. an iron wall lantern hook bracket with a hanging hook, no lantern; 7. the Undertow fence's counter: a plank counter laid across two barrels with a small brass scale and an iron grille.
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
| 1 | 2026-11-16 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/prop-harbour-rooftop-set-01/v1.png` | approved — crooked net loft with climbable rope wraps and hoist, rope-railed plank bridge, loose drying net in swags, gull hoard nest with shinies, smuggler crate with the sea-green tell, lantern hook bracket, Undertow counter on barrels with scale and grille |
