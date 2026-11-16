# tex-sailcloth-01

**Status: owner-approved image** (v1, approved 2026-11-16, "They look great"). From the `e37-asset-tex-harbour-prompts` set (plan/assets-harbor.json).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `tex-sailcloth-01` |
| Category | texture |
| Consuming bead(s) | `e37-asset-tex-harbour-integrate`; Gilded Tern sails, Tidemarket awnings |
| Template | `_templates/tileable-texture.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, plan plus, 2026-11-16, job `eb4bc746-399b-4241-90d9-d4cf6adc3c25` |
| Reference inputs | approved `tex-planks-salt-bleached-01` (job `26cf2a8e-e811-445a-8553-761b2f2a87cd`) and `concept-wendmouth-stone-wharf-probe-01` (media `8c809b35-0b79-46df-8732-5cde83abc6ce`) |
| Staging copy | `assets/_incoming/tex-sailcloth-01/v1.png` (gitignored) |

## 2. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Seamless tileable texture, perfectly repeating on all four edges, top-down orthographic, flat even lighting with no directional shadows or highlights, no perspective, low contrast at the edges, no single standout feature, hand-painted stylized surface.

MATERIAL: heavy canvas sailcloth of the Wendmouth ships and market awnings: panels of woven canvas stitched together in vertical seams, with a few darker patches sewn on.
REAL-WORLD SCALE: one tile = 2 m × 2 m; panels about 50 cm wide.
COLOURS: sail canvas #E6D9BC to #D8C8A4, seams and patches #C9B48A and #B08A58, soft weathering stains #9C9788; never pure white.
SURFACE CHARACTER: soft painted weave suggested by gentle strokes, double-stitched seams as thin painted lines, slight soft creasing; calm and low contrast.
WEAR: salt stains and faint mildew bloom near patches; no holes.
Wendmouth palette: salt-grey glenstone #9C9788, harbour stone #7E8584, tarred plank #2F2A28, sea grey-green #5E7A7A, sail canvas #E6D9BC, net tan #B08A58.
REFERENCE IMAGES: the attached painted images are approved in-game textures and concepts for this harbour: match their brushwork, value range and palette.
```

## 3. Output spec

1:1, 2k → 1024² WebP, seamless both axes.

## 4. Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image | v1 | approved | owner | 2026-11-16 | "They look great" (session chat; `assets/approvals.json` does not exist yet) |

## 5. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-16 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/tex-sailcloth-01/v1.png` | approved — calm canvas panels with patches; the patches repeat visibly at 2×2 |

## 6. Files

Source `assets/source/texture/tex-sailcloth-01/tex-sailcloth-01.png` (sha256 `e429af783e8caea7707322d0a3f04007853d4d0ccb9b4d769ded1131223206e9`). Runtime `public/assets/texture/tex-sailcloth-01.webp`: 1024² WebP, both axes overlap-blended (10%). sha256 `30acaed1dc308c13614db3944aa5acd28ab34605959ab2ea52cf7194477e9cf0`.
