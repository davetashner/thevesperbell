# tex-roof-tar-harbour-01

**Status: generated v1, awaiting owner approval** (2026-11-15). From the `e37-asset-tex-harbour-prompts` set (plan/assets-harbor.json).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `tex-roof-tar-harbour-01` |
| Category | texture |
| Consuming bead(s) | `e37-asset-tex-harbour-integrate`; Quiet net-loft roofs on the thief route (`e40-rooftops-net-lofts`); paired with the `wood` footstep surface (+2 dB). |
| Template | `_templates/tileable-texture.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 1:1, plan plus, 2026-11-15, job `c4ea19bc-1044-4287-b52a-219bc6eace9d` |
| Reference inputs | approved `tex-planks-salt-bleached-01` (job `26cf2a8e-e811-445a-8553-761b2f2a87cd`) and `concept-wendmouth-stone-wharf-probe-01` |
| Staging copy | `assets/_incoming/tex-roof-tar-harbour-01/v1.png` (gitignored) |

## 2. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Seamless tileable texture, perfectly repeating on all four edges, top-down orthographic, flat even lighting with no directional shadows or highlights, no perspective, low contrast at the edges, no single standout feature, hand-painted stylized surface.

MATERIAL: a quiet tarred-felt roof of the Wendmouth net lofts: broad soft strips of tarred felt laid in overlapping courses, seams sealed with thick tar, fixed with a few battens.
REAL-WORLD SCALE: one tile = 2 m × 2 m; strips about 50 cm wide.
COLOURS: tarred plank #2F2A28 to warm dark brown #3B322C, matte, with soft dusty grey #6E6A66 weathering on the ridges of each course.
SURFACE CHARACTER: soft, matte, low-contrast, rounded overlaps and no sharp ribs or shine, so it reads as quiet and soft at a glance and is clearly distinct from a ribbed tin roof even in greyscale.
WEAR: faint cracks in the tar, a little gull-white grime at the seams; no holes.
REFERENCE IMAGES: the attached painted images are approved in-game textures and concepts for this harbour: match their brushwork, value range and palette.
```

## 3. Output spec

1:1, 2k generate → seam repair → 1024² WebP runtime (KTX2 once `mw-e37.8` lands), seamless on both axes.

## 4. Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image | v1 | pending | owner | — | — |

## 5. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/tex-roof-tar-harbour-01/v1.png` | candidate — tiles cleanly in a 2×2 check |
