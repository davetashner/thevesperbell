# tex-trim-wendmouth-shopfront-01

**Status: owner-approved image** (v1, approved 2026-11-16, "They look great"). From the `e37-asset-tex-harbour-prompts` set (plan/assets-harbor.json).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `tex-trim-wendmouth-shopfront-01` |
| Category | texture |
| Consuming bead(s) | `e37-asset-tex-harbour-integrate`; Wendmouth painted shopfronts (style bible §6.3 trims) |
| Template | `_templates/tileable-texture.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, plan plus, 2026-11-16, job `8bcb0715-5127-429a-8a9d-394f5158501a` |
| Reference inputs | approved `tex-planks-salt-bleached-01` (job `26cf2a8e-e811-445a-8553-761b2f2a87cd`) and `concept-wendmouth-stone-wharf-probe-01` (media `8c809b35-0b79-46df-8732-5cde83abc6ce`) |
| Staging copy | `assets/_incoming/tex-trim-wendmouth-shopfront-01/v1.png` (gitignored) |

## 2. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Seamless tileable texture, perfectly repeating on all four edges, top-down orthographic, flat even lighting with no directional shadows or highlights, no perspective, low contrast at the edges, no single standout feature, hand-painted stylized surface.

TRIM SHEET: a horizontal trim sheet for Wendmouth's painted timber shopfronts, made of five horizontal bands stacked top to bottom, each band tiling seamlessly left to right: 1. a turquoise painted moulded cornice board; 2. a sunflower-yellow painted fascia board with a simple raised border (blank, no lettering); 3. a coral painted board with simple scalloped edge; 4. a row of small square window muntins in dark tarred wood; 5. a weathered tarred plank skirting board with a pale glenstone kerb below.
REAL-WORLD SCALE: bands between 15 cm and 40 cm tall; the sheet repeats every 2 m.
COLOURS: turquoise #2E9AA0, sunflower #E8B83A, coral #D9674E, all flaked and sun-faded to show the wood #8A6440 beneath; tarred wood #2F2A28; glenstone #CDB89A; ink-violet #1E1B2E in the grooves.
SURFACE CHARACTER: broad painted boards with chunky bevelled mouldings, cheerful but worn paint, crisp band edges so each band can be cut out; absolutely no letters, signs, numbers or symbols.
Wendmouth palette: salt-grey glenstone #9C9788, harbour stone #7E8584, tarred plank #2F2A28, sea grey-green #5E7A7A, sail canvas #E6D9BC, net tan #B08A58.
REFERENCE IMAGES: the attached painted images are approved in-game textures and concepts for this harbour: match their brushwork, value range and palette.
```

## 3. Output spec

1536×512 (3:1, the generator's widest; 4:1 was refused) → 1024×256 trim, seamless left to right per band.

## 4. Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image | v1 | approved | owner | 2026-11-16 | "They look great" (session chat; `assets/approvals.json` does not exist yet) |

## 5. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-16 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/tex-trim-wendmouth-shopfront-01/v1.png` | approved — five bands, no lettering; turquoise/sunflower/coral flaked paint |

## 6. Files

Source `assets/source/texture/tex-trim-wendmouth-shopfront-01/tex-trim-wendmouth-shopfront-01.png` (sha256 `3fa44fc7dcedf4861a05447886ab63fd430fa31c9eac4396d99ee286bb771bac`). Runtime `public/assets/texture/tex-trim-wendmouth-shopfront-01.webp`: 1024×256 WebP trim, left-right overlap-blended (1/12); squashed from the 3:1 generate. sha256 `a6f0b7e08fbb1aedcc0790b34d5d12987e5d7c0277713e0f8c5c050d41779300`.
