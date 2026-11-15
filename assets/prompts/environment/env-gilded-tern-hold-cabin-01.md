# env-gilded-tern-hold-cabin-01

**Status: owner-approved concept** (2026-11-15, "They all look great!"). Made from the owner's dock and ship reference photos.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `env-gilded-tern-hold-cabin-01` |
| Category | environment |
| Consuming bead(s) | `e40-gilded-tern` (hold, cabin and locked berth mood target), `e37-asset-ship-gilded-tern-concept-prompts` (interior scale) |
| Template | `_templates/environment-concept.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, resolution 2k, aspect 16:9, account plan "plus" |
| Higgsfield job | `747ae738-6e44-4972-a567-f50d6b5993a6` |
| Output | `assets/source/environment/env-gilded-tern-hold-cabin-01/env-gilded-tern-hold-cabin-01.png` (SHA-256 `9384172a636fc64121f436a92e41cde9ba2c8f95d2011af1653d2efb75fc9770`) |
| Staging copy | `assets/_incoming/env-gilded-tern-hold-cabin-01/v1.png` (gitignored) |

### Reference inputs

- Owner's reference photo IMG_5572 — between-decks: mast trunks, rope-wrapped mast, chests, kegs (cropped to the right half) (Higgsfield media `da9bdb29-3715-4cbd-a981-fdb2ccf4e514`); used for form and construction only, people cropped out
- Owner's reference photo IMG_5574 — hemp, cotton and tarred rope coils and a net hung on hull frames (cropped right third) (Higgsfield media `cdf7dc61-ccd4-460b-931d-96354afa8533`); used for form and construction only, people cropped out
- Owner's reference photo IMG_5576 — slatted bunks with a brown curtain on rings (Higgsfield media `f9db27b9-e3a0-4181-98a5-ab97596adafb`); used for form and construction only, people cropped out
- Owner's reference photo IMG_5575 — pine plank bulkhead with rows of black nail-heads (cropped right edge) (Higgsfield media `4fcacb4e-e595-4c70-befc-d9d093dd27e9`); used for form and construction only, people cropped out
- `assets/source/concept/concept-wendmouth-stone-wharf-probe-01/concept-wendmouth-stone-wharf-probe-01.png` — approved style anchor (Higgsfield media `8c809b35-0b79-46df-8732-5cde83abc6ce`)

The owner supplied the photos as reference for this set (2026-11-15). They are used only as reference inputs for form and construction: they are never shipped and never pasted into an asset.

## 2. Brief

Below decks on the Gilded Tern: low beamed hold with mast trunks, curved knees and hull frames hung with rope and nets; crew bunks with a curtain; and the new pine bulkhead of Mr. S—’s agent’s locked passenger berth. Warm light falls through a grating; barrels and chests make readable hiding places. Planned id from `e37-asset-env-wendmouth-concepts-prompts`.

## 3. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Environment concept painting, eye-level third-person game camera about 4 m behind and 2 m above a small figure for scale, strong foreground-midground-background separation, warm light source and cool shadow region, visible gameplay affordances.

SCENE: below decks on the Gilded Tern, a three-masted merchantman — the crew deck leading aft to a locked passenger berth. Interior palette: honey pine and warm reddish timber (#8A6440, #5A3E2B, highlights toward #C9923A), tan hemp #B08A58, sail canvas #E6D9BC, ink-violet shadow #1E1B2E.
FOREGROUND: a small cloaked adventurer crouched beside a stack of honey-oak kegs and an iron-strapped sea chest; coils of tan hemp, a hank of pale line, a heavy tarred hawser coil and a loose drying net hung on curved hull frames.
MIDGROUND: two thick polished pine mast trunks passing through the deck, one with tan rope wrapped around its base; low heavy deck beams with curved hanging knees fixed by round brass bolt heads; slatted wooden bunks along the hull with a brown wool curtain hung on iron rings.
BACKGROUND: a newer pine plank bulkhead with neat rows of black nail-heads and a heavy plank door with a black-steel keyhole plate — the locked passenger berth.
LIGHT: warm daylight falling in a square shaft through a deck grating overhead and one warm hanging lantern; cool violet-blue shadow pooling between the barrels and in the corners (real hiding places).
GAMEPLAY AFFORDANCES: hiding spots in the dark among barrels and chests; the berth door reads locked (black-steel plate = hard lock); a ladder up to the grating hatch.
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
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/env-gilded-tern-hold-cabin-01/v1.png` | approved — Mast trunks with rope wraps, knees with brass bolts, curtained bunks, hung coils/net, grating light shaft, ladder, and the berth door with a dark keyhole plate. Corner shadows could be darker for hiding spots. |

## 8. Provenance (recorded in `assets/CREDITS.md`)

| Asset id | Tool / model | Tier | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|
| `env-gilded-tern-hold-cabin-01` | generated:higgsfield/gpt_image_2_6 | Higgsfield plus (quality high, 2k) | 2026-11-15 | GEN-OWNED — Higgsfield Terms of Use §4.4 (see the door-wood-01 row in CREDITS.md). https://higgsfield.ai/terms-of-use-agreement | this file |
