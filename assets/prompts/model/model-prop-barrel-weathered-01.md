# model-prop-barrel-weathered-01: barrel weathered for the Wendmouth waterfront and the Gilded Tern

**Status: owner-approved model** (turntable approved 2026-11-15, "They pass"); runtime file in place, not yet placed in a scene. Design approved on the sheet `prop-harbour-cask-set-01` (owner, 2026-11-15, "They all look great!").

## Single-prop image (input to image-to-3D)

| Field | Value |
|---|---|
| Image id | `prop-barrel-weathered-01` |
| Source design | prop 1 of `assets/source/prop/prop-harbour-cask-set-01/prop-harbour-cask-set-01.png` (Higgsfield job `a96511e4-7938-4204-b3c9-6b7f08462886`), passed as the reference |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 1:1, plan plus, 2026-11-15, job `9b1aedd5-269d-40fb-84c7-d77469ebc13a` |
| Staging copy | `assets/_incoming/prop-barrel-weathered-01/v1.png` (gitignored) |

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Single prop for image-to-3D: one object only, centred, the whole object in frame with generous margin, front three-quarter view from slightly above, plain flat parchment (#EFE2C4) background, even soft lighting, only a faint contact shadow, no other objects, no human figure, no scale bar, no text.

SUBJECT: reproduce prop 1 from the attached approved prop sheet exactly — the tall sea-weathered silver-grey oak barrel with thick dark iron hoops and the flat spiral coil of tan hemp rope on its lid. Keep its shape, proportions, colours, materials, hardware and legibility cues identical to the sheet; do not redesign it. About 0.95 m tall in the world.
```

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-15, 9 credits. Job `8eab6fcf-86d8-47ea-bf99-d2c6a06fa982`;
  `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true (same settings as `model-prop-chest-wooden-01`).
- Raw result: 1,877 triangles, 1 material, one 2048x2048 base-colour texture,
  bounds 0.62 × 0.85 × 0.61 m (x × y × z). Target height in the world about 0.95 m:
  `auto_size` is not reliable for these props, so the loader scales to the target height as it does for the chest.
- Raw file: `assets/_incoming/model-prop-barrel-weathered-01/v1.glb` (SHA-256 `cd10cb0661157ee489c7ba7e0abed7917dc4932f41bba2cf98396784d8bea2f8`), turntable `assets/_incoming/model-prop-barrel-weathered-01/v1-turntable.png`
  (four views, three.js headless render on parchment).

## Processing

1. `npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-barrel-weathered-01/v1.glb public/assets/model/model-prop-barrel-weathered-01.glb --texture-size 512`
   → 62 KB, 1,841 triangles, one material, one 512² texture (meshopt-compressed; SHA-256 `45dd0bf32b84e6ce467986313bc0e2e6cdbee31443868aa833d9f90cc57f5402`).
   Checked by loading it in three.js with the meshopt decoder and rendering the four views again.
2. Load-time placement (scale to 0.95 m, facing) when the harbour props are wired.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner | 2026-11-15 | via `prop-harbour-cask-set-01` |
| turntable | v1 | approved | owner | 2026-11-15 | "They pass" (session chat; `assets/approvals.json` does not exist yet) |

## Licence

Higgsfield Plus (Terms of Use §4.4: the user owns Outputs, commercial use and sublicensing allowed); Tripo's own
terms confirmed by the owner on 2026-10-24 (mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added 2026-11-15
(`placeholder: yes`, as for the chest, until `assets/approvals.json` exists).
