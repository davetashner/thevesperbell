# model-prop-hawser-coil-01: hawser coil for the Wendmouth waterfront and the Gilded Tern

**Status: owner-approved model** (turntable approved 2026-11-15, "They pass"); runtime file in place, not yet placed in a scene. Design approved on the sheet `prop-harbour-rope-net-set-01` (owner, 2026-11-15, "They all look great!").

## Single-prop image (input to image-to-3D)

| Field | Value |
|---|---|
| Image id | `prop-hawser-coil-01` |
| Source design | prop 3 of `assets/source/prop/prop-harbour-rope-net-set-01/prop-harbour-rope-net-set-01.png` (Higgsfield job `f5ae8a00-dab0-4eba-8a1d-9ca3d25ebdde`), passed as the reference |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 1:1, plan plus, 2026-11-15, job `8e9b58a3-a22f-45af-8890-40c08b72d4fe` |
| Staging copy | `assets/_incoming/prop-hawser-coil-01/v1.png` (gitignored) |

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Single prop for image-to-3D: one object only, centred, the whole object in frame with generous margin, front three-quarter view from slightly above, plain flat parchment (#EFE2C4) background, even soft lighting, only a faint contact shadow, no other objects, no human figure, no scale bar, no text.

SUBJECT: reproduce prop 3 from the attached approved prop sheet exactly — the heavy coil of tarred black-brown hawser with the spliced iron thimble eye. Keep its shape, proportions, colours, materials, hardware and legibility cues identical to the sheet; do not redesign it. About 0.45 m tall in the world.
```

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-15, 9 credits. Job `78f64223-318b-4590-ac4c-6153e08244c4`;
  `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true (same settings as `model-prop-chest-wooden-01`).
- Raw result: 1,900 triangles, 1 material, one 2048x2048 base-colour texture,
  bounds 2.4 × 1 × 1.95 m (x × y × z). Target height in the world about 0.45 m:
  `auto_size` is not reliable for these props, so the loader scales to the target height as it does for the chest.
- Raw file: `assets/_incoming/model-prop-hawser-coil-01/v1.glb` (SHA-256 `ef0c66cb145b00e9016ebdbe69fd89663fe9831ff6dca8d49f058d3be55cadd9`), turntable `assets/_incoming/model-prop-hawser-coil-01/v1-turntable.png`
  (four views, three.js headless render on parchment).

## Processing

1. `npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-hawser-coil-01/v1.glb public/assets/model/model-prop-hawser-coil-01.glb --texture-size 512`
   → 46 KB, 1,878 triangles, one material, one 512² texture (meshopt-compressed; SHA-256 `4d49002a727288820f6ee513b566325e7e7b7555819b99c62ff041b8d7aef7a0`).
   Checked by loading it in three.js with the meshopt decoder and rendering the four views again.
2. Load-time placement (scale to 0.45 m, facing) when the harbour props are wired.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner | 2026-11-15 | via `prop-harbour-rope-net-set-01` |
| turntable | v1 | approved | owner | 2026-11-15 | "They pass" (session chat; `assets/approvals.json` does not exist yet) |

## Licence

Higgsfield Plus (Terms of Use §4.4: the user owns Outputs, commercial use and sublicensing allowed); Tripo's own
terms confirmed by the owner on 2026-10-24 (mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added 2026-11-15
(`placeholder: yes`, as for the chest, until `assets/approvals.json` exists).
