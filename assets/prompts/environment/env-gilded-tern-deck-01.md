# env-gilded-tern-deck-01

**Status: owner-approved concept** (2026-11-15, "They all look great!"). Made from the owner's dock and ship reference photos.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `env-gilded-tern-deck-01` |
| Category | environment |
| Consuming bead(s) | `e40-gilded-tern` (deck and rigging mood target), `e37-asset-ship-gilded-tern-concept-prompts` (ship scale reference) |
| Template | `_templates/environment-concept.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, resolution 2k, aspect 16:9, account plan "plus" |
| Higgsfield job | `5807cace-f503-4d42-9afe-d2a5845e41c7` |
| Output | `assets/source/environment/env-gilded-tern-deck-01/env-gilded-tern-deck-01.png` (SHA-256 `eb4ad5b6f20f9a5f53292fc0b13257a1f7440ae35028dca9e9b2b7eb1ef777a4`) |
| Staging copy | `assets/_incoming/env-gilded-tern-deck-01/v1.png` (gitignored) |

### Reference inputs

- Owner's reference photo IMG_5581 — quarterdeck: tiller, companionway hutch, pin rails, caulked deck, masts (Higgsfield media `2cb278fd-dac4-4b02-8453-0fb89facfb8d`); used for form and construction only, people cropped out
- Owner's reference photo IMG_5580 — masts, yards, tops, shrouds and ratlines from below (Higgsfield media `245b4794-e4cb-4e6c-b316-85f8f2474520`); used for form and construction only, people cropped out
- `assets/source/concept/concept-wendmouth-stone-wharf-probe-01/concept-wendmouth-stone-wharf-probe-01.png` — approved style anchor (Higgsfield media `8c809b35-0b79-46df-8732-5cde83abc6ce`)

The owner supplied the photos as reference for this set (2026-11-15). They are used only as reference inputs for form and construction: they are never shipped and never pasted into an asset.

## 2. Brief

The Gilded Tern’s quarterdeck at anchor in Wendmouth’s pool, Day preset: tiller, hutch, caulked deck and the climbable rigging rising to the tops, with the monumental glenstone harbour beyond. Planned id from `e37-asset-env-wendmouth-concepts-prompts`.

## 3. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Environment concept painting, eye-level third-person game camera about 4 m behind and 2 m above a small figure for scale, strong foreground-midground-background separation, warm light source and cool shadow region, visible gameplay affordances.

SCENE: the quarterdeck of the Gilded Tern, a proud three-masted merchantman anchored in Wendmouth's harbour pool, Day preset, bright and breezy. Wendmouth palette: salt-grey glenstone #9C9788, harbour stone #7E8584, tarred plank #2F2A28, sea grey-green #5E7A7A, sail canvas #E6D9BC, net tan #B08A58; worked wood #8A6440 and bark #5A3E2B; iron in ink-violet #1E1B2E; bunting and shopfront pops of turquoise #2E9AA0, sunflower #E8B83A and coral #D9674E far off on the quays only.
FOREGROUND: a small cloaked adventurer standing by the long honey-varnished tiller bar with its rope-wrapped grip; tan hemp coils hung on belaying pins along a cream-and-ochre painted bulwark.
MIDGROUND: a boxy painted companionway hutch with a curved roof and a lattice grating hatch; salt-grey deck planks with dark caulked seams converging toward the masts.
BACKGROUND: thick masts with yards and furled sails, shrouds and ratlines climbing to round fighting tops — the ratlines carry pale worn knotted handholds (climbable); beyond the rail, Wendmouth's colossal stepped glenstone quays, a treadwheel crane on a stone pier and the great curving breakwater, people and boats small against the stone.
LIGHT: warm sun key from upper left, cool violet-blue shadow under the hutch and the bulwark; long rigging shadows across the deck.
GAMEPLAY AFFORDANCES: climbable ratlines up to the tops; the hutch door and grating lead down to the hold. Ship name never shown as text.
REFERENCE IMAGES: the attached photographs show real construction to borrow — shapes, proportions, joinery, hardware and how things are used. Reinterpret them completely in the painted style above: never copy photographic texture, lighting, noise or framing, and leave out anything modern. The attached painted image is an approved in-game style anchor: match its brushwork, bevel size, lighting and palette.
```

## 4. Output spec

| Property | Value |
|---|---|
| Aspect / size | 16:9, 2k (about 2048×1152) |
| Background | full scene |
| Format | PNG |
| Downstream | mood target only; not shipped at runtime. |

## 5. Consistency checklist (Claude self-check of v1; owner confirms at the gate)

Preamble verbatim, palette, no text/logos, lighting and shape language checked by Claude on v1; per-asset notes in §7. Owner approved v1 on 2026-11-15.

## 6. Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | approved | owner | 2026-11-15 | "They all look great!" (session chat; `assets/approvals.json` does not exist yet) |

## 7. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/env-gilded-tern-deck-01/v1.png` | approved — Strong match to the photos (tiller, hutch, caulked deck, coils on pins) with Wendmouth beyond; ratlines read as climbable with pale knots. Background echoes the stone-wharf probe (lighthouse, columned building). No text. |

## 8. Provenance (recorded in `assets/CREDITS.md`)

| Asset id | Tool / model | Tier | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|
| `env-gilded-tern-deck-01` | generated:higgsfield/gpt_image_2_6 | Higgsfield plus (quality high, 2k) | 2026-11-15 | GEN-OWNED — Higgsfield Terms of Use §4.4 (see the door-wood-01 row in CREDITS.md). https://higgsfield.ai/terms-of-use-agreement | this file |
