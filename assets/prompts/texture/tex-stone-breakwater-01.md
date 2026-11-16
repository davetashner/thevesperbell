# tex-stone-breakwater-01

**Status: owner-approved image** (v1, approved 2026-11-16). From the `e37-asset-tex-harbour-prompts` set (plan/assets-harbor.json).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `tex-stone-breakwater-01` |
| Category | texture |
| Consuming bead(s) | `e37-asset-tex-harbour-integrate`; Stone Wharf flagstones, the stepped quays, quay walls and the breakwater (`e40-stone-wharf`, `e40-breakwater-sea-door`). |
| Template | `_templates/tileable-texture.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 1:1, plan plus, 2026-11-15, job `fe9f9893-7774-4b54-8c53-12d08f483c90` |
| Reference inputs | approved `tex-planks-salt-bleached-01` (job `26cf2a8e-e811-445a-8553-761b2f2a87cd`) and `concept-wendmouth-stone-wharf-probe-01` |
| Staging copy | `assets/_incoming/tex-stone-breakwater-01/v1.png` (gitignored) |

## 2. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Seamless tileable texture, perfectly repeating on all four edges, top-down orthographic, flat even lighting with no directional shadows or highlights, no perspective, low contrast at the edges, no single standout feature, hand-painted stylized surface.

MATERIAL: salt-weathered glenstone harbour blocks for the Stone Wharf, the stepped quays and the breakwater: large rectangular dressed blocks laid in courses with staggered joints, edges worn round by centuries of hulls and feet; a few blocks carry a small chiselled mason's mark (a simple shape only — triangle, crossed square, circle with a line — never letters).
REAL-WORLD SCALE: one tile = 4 m × 4 m; blocks about 80–140 cm long and 50–70 cm high.
COLOURS: pale honey glenstone #CDB89A weathered toward salt-grey #9C9788, joints harbour stone #7E8584, faint salt bloom in parchment #EFE2C4.
SURFACE CHARACTER: broad painted shapes, soft value variation block to block, rounded worn edges, shallow painted ambient occlusion only in the joints.
WEAR: smooth hull-scraped patches, sparse dark damp seams; no moss focal point; marks small and spread so repetition does not show.
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
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/tex-stone-breakwater-01/v1.png` | kept — approved |

## 6. Runtime

`public/assets/texture/tex-stone-breakwater-01.webp`: 1024² WebP, both axes overlap-blended (10%) for a seamless tile, sha256 `eb045a397c9f5efdac8a179746a5c137b3ea63ef19e3fcf83963f69d2f3b8908`. Source PNG `assets/source/texture/tex-stone-breakwater-01/tex-stone-breakwater-01.png`.
