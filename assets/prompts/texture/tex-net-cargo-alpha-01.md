# tex-net-cargo-alpha-01

**Status: owner-approved image** (v1, approved 2026-11-16, "They look great"). From the `e37-asset-tex-harbour-prompts` set (plan/assets-harbor.json).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `tex-net-cargo-alpha-01` |
| Category | texture |
| Consuming bead(s) | `e37-asset-tex-harbour-integrate`; taut climbable wall and rigging nets (style bible §5.4), `e40-rooftops-net-lofts` |
| Template | `_templates/tileable-texture.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, plan plus, 2026-11-16, job `cf663cf6-0a80-4a0f-80ee-ee393caf72b1` |
| Reference inputs | approved `tex-planks-salt-bleached-01` (job `26cf2a8e-e811-445a-8553-761b2f2a87cd`) and `concept-wendmouth-stone-wharf-probe-01` (media `8c809b35-0b79-46df-8732-5cde83abc6ce`) |
| Staging copy | `assets/_incoming/tex-net-cargo-alpha-01/v1.png` (gitignored) |

## 2. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Seamless tileable texture, perfectly repeating on all four edges, top-down orthographic, flat even lighting with no directional shadows or highlights, no perspective, low contrast at the edges, no single standout feature, hand-painted stylized surface.

MATERIAL: a taut climbable cargo net seen flat-on, a square mesh of thick tan hemp rope with chunky pale knots at every crossing, pulled tight and straight so it reads as something you can climb (style bible §5.4: climbable nets hang taut and flat).
REAL-WORLD SCALE: one tile = 1 m × 1 m; mesh squares about 25 cm, rope about 3 cm thick.
COLOURS: hemp tan #B08A58 with highlights #C9A66B and shadow #5A3E2B; knots pale worn #D9C38A (the climbable cue); nothing else.
SURFACE CHARACTER: broad painted twisted rope, straight taut lines, every knot the same size; the holes between ropes are fully transparent (alpha), with no background at all.
REFERENCE IMAGES: the attached painted images are approved in-game textures and concepts for this harbour: match their brushwork, value range and palette.
```

## 3. Output spec

1:1, 2k with a transparent background → 1024² RGBA WebP (alpha cut-out), seamless both axes.

## 4. Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image | v1 | approved | owner | 2026-11-16 | "They look great" (session chat; `assets/approvals.json` does not exist yet) |

## 5. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-16 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/tex-net-cargo-alpha-01/v1.png` | approved — true alpha; taut square mesh with pale knots; one doubled line at the tile seam to remove in seam repair |

## 6. Files

Source `assets/source/texture/tex-net-cargo-alpha-01/tex-net-cargo-alpha-01.png` (sha256 `8e58acdb7e8075dee7ba3dbdfba411288f022ccb2b11570675c1a7f5f441ce3c`). Runtime `public/assets/texture/tex-net-cargo-alpha-01.webp`: 1024² RGBA WebP: cropped to three whole mesh periods (ropes on the same pitch across the seam), then a 24 px overlap blend; alpha kept for cut-out. sha256 `2ae276f1bc58c64e6a169f169200f23e951d560bf9d9a56dfad005b1bc9ca286`.
