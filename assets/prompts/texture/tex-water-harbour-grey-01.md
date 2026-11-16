# tex-water-harbour-grey-01

**Status: owner-approved image** (v1, approved 2026-11-16). From the `e37-asset-tex-harbour-prompts` set (plan/assets-harbor.json).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `tex-water-harbour-grey-01` |
| Category | texture |
| Consuming bead(s) | `e37-asset-tex-harbour-integrate`; Wendmouth's standing water: the harbour pools and the open sea (`liquid` spawns tagged `pool`/`sea`). |
| Template | `_templates/tileable-texture.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 1:1, plan plus, 2026-11-15, job `3b23ed3f-0116-4da4-9e43-0dec1a01cadd` |
| Reference inputs | approved `tex-planks-salt-bleached-01` (job `26cf2a8e-e811-445a-8553-761b2f2a87cd`) and `concept-wendmouth-stone-wharf-probe-01` |
| Staging copy | `assets/_incoming/tex-water-harbour-grey-01/v1.png` (gitignored) |

## 2. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Seamless tileable texture, perfectly repeating on all four edges, top-down orthographic, flat even lighting with no directional shadows or highlights, no perspective, low contrast at the edges, no single standout feature, hand-painted stylized surface.

MATERIAL: the calm standing water of a sea harbour seen from above: gentle painted ripples and soft broad swells, no current, no foam, no waves breaking, no reflections of objects.
REAL-WORLD SCALE: one tile = 8 m × 8 m.
COLOURS: sea grey-green #5E7A7A with deeper #3F5F64 troughs and soft sky glints toward #8FA8C8; a hint of clear water blue #3F7FA0.
SURFACE CHARACTER: broad, low-contrast painted ripple shapes, readable at a glance as water, calm and still (style bible: standing water reads as water without implying a current).
WEAR: none; no debris, no boats, no single standout feature.
REFERENCE IMAGES: the attached painted images are approved in-game textures and concepts for this harbour: match their brushwork, value range and palette.
```

## 3. Output spec

1:1, 2k generate → seam repair → 1024² WebP runtime (KTX2 once `mw-e37.8` lands), seamless on both axes.

## 4. Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image | v1 | approved | owner | 2026-11-16 | "They pass" (with the tin/tar roof assignment) |

## 5. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/tex-water-harbour-grey-01/v1.png` | kept — approved |

## 6. Runtime

`public/assets/texture/tex-water-harbour-grey-01.webp`: 1024² WebP, both axes overlap-blended (10%) for a seamless tile, sha256 `e42e19e9aa77b41dd40c481160a90e3754dd332898e44e9a80615fbf970d6aee`. Source PNG `assets/source/texture/tex-water-harbour-grey-01/tex-water-harbour-grey-01.png`.
