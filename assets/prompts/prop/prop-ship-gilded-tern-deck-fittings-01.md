# prop-ship-gilded-tern-deck-fittings-01

**Status: generated v1, awaiting owner approval** (2026-11-15). Made from the owner's dock and ship reference photos.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `prop-ship-gilded-tern-deck-fittings-01` |
| Category | prop |
| Consuming bead(s) | `e37-asset-ship-gilded-tern-*` (`model-ship-gilded-tern-hull-01`, `model-ship-gilded-tern-rigging-01` dressing), `e40-gilded-tern` |
| Template | `_templates/prop-sheet.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, resolution 2k, aspect 3:2, account plan "plus" |
| Higgsfield job | `125575c8-8a9f-4120-9647-10dd60850eab` |
| Staging copy | `assets/_incoming/prop-ship-gilded-tern-deck-fittings-01/v1.png` (gitignored) |

### Reference inputs

- Owner's reference photo IMG_5581 — quarterdeck: tiller, companionway hutch, pin rails, caulked deck, masts (Higgsfield media `2cb278fd-dac4-4b02-8453-0fb89facfb8d`); used for form and construction only, people cropped out
- Owner's reference photo IMG_5578 — deck grating, rudder head and tiller, caulked deck, bulwark cleats (Higgsfield media `4913f70d-3a82-4009-85a9-a38f213a90f4`); used for form and construction only, people cropped out
- `assets/source/prop/prop-marsh-store-set-01/prop-marsh-store-set-01.png` — approved style anchor (Higgsfield media `13347870-e15e-4ec9-936c-465b447fc295`)

The owner supplied the photos as reference for this set (2026-11-15). They are used only as reference inputs for form and construction: they are never shipped and never pasted into an asset.

## 2. Brief

Deck fittings for the Gilded Tern’s quarterdeck, from the tiller and grating photos: tiller and rudder head, lattice grating hatch, companionway hutch down to the hold, pin rail and cleats on a bulwark section, ship’s lantern, and a shroud foot with ratlines (the climbable cue). The hutch door and grating rings are interactables.

## 3. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: deck fittings for the Gilded Tern, a three-masted merchantman. Wendmouth palette: salt-grey glenstone #9C9788, harbour stone #7E8584, tarred plank #2F2A28, sea grey-green #5E7A7A, sail canvas #E6D9BC, net tan #B08A58; worked wood #8A6440 and bark #5A3E2B; iron in ink-violet #1E1B2E; painted bulwarks in sail-canvas cream #E6D9BC and ochre #C9923A; deck-furniture paint warm brown #8A6440; Tern crew blue #4A6A8A and gilt #C9A042 as small accents only; lantern glow hearth #E8A24A.
PROPS (left to right, top to bottom): 1. the steering tiller: a long honey-varnished oak tiller bar with a rope-wrapped grip at its end, socketed into a square rudder-head post with a metal cap; 2. a square lattice deck grating in a raised painted-brown coaming, with iron lifting rings; 3. a companionway hutch: a boxy painted wooden cover with a gently curved roof, panelled sides and a small door on iron hinges, leading below; 4. a section of painted bulwark with a timber pin rail holding belaying pins with hung tan coils and two wooden cleats; 5. a ship's lantern on a wrought-iron bracket, warm glow; 6. the foot of a shroud: deadeyes and lanyards on a chain plate, with three rope ratlines rising above it showing pale worn knotted handholds.
SYSTEMIC CUES: the grating's lifting rings and the hutch door handle show polished brass wear #C9A042 (interactable); ratlines on prop 6 are climbable — pale worn knotted handholds #D9C38A; coils are tan hemp (flammable). No legibility cue on anything else.
SHAPE: chunky, bevelled, slightly exaggerated thickness, painted planking with soft wear; big–medium–small; readable at 10 m.
SCALE REFERENCE: include a small 1.8 m human outline at the edge.
REFERENCE IMAGES: the attached photographs show real construction to borrow — shapes, proportions, joinery, hardware and how things are used. Reinterpret them completely in the painted style above: never copy photographic texture, lighting, noise or framing, and leave out anything modern. The attached painted image is an approved in-game style anchor: match its brushwork, bevel size, lighting and palette.
```

## 4. Output spec

| Property | Value |
|---|---|
| Aspect / size | 3:2, 2k (about 2048×1365) |
| Background | flat parchment |
| Format | PNG |
| Downstream | small 50–400 tris, medium 400–2 k (casks, chests), large 2–5 k (hutch); one shared prop atlas, one material per set (style bible §13.2). Flat concept for the image-to-3D flow after the owner approves it (§17.2). |

## 5. Consistency checklist (Claude self-check of v1; owner confirms at the gate)

Preamble verbatim, palette, no text/logos, lighting and shape language checked by Claude on v1; per-asset notes in §7. Owner approval pending.

## 6. Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | pending | owner | — | — |

## 7. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/prop-ship-gilded-tern-deck-fittings-01/v1.png` | candidate — Tiller, grating with brass rings, hutch with brass handle, pin-rail bulwark, lantern all good. #6 came out as three deadeyes with ratlines whose knots are pale-ish; acceptable but could be re-rolled for a clearer climbable cue. Scale shown as a figure plus a height bar. |

## 8. Provenance (copy into `assets/CREDITS.md` when approved)

| Asset id | Tool / model | Tier | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|
| `prop-ship-gilded-tern-deck-fittings-01` | generated:higgsfield/gpt_image_2_6 | Higgsfield plus (quality high, 2k) | 2026-11-15 | GEN-OWNED — Higgsfield Terms of Use §4.4 (see the door-wood-01 row in CREDITS.md). https://higgsfield.ai/terms-of-use-agreement | this file |
