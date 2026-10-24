# char-hollis-pell-base-01: turnaround reference for Hollis Pell, the baker. Source for the placeholder town model.

**Status: candidates, awaiting owner approval** (the NPC art approval bead filed with mw-ju8.34). Two variants
(a, b) were generated; variant **b** was modelled (`model-npc-hollis-01`, see
`assets/prompts/model/model-npc-bodies-01.md`).

| Field | Value |
|---|---|
| Asset id | `char-hollis-pell-base-01` |
| Category | character (turnaround sheet; the front view is cropped for image-to-3D, see the model note) |
| Template | `_templates/character-reference-sheet.md` v1 |
| Tool | Higgsfield `gpt_image_2_5`, text only, 16:9, 2 variants, 2026-10-24, about 0.25 credits each |
| Variant jobs | a `557a7175-54e8-4ce9-8fed-294841383a15`, b `287209f8-f004-4052-b73e-33ccbc1cc3a9` |
| Local files | `assets/_incoming/char-hollis-pell-base-01/{a,b}.png` (gitignored) |
| Canon | story bible 5.5 |
| Consuming bead | mw-ju8.34 |

## Prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Character turnaround sheet: front, three-quarter, side and back views of the same character in a neutral A-pose, full body, identical proportions and colours in every view, evenly lit, plain flat parchment (#EFE2C4) background, no cast shadows, orthographic feel, no perspective distortion.

SUBJECT: Hollis Pell, a big, broad, gentle middle-aged village baker man, widower, large flour-dusted hands and forearms, short tousled brown hair, soft tired kind face, rolled sleeves, a cream linen shirt, a long flour-stained white apron over brown trousers, sturdy boots; arms empty, hands open, nothing held.
```

## Consistency checklist

- [x] Preamble and character-sheet add-on pasted verbatim (extracted from the bible, not retyped)
- [x] Palette from the bible; plain parchment background; A-pose; hands empty
- [x] No text, logos, gore
