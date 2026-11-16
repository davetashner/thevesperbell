# prop-ship-gilded-tern-01

**Status: owner-approved concept v3** (2026-11-15, "Approved, go ahead with the 3D models") (2026-11-15). Bead plan: `e37-asset-ship-gilded-tern-concept-prompts` (plan/assets-harbor.json).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `prop-ship-gilded-tern-01` |
| Category | prop (flat concept sheet for image-to-3D) |
| Consuming bead(s) | `e37-asset-ship-gilded-tern-3d-generate`, `e40-gilded-tern` |
| Target model ids | `model-ship-gilded-tern-hull-01`, `model-ship-gilded-tern-rigging-01`, `model-prop-tern-figurehead-01` |
| Template | `_templates/prop-sheet.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 3:2, plan plus, 2026-11-15, job `90c2369f-9f49-4c5b-a4c2-3b2002eaa372` |
| Output | `assets/source/prop/prop-ship-gilded-tern-01/prop-ship-gilded-tern-01.png` (v3, SHA-256 `9b69e615345d136fbba97632d2fd2fc0a0ae34bb9ee91d7533c5a418b0af31d7`) |
| Staging copies | `assets/_incoming/prop-ship-gilded-tern-01/v1.png`, `v2.png`, `v3.png` (gitignored) |

### Reference inputs

- IMG_5580 rigging photo (media `245b4794-e4cb-4e6c-b316-85f8f2474520`)
- IMG_5581 quarterdeck photo (media `2cb278fd-dac4-4b02-8453-0fb89facfb8d`)
- approved `env-gilded-tern-deck-01` (job `5807cace-f503-4d42-9afe-d2a5845e41c7`)

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
| image (flat concept) | v3 | approved | owner | 2026-11-15 | "Approved, go ahead with the 3D models" (session chat; `assets/approvals.json` does not exist yet) |
| turntable (per model) | — | — | owner | — | — |

## 6. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial (job `90c2369f-9f49-4c5b-a4c2-3b2002eaa372`) | `assets/_incoming/prop-ship-gilded-tern-01/v1.png` | superseded by v2 |
| 2 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | Owner: "no cannons" (2026-11-15) — added gunpowder-free defences: swivel springalds on the rails and stern, rolled hemp boarding nets on the bulwarks, mantlets on the fighting tops, shuttered scuttles along the hull and a lockable cargo port near the waterline. v1 sheet passed as the base reference. Job `f8ea9830-fb3d-47e0-b1ab-1ed5ba772f13`. | `assets/_incoming/prop-ship-gilded-tern-01/v2.png` | superseded by v3 — all defences and ports present; the bowsprit came out as a thick banded tube that may read as a cannon barrel from afar (fix in a v3 or in the model) |
| 3 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | Owner: the low cargo hatch could never be watertight — moved it up as a caulked, tarred, iron-barred lading port just under the wale, added the climbable anchor cable from a bow hawse-hole as the way up from a boat, and slimmed the bowsprit to a tapering spar (v2 read as a barrel). v2 sheet passed as the base reference. Job `6763240f-1ca4-473c-b831-39cde6ba8d2d`. | `assets/_incoming/prop-ship-gilded-tern-01/v3.png` | candidate — port caulked and barred under the lower wale, mid-hull; anchor cable and slim bowsprit present; v2 defences kept |

## 7. v2 prompt (superseded)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: the Gilded Tern, a proud three-masted merchantman anchored in Wendmouth harbour, designed for image-to-3D as modular pieces. Wendmouth palette: tarred hull planking #2F2A28 with a broad ochre wale stripe #C9923A, cream-and-ochre painted bulwarks #E6D9BC, salt-grey caulked deck #9C9788, honey-varnished masts and yards #8A6440, furled sail canvas #E6D9BC, tan hemp rigging #B08A58, crew blue #4A6A8A and gilt #C9A042 as small accents only.
DEFENCES (no gunpowder exists in this world: no cannons, no gunports, no muskets): two swivel springalds — heavy crossbows on iron swivel posts — on each side rail and one at the stern; rolled boarding nets of tan hemp lashed along the top of the bulwarks, ready to be raised; wooden mantlets (shield boards) around the round fighting tops for archers; a row of small round scuttles (portholes) with wooden shutters along the hull below the rail; and one hinged square cargo port low in the side of the hull near the waterline, closed, with iron hinges.
PROPS (left to right, top to bottom): 1. the whole ship in a clean side elevation (orthographic, bow on the left): a sturdy round-bellied hull about four times as long as it is wide, a raised stern castle with a cabin and small windows, a short bowsprit, three masts with yards and furled sails, round fighting tops, shrouds and ratlines; 2. the same ship in three-quarter view from the bow quarter, sails furled; 3. the hull alone without masts or rigging, three-quarter view, showing the open deck, bulwarks and stern castle; 4. one mast with its yards, mantlet-ringed fighting top and shrouds with ratlines, and beside it one swivel springald on its rail post; 5. the gilded tern figurehead: a carved tern with swept-back wings under the bowsprit, gilt #C9A042 worn to wood at the edges.
SYSTEMIC CUES: the ratlines and shrouds are climbable — pale worn knotted handholds #D9C38A; the rolled boarding nets and all rigging rope are tan hemp (flammable); the cargo port is lockable — a visible iron keyhole plate; no other part carries a cue.
SHAPE: chunky, bevelled, heavy proportions, slightly exaggerated hull curve and thick masts; big–medium–small; reads as a proud merchantman from the wharf. No name or text painted on the hull.
SCALE REFERENCE: include a small 1.8 m human outline standing on the deck of view 1.
REFERENCE IMAGES: the attached photographs show real rigging, masts, deck furniture and construction to borrow; reinterpret them completely in the painted style above, never copying photographic texture, lighting or framing, and leaving out anything modern. The attached painted images are approved in-game concepts of this same ship and its deck and hold: keep this ship consistent with them. The attached v1 design sheet of this ship is the base: keep its hull, colours, masts and figurehead and only add the defences and ports described above.
```

## 8. v3 prompt (current)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: the Gilded Tern, a proud three-masted merchantman anchored in Wendmouth harbour, designed for image-to-3D as modular pieces. Wendmouth palette: tarred hull planking #2F2A28 with a broad ochre wale stripe #C9923A, cream-and-ochre painted bulwarks #E6D9BC, salt-grey caulked deck #9C9788, honey-varnished masts and yards #8A6440, furled sail canvas #E6D9BC, tan hemp rigging #B08A58, crew blue #4A6A8A and gilt #C9A042 as small accents only.
DEFENCES (no gunpowder exists in this world: no cannons, no gunports, no muskets): two swivel springalds — heavy crossbows on iron swivel posts — on each side rail and one at the stern; rolled boarding nets of tan hemp lashed along the top of the bulwarks, ready to be raised; wooden mantlets (shield boards) around the round fighting tops for archers; a row of small round scuttles (portholes) with wooden shutters along the hull below the rail; and one lading port: a square hinged port high in the side of the hull just below the ochre wale, well above the waterline (never low on the hull), closed, its edges caulked and tarred watertight, with heavy iron hinges, two iron bars and an iron keyhole plate; a thick anchor cable runs from a hawse-hole at the bow down into the water, the one way up to the port from a boat. The bowsprit is a plain tapering wooden spar, thin at its tip, with rope lashings, never a thick tube or banded barrel.
PROPS (left to right, top to bottom): 1. the whole ship in a clean side elevation (orthographic, bow on the left): a sturdy round-bellied hull about four times as long as it is wide, a raised stern castle with a cabin and small windows, a short bowsprit, three masts with yards and furled sails, round fighting tops, shrouds and ratlines; 2. the same ship in three-quarter view from the bow quarter, sails furled; 3. the hull alone without masts or rigging, three-quarter view, showing the open deck, bulwarks and stern castle; 4. one mast with its yards, mantlet-ringed fighting top and shrouds with ratlines, and beside it one swivel springald on its rail post; 5. the gilded tern figurehead: a carved tern with swept-back wings under the bowsprit, gilt #C9A042 worn to wood at the edges.
SYSTEMIC CUES: the ratlines and shrouds are climbable — pale worn knotted handholds #D9C38A; the rolled boarding nets and all rigging rope are tan hemp (flammable); the lading port is lockable — a visible iron keyhole plate; the anchor cable is climbable — pale worn rope wraps #D9C38A; no other part carries a cue.
SHAPE: chunky, bevelled, heavy proportions, slightly exaggerated hull curve and thick masts; big–medium–small; reads as a proud merchantman from the wharf. No name or text painted on the hull.
SCALE REFERENCE: include a small 1.8 m human outline standing on the deck of view 1.
REFERENCE IMAGES: the attached photographs show real rigging, masts, deck furniture and construction to borrow; reinterpret them completely in the painted style above, never copying photographic texture, lighting or framing, and leaving out anything modern. The attached painted images are approved in-game concepts of this same ship and its deck and hold: keep this ship consistent with them. The attached v2 design sheet of this ship is the base: keep it exactly, and change only the cargo port (move it high under the wale, caulked and barred), add the anchor cable and slim the bowsprit to a tapering spar.
```
