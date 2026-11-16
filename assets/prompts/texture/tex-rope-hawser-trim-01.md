# tex-rope-hawser-trim-01

**Status: owner-approved image** (v1, approved 2026-11-16, "They look great"). From the `e37-asset-tex-harbour-prompts` set (plan/assets-harbor.json).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `tex-rope-hawser-trim-01` |
| Category | texture |
| Consuming bead(s) | `e37-asset-tex-harbour-integrate`; hawsers, mooring lines, rigging wraps (climbable rope-wrap and cuttable cut-point bands, style bible §7) |
| Template | `_templates/tileable-texture.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, plan plus, 2026-11-16, job `6912a6fa-a0bd-478a-bf7c-21a5d6b5c83c` |
| Reference inputs | approved `tex-planks-salt-bleached-01` (job `26cf2a8e-e811-445a-8553-761b2f2a87cd`) and `concept-wendmouth-stone-wharf-probe-01` (media `8c809b35-0b79-46df-8732-5cde83abc6ce`) |
| Staging copy | `assets/_incoming/tex-rope-hawser-trim-01/v1.png` (gitignored) |

## 2. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Seamless tileable texture, perfectly repeating on all four edges, top-down orthographic, flat even lighting with no directional shadows or highlights, no perspective, low contrast at the edges, no single standout feature, hand-painted stylized surface.

TRIM STRIP: a horizontal trim strip, 3:1, made of four equal horizontal bands stacked top to bottom, each band tiling seamlessly left to right: 1. one thick tarred hawser rope (three twisted strands) lying straight along the band; 2. one thinner tan hemp rope lying straight; 3. a tan hemp rope with a pale knotted rope wrap every 50 cm (the climbable rope-wrap cue); 4. a tan hemp rope with one red-and-cream painted ring wrap band (the mechanism-for-arrows cut-point cue).
REAL-WORLD SCALE: each band is 25 cm tall; the strip repeats every 2 m.
COLOURS: tarred hawser #2F2A28 with #5A3E2B strand highlights; hemp tan #B08A58 to #C9A66B; knotted handhold wraps pale #D9C38A; cut-point band red #C8553D and cream #EFE2C4; gaps between bands flat ink-violet #1E1B2E.
SURFACE CHARACTER: broad painted twisted strands with soft rounded highlights, no fibres or fuzz detail, ropes centred in each band, consistent thickness along the band.
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
| 1 | 2026-11-16 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/tex-rope-hawser-trim-01/v1.png` | approved — four bands read clearly; climbable wraps pale, cut-point band red-cream |

## 6. Files

Source `assets/source/texture/tex-rope-hawser-trim-01/tex-rope-hawser-trim-01.png` (sha256 `f4448d903b110142060e15a6523bdb1dddbe844aa266add0600abd19f81feda6`). Runtime `public/assets/texture/tex-rope-hawser-trim-01.webp`: 1024×256 WebP trim, left-right overlap-blended (1/12); squashed from the 3:1 generate. sha256 `c9783b52c38531dc2d3b939807cdf18e023f69ddb8424dd088e8b891641fd957`.
