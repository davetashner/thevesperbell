# char-npc-reed-01: Turnaround reference for reed lock keeper (the input to `model-npc-reed-01`).

**Status: owner-approved concept** (v1, approved 2026-11-16). From `e37-asset-npcs-harbour-named-concept-prompts` (plan/assets-harbor.json). Must match the approved portrait `portrait-npc-reed-lock-keeper`.

| Field | Value |
|---|---|
| Asset id | `char-npc-reed-01` |
| Category | character |
| Template | `_templates/character-reference-sheet.md` v1 |
| Consuming bead(s) | `e37-asset-npcs-harbour-named-3d-generate` → `model-npc-reed-01` |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 3:2, plan plus, 2026-11-16, job `2701c431-fcc0-48a0-91f5-29dc5336464e` |
| Reference inputs | approved portrait `portrait-npc-reed-lock-keeper` (Higgsfield media `4630dc32-e546-4ffc-823a-5081343e8c59`); approved turnaround `char-ottilie-marsh-base-01` (media `c3c08339-4b44-4eff-a0af-be0b72cf441c`) for layout and finish only |
| Staging copy | `assets/_incoming/char-npc-reed-01/v1.png` (gitignored) |

## Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Character turnaround sheet: front, three-quarter, side and back views of the same character in a neutral A-pose, full body, identical proportions and colours in every view, evenly lit, plain flat parchment (#EFE2C4) background, no cast shadows, orthographic feel, no perspective distortion.

SUBJECT: Old Reed, keeper of Kestrel Lock: lean and slightly stooped old man, about 1.7 m, long patient face, white stubble, flat cap; moss-green waistcoat over a collarless shirt, rolled sleeves, corduroy trousers, gaiters and old boots; a brass windlass key hanging from his BELT (not round his neck), a clay mug of tea in one hand. Silhouette hook: flat cap and the windlass key at the hip.
SHEET: four full-body views left to right (front, three-quarter, side, back), feet flat on the same ground line, arms slightly away from the body, nothing held across the body that hides the torso, a faint 1.8 m height line at the left edge for scale. Budget note for the modeller: key NPC, 4–7 k triangles, one material.
REFERENCE IMAGES: the first attached image is this character's approved dialogue portrait: the face, hair, colours and costume must match it exactly, so the character is recognisable against the portrait at 10 m. The second attached image is an approved turnaround sheet from this game: match its layout, proportions, brushwork and finish only (not that character's face or clothes).
```

## Model output spec

Key NPC: 4–7 k triangles, LOD1 50 %, T1–T2 atlas, 1 material, ≤ 65 bones on the canonical humanoid rig (style bible §13.2). Flat front-facing views on parchment for the image-to-3D flow.

## Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | approved | owner | 2026-11-16 | "They look good, I don't mind the key" (session chat; `assets/approvals.json` does not exist yet) |

## Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-16 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/char-npc-reed-01/v1.png` | approved — flat cap, mug of tea, moss waistcoat; the windlass key on the belt still reads as a cross |

## Output

`assets/source/character/char-npc-reed-01/char-npc-reed-01.png` (v1, 2048×1360, SHA-256 `cc2a621123e37b85a9f4ca0adb37cd11c9710f7fa4d995ffedc57a1ca0e70327`).
