# model-prop-ditty-box-01: ditty box for the Wendmouth waterfront and the Gilded Tern

**Status: owner-approved model** (turntable approved 2026-11-15, "They pass"); runtime file in place, not yet placed in a scene. Design approved on the sheet `prop-harbour-sea-chest-set-01` (owner, 2026-11-15, "They all look great!").

## Single-prop image (input to image-to-3D)

| Field | Value |
|---|---|
| Image id | `prop-ditty-box-01` |
| Source design | prop 4 of `assets/source/prop/prop-harbour-sea-chest-set-01/prop-harbour-sea-chest-set-01.png` (Higgsfield job `0c21ccbd-a107-4ede-a238-4d2dd84bb916`), passed as the reference |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 1:1, plan plus, 2026-11-15, job `025f3d9d-91b8-48c3-b671-92ad07e45972` |
| Staging copy | `assets/_incoming/prop-ditty-box-01/v1.png` (gitignored) |

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Single prop for image-to-3D: one object only, centred, the whole object in frame with generous margin, front three-quarter view from slightly above, plain flat parchment (#EFE2C4) background, even soft lighting, only a faint contact shadow, no other objects, no human figure, no scale bar, no text.

SUBJECT: reproduce prop 4 from the attached approved prop sheet exactly — the smaller ditty box with a brass keyhole plate, closed. Keep its shape, proportions, colours, materials, hardware and legibility cues identical to the sheet; do not redesign it. About 0.35 m tall in the world.
```

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-15, 9 credits. Job `1f49a97f-2c02-42f4-aed9-d378aa626999`;
  `face_limit` 1500, `texture` true, `pbr` false, `auto_size` true (same settings as `model-prop-chest-wooden-01`).
- Raw result: 1,332 triangles, 1 material, one 2048x2048 base-colour texture,
  bounds 0.32 × 0.35 × 0.47 m (x × y × z). Target height in the world about 0.35 m:
  `auto_size` is not reliable for these props, so the loader scales to the target height as it does for the chest.
- Raw file: `assets/_incoming/model-prop-ditty-box-01/v1.glb` (SHA-256 `6220b180da0b83c6c9791e0ae6292d527fcbd59e1ee9576620b263eec94309da`), turntable `assets/_incoming/model-prop-ditty-box-01/v1-turntable.png`
  (four views, three.js headless render on parchment).

## Processing

1. `npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-ditty-box-01/v1.glb public/assets/model/model-prop-ditty-box-01.glb --texture-size 512`
   → 49 KB, 1,318 triangles, one material, one 512² texture (meshopt-compressed; SHA-256 `99dfba4e5d16945bdfc169909110ee83cf51e04e0d2fceac3774ce758f8e472f`).
   Checked by loading it in three.js with the meshopt decoder and rendering the four views again.
2. Load-time placement (scale to 0.35 m, facing) when the harbour props are wired.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner | 2026-11-15 | via `prop-harbour-sea-chest-set-01` |
| turntable | v1 | approved | owner | 2026-11-15 | "They pass" (session chat; `assets/approvals.json` does not exist yet) |

## Licence

Higgsfield Plus (Terms of Use §4.4: the user owns Outputs, commercial use and sublicensing allowed); Tripo's own
terms confirmed by the owner on 2026-10-24 (mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added 2026-11-15
(`placeholder: yes`, as for the chest, until `assets/approvals.json` exists).
