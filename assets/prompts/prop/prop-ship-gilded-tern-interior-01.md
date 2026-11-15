# prop-ship-gilded-tern-interior-01

**Status: generated v3 (defences, watertight lading port), flat concept awaiting owner approval** (2026-11-15). Bead plan: `e37-asset-ship-gilded-tern-concept-prompts` (plan/assets-harbor.json).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `prop-ship-gilded-tern-interior-01` |
| Category | prop (flat concept sheet for image-to-3D) |
| Consuming bead(s) | `e37-asset-ship-gilded-tern-3d-generate`, `e40-gilded-tern` |
| Target model ids | `model-ship-gilded-tern-interior-01` |
| Template | `_templates/prop-sheet.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 3:2, plan plus, 2026-11-15, job `fcb85285-5ce7-40fa-bc71-c2bce85f53e9` |
| Staging copy | `assets/_incoming/prop-ship-gilded-tern-interior-01/v1.png` (gitignored) |

### Reference inputs

- approved `env-gilded-tern-hold-cabin-01` (job `747ae738-6e44-4972-a567-f50d6b5993a6`)
- IMG_5572 between-decks photo, cropped (media `da9bdb29-3715-4cbd-a981-fdb2ccf4e514`)
- IMG_5576 berth photo (media `f9db27b9-e3a0-4181-98a5-ab97596adafb`)
- IMG_5575 bulkhead photo, cropped (media `4fcacb4e-e595-4c70-befc-d9d093dd27e9`)

Owner photos are used only as references for form and construction; they are never shipped.

## 2. Fit to the level

The grey-box Tern in `wendmouth-harbour` is a hull platform 10 m wide and 40 m long (x 30–40, z 106–146; bulwarks at
x 31 and 39) with its deck at y = 2, bow to the south by the gangway (z 106) and the stern cabin (doorway z 138) and the
locked berth (z 142–146) to the north. Masts stand at z 124 and 136 (x 35); the rigging climb starts at
`tern-rigging-foot` (z 123.5) and reaches the crow's nest about 10 m above the deck. Models built from this sheet must
match those positions; the hull is about four times as long as wide. (Corrected 2026-11-15: an earlier note gave 20 × 5 m,
misreading the platform piece's 2 m base.)

## 3. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: the Gilded Tern's interior modules for image-to-3D, each shown as an open cutaway set piece. Interior palette: honey pine and warm reddish timber #8A6440 and #5A3E2B with highlights toward #C9923A, tan hemp #B08A58, sail canvas #E6D9BC, black-steel #1E1B2E fittings.
PROPS (left to right, top to bottom): 1. the hold: a long low beamed space under the deck, curved hull frames, heavy deck beams with curved hanging knees fixed by brass bolt heads, two thick pine mast trunks passing through, a ladder up to a grating hatch; 2. the captain's cabin at the stern: a low cabin with a row of small stern windows, a chart table, a bunk with a brown wool curtain on iron rings and a sea chest; 3. the locked passenger berth: a small cabin behind a new pine plank bulkhead with rows of black nail-heads and a heavy plank door with a black-steel keyhole plate, closed; 4. the same berth door section seen alone, front-on.
SYSTEMIC CUES: the berth door is lockable — a black-steel keyhole plate (hard lock); the ladder is climbable — pale worn rungs #D9C38A; hemp is flammable; nothing else carries a cue.
SHAPE: chunky, bevelled, slightly exaggerated beams and knees; interior scale matches a ship about 20 m long and 5 m wide, with a 2 m deck height; big–medium–small.
SCALE REFERENCE: include a small 1.8 m human outline in view 1.
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
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial (job `fcb85285-5ce7-40fa-bc71-c2bce85f53e9`) | `assets/_incoming/prop-ship-gilded-tern-interior-01/v1.png` | superseded by v2 |
| 2 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | Added scuttles lighting the hold and the inside of the lockable cargo port (iron, simple lock); interior scale corrected to the 40 m × 10 m hull. v1 sheet passed as the base reference. Job `23361e12-b2ee-4f47-86d5-1f4d492a393a`. | `assets/_incoming/prop-ship-gilded-tern-interior-01/v2.png` | superseded by v3 — scuttles cast light shafts; the cargo port came out as a hatch in the aft bulkhead rather than the hull side |
| 3 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | Moved the lading port from the aft bulkhead to high in the hull side under the deck beams, caulked with two iron bars and an iron keyhole plate. v2 sheet passed as the base reference. Job `5da34499-60d4-48a3-99ca-9199fad3427e`. | `assets/_incoming/prop-ship-gilded-tern-interior-01/v3.png` | candidate — port high in the hull side by the ladder; aft-bulkhead hatch removed |

## 7. v2 prompt (superseded)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: the Gilded Tern's interior modules for image-to-3D, each shown as an open cutaway set piece. Interior palette: honey pine and warm reddish timber #8A6440 and #5A3E2B with highlights toward #C9923A, tan hemp #B08A58, sail canvas #E6D9BC, black-steel #1E1B2E fittings.
PROPS (left to right, top to bottom): 1. the hold: a long low beamed space under the deck, curved hull frames with small round scuttles letting in shafts of daylight, the inside of a hinged square cargo port in the hull side (closed, iron bar and iron keyhole plate), heavy deck beams with curved hanging knees fixed by brass bolt heads, two thick pine mast trunks passing through, a ladder up to a grating hatch; 2. the captain's cabin at the stern: a low cabin with a row of small stern windows, a chart table, a bunk with a brown wool curtain on iron rings and a sea chest; 3. the locked passenger berth: a small cabin behind a new pine plank bulkhead with rows of black nail-heads and a heavy plank door with a black-steel keyhole plate, closed; 4. the same berth door section seen alone, front-on.
SYSTEMIC CUES: the berth door is lockable — a black-steel keyhole plate (hard lock); the cargo port is lockable — a plain iron keyhole plate (simple lock); the ladder is climbable — pale worn rungs #D9C38A; hemp is flammable; nothing else carries a cue.
SHAPE: chunky, bevelled, slightly exaggerated beams and knees; interior scale matches a ship about 40 m long and 10 m wide, with a 2 m deck height; big–medium–small.
SCALE REFERENCE: include a small 1.8 m human outline in view 1.
REFERENCE IMAGES: the attached photographs show real rigging, masts, deck furniture and construction to borrow; reinterpret them completely in the painted style above, never copying photographic texture, lighting or framing, and leaving out anything modern. The attached painted images are approved in-game concepts of this same ship and its deck and hold: keep this ship consistent with them. The attached v1 interior sheet is the base: keep it and only add the scuttles and the cargo port described above.
```

## 8. v3 prompt (current)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: the Gilded Tern's interior modules for image-to-3D, each shown as an open cutaway set piece. Interior palette: honey pine and warm reddish timber #8A6440 and #5A3E2B with highlights toward #C9923A, tan hemp #B08A58, sail canvas #E6D9BC, black-steel #1E1B2E fittings.
PROPS (left to right, top to bottom): 1. the hold: a long low beamed space under the deck, curved hull frames with small round scuttles letting in shafts of daylight, the inside of a square lading port high in the curved hull side just under the deck beams, well above the floor of the hold (closed, its seams caulked and tarred, two iron bars across it and an iron keyhole plate), heavy deck beams with curved hanging knees fixed by brass bolt heads, two thick pine mast trunks passing through, a ladder up to a grating hatch; 2. the captain's cabin at the stern: a low cabin with a row of small stern windows, a chart table, a bunk with a brown wool curtain on iron rings and a sea chest; 3. the locked passenger berth: a small cabin behind a new pine plank bulkhead with rows of black nail-heads and a heavy plank door with a black-steel keyhole plate, closed; 4. the same berth door section seen alone, front-on.
SYSTEMIC CUES: the berth door is lockable — a black-steel keyhole plate (hard lock); the lading port is lockable — a plain iron keyhole plate (simple lock); the ladder is climbable — pale worn rungs #D9C38A; hemp is flammable; nothing else carries a cue.
SHAPE: chunky, bevelled, slightly exaggerated beams and knees; interior scale matches a ship about 40 m long and 10 m wide, with a 2 m deck height; big–medium–small.
SCALE REFERENCE: include a small 1.8 m human outline in view 1.
REFERENCE IMAGES: the attached photographs show real rigging, masts, deck furniture and construction to borrow; reinterpret them completely in the painted style above, never copying photographic texture, lighting or framing, and leaving out anything modern. The attached painted images are approved in-game concepts of this same ship and its deck and hold: keep this ship consistent with them. The attached v2 interior sheet is the base: keep it exactly, but remove the small hatch from the aft bulkhead and show the lading port high in the hull side instead.
```
