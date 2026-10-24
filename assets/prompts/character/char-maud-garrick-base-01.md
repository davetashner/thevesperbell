# char-maud-garrick-base-01: turnaround reference for Sergeant Maud Garrick, the fighting instructor. Source for the placeholder college model.

**Status: candidates, awaiting owner approval** (owner pre-approved Higgsfield placeholder assets on 2026-10-24; no approvals file has landed yet, so none is recorded). Two variants (a, b) were generated; variant **a** was modelled (`model-npc-garrick-01`, see `assets/prompts/model/model-npc-bodies-01.md`).

| Field | Value |
|---|---|
| Asset id | `char-maud-garrick-base-01` |
| Category | character (turnaround sheet; the front view is cropped for image-to-3D, see the model note) |
| Template | `_templates/character-reference-sheet.md` v1 |
| Tool | Higgsfield `gpt_image_2_5`, text only, 16:9, 2 variants, 2026-10-24, about 0.25 credits each |
| Variant jobs | a `bf5dcdfb-1130-438e-b95c-62c64b469403`, b `480e57ea-b4d2-4d70-b51d-82d7179aafd0` |
| Local files | `assets/_incoming/char-maud-garrick-base-01/{a,b}.png` (gitignored) |
| Canon | story bible §5.16 |
| Consuming bead | mw-ju8.13 |

## Prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Character turnaround sheet: front, three-quarter, side and back views of the same character in a neutral A-pose, full body, identical proportions and colours in every view, evenly lit, plain flat parchment (#EFE2C4) background, no cast shadows, orthographic feel, no perspective distortion.

SUBJECT: Sergeant Maud Garrick, a stout, broad-shouldered woman in her fifties, a retired garrison drill sergeant, short grey hair cropped close, a weathered scarred face with a stern but fair expression, a faded brick-red wool tabard over a worn quilted gambeson and mail sleeves, a leather belt, sturdy boots; arms empty, hands open, nothing held.
```

## Consistency checklist

- [x] Preamble and character-sheet add-on pasted verbatim (extracted from the bible, not retyped)
- [x] Palette from the bible; plain parchment background; A-pose; hands empty
- [x] No text, logos, gore
