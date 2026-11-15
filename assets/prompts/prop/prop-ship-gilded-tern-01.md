# prop-ship-gilded-tern-01

**Status: generated v1, flat concept awaiting owner approval** (2026-11-15). Bead plan: `e37-asset-ship-gilded-tern-concept-prompts` (plan/assets-harbor.json).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `prop-ship-gilded-tern-01` |
| Category | prop (flat concept sheet for image-to-3D) |
| Consuming bead(s) | `e37-asset-ship-gilded-tern-3d-generate`, `e40-gilded-tern` |
| Target model ids | `model-ship-gilded-tern-hull-01`, `model-ship-gilded-tern-rigging-01`, `model-prop-tern-figurehead-01` |
| Template | `_templates/prop-sheet.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 3:2, plan plus, 2026-11-15, job `90c2369f-9f49-4c5b-a4c2-3b2002eaa372` |
| Staging copy | `assets/_incoming/prop-ship-gilded-tern-01/v1.png` (gitignored) |

### Reference inputs

- IMG_5580 rigging photo (media `245b4794-e4cb-4e6c-b316-85f8f2474520`)
- IMG_5581 quarterdeck photo (media `2cb278fd-dac4-4b02-8453-0fb89facfb8d`)
- approved `env-gilded-tern-deck-01` (job `5807cace-f503-4d42-9afe-d2a5845e41c7`)

Owner photos are used only as references for form and construction; they are never shipped.

## 2. Fit to the level

The grey-box Tern in `wendmouth-harbour` is a 20 m × 5 m hull (x 32.5–37.5, z 116–136) with its deck at y = 2, bow to the
south by the gangway and the stern cabin and locked berth to the north (spawns `door-tern-cabin`, `door-tern-berth`). The
rigging climb starts at `tern-rigging-foot` (7.5 m aft of the bow) and reaches the crow's nest about 10 m above the deck.
Models built from this sheet must match those positions; the hull is about four times as long as wide.

## 3. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: the Gilded Tern, a proud three-masted merchantman anchored in Wendmouth harbour, designed for image-to-3D as modular pieces. Wendmouth palette: tarred hull planking #2F2A28 with a broad ochre wale stripe #C9923A, cream-and-ochre painted bulwarks #E6D9BC, salt-grey caulked deck #9C9788, honey-varnished masts and yards #8A6440, furled sail canvas #E6D9BC, tan hemp rigging #B08A58, crew blue #4A6A8A and gilt #C9A042 as small accents only.
PROPS (left to right, top to bottom): 1. the whole ship in a clean side elevation (orthographic, bow on the left): a sturdy round-bellied hull about four times as long as it is wide, a raised stern castle with a cabin and small windows, a short bowsprit, three masts with yards and furled sails, round fighting tops, shrouds and ratlines; 2. the same ship in three-quarter view from the bow quarter, sails furled; 3. the hull alone without masts or rigging, three-quarter view, showing the open deck, bulwarks and stern castle; 4. one mast with its yards, fighting top and shrouds with ratlines; 5. the gilded tern figurehead: a carved tern with swept-back wings under the bowsprit, gilt #C9A042 worn to wood at the edges.
SYSTEMIC CUES: the ratlines and shrouds are climbable — pale worn knotted handholds #D9C38A; all rigging rope is tan hemp (flammable); no other part carries a cue.
SHAPE: chunky, bevelled, heavy proportions, slightly exaggerated hull curve and thick masts; big–medium–small; reads as a proud merchantman from the wharf. No name or text painted on the hull.
SCALE REFERENCE: include a small 1.8 m human outline standing on the deck of view 1.
REFERENCE IMAGES: the attached photographs show real rigging, masts, deck furniture and construction to borrow; reinterpret them completely in the painted style above, never copying photographic texture, lighting or framing, and leaving out anything modern. The attached painted images are approved in-game concepts of this same ship and its deck and hold: keep this ship consistent with them.
```

## 4. Output spec

| Property | Value |
|---|---|
| Aspect / size | 3:2, 2k (2048×1360) |
| Background | flat parchment |
| Downstream | hero props 2–5 k tris; modular ship pieces ≤ 5 k per module, LOD1 50 %; T2 1024² atlas; ≤ 1 material per model (style bible §13.2, §5.6) |

## 5. Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | pending | owner | — | — |
| turntable (per model) | — | — | owner | — | — |

## 6. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/prop-ship-gilded-tern-01/v1.png` | candidate |
