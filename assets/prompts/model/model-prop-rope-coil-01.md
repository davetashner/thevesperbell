# model-prop-rope-coil-01: rope coil for the Wendmouth waterfront and the Gilded Tern

**Status: generated v1, turntable awaiting owner approval** (2026-11-15). Design approved on the sheet `prop-harbour-rope-net-set-01` (owner, 2026-11-15, "They all look great!").

## Single-prop image (input to image-to-3D)

| Field | Value |
|---|---|
| Image id | `prop-rope-coil-01` |
| Source design | prop 1 of `assets/source/prop/prop-harbour-rope-net-set-01/prop-harbour-rope-net-set-01.png` (Higgsfield job `f5ae8a00-dab0-4eba-8a1d-9ca3d25ebdde`), passed as the reference |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 1:1, plan plus, 2026-11-15, job `f1584bfe-b398-423a-9b35-991c09de27f4` |
| Staging copy | `assets/_incoming/prop-rope-coil-01/v1.png` (gitignored) |

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Single prop for image-to-3D: one object only, centred, the whole object in frame with generous margin, front three-quarter view from slightly above, plain flat parchment (#EFE2C4) background, even soft lighting, only a faint contact shadow, no other objects, no human figure, no scale bar, no text.

SUBJECT: reproduce prop 1 from the attached approved prop sheet exactly — the flat spiral coil of tan hemp rope lying on the ground. Keep its shape, proportions, colours, materials, hardware and legibility cues identical to the sheet; do not redesign it. About 0.25 m tall in the world.
```

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-15, 9 credits. Job `372522a6-563f-4221-826d-6941617522dc`;
  `face_limit` 1500, `texture` true, `pbr` false, `auto_size` true (same settings as `model-prop-chest-wooden-01`).
- Raw result: 1,423 triangles, 1 material, one 2048x2048 base-colour texture,
  bounds 3.94 × 1 × 3.88 m (x × y × z). Target height in the world about 0.25 m:
  `auto_size` is not reliable for these props, so the loader scales to the target height as it does for the chest.
- Raw file: `assets/_incoming/model-prop-rope-coil-01/v1.glb` (SHA-256 `a5b399a9f6f63415763f2cac97963cd5429b3f7a7c86692df94dee80f2f3890c`), turntable `assets/_incoming/model-prop-rope-coil-01/v1-turntable.png`
  (four views, three.js headless render on parchment).

## Processing (after turntable approval)

1. `gltf-transform optimize … --texture-size 512` → `public/assets/model/model-prop-rope-coil-01.glb` (the tool is not installed in the
   repo; see the session notes).
2. Load-time placement (scale to 0.25 m, facing) when the harbour props are wired.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner | 2026-11-15 | via `prop-harbour-rope-net-set-01` |
| turntable | v1 | pending | owner | — | — |

## Licence

Higgsfield Plus (Terms of Use §4.4: the user owns Outputs, commercial use and sublicensing allowed); Tripo's own
terms confirmed by the owner on 2026-10-24 (mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added when the
turntable is approved and the runtime file lands.
