# model-prop-tern-figurehead-01: the Gilded Tern — the figurehead under the bowsprit at the bow (z 106)

**Status: generated v1, turntable awaiting owner approval** (2026-11-15). Design approved on `prop-ship-gilded-tern-01` v3 (owner, 2026-11-15).

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Image id | `prop-tern-figurehead-01` |
| Source | Higgsfield `gpt_image_2_6`, quality high, 2k, 1:1, plan plus, 2026-11-15, job `941f5dbc-c5d0-4ab8-ae8b-1c21ac39746c`, with the approved v3 sheet (job `6763240f-1ca4-473c-b831-39cde6ba8d2d`) as the reference |
| Staging copy | `assets/_incoming/prop-tern-figurehead-01/v1.png` (gitignored) |

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Single prop for image-to-3D: one object only, centred, the whole object in frame with generous margin, three-quarter view from slightly above, plain flat parchment (#EFE2C4) background, even soft lighting, only a faint contact shadow, no other objects, no water, no human figure, no scale bar, no text.

SUBJECT: reproduce the gilded tern figurehead from the attached approved design sheet (view 5): a carved tern with swept-back wings and a curling scroll base on its mounting plate, gilt #C9A042 worn to bare wood at the edges. Keep its shape, proportions, colours, materials and legibility cues identical to the sheet; do not redesign it.
```

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-15, 9 credits. Job `4b854e23-787a-44ed-b735-01176548f1a6`;
  `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,888 triangles, 1 material, one 2048x2048 texture, bounds 0.28 × 0.3 × 0.3 (x × y × z, before placement scaling).
- Raw file: `assets/_incoming/model-prop-tern-figurehead-01/v1.glb` (SHA-256 `bf18768d2c5113ae54e8a442ad13796f816cfaddfdd6c140109bb9ccc9c56772`), turntable `assets/_incoming/model-prop-tern-figurehead-01/v1-turntable.png`.
- Notes: Clean silhouette; gilt worn to wood.

## Use in the level

The figurehead under the bowsprit at the bow (z 106). Budget: modular ship pieces ≤ 5 k triangles each, one material (style bible §13.2, §5.6).

## Processing (after turntable approval)

1. `npx @gltf-transform/cli@4.5.1 optimize … --texture-size 512` (1024 for the hull, a hero piece) → `public/assets/model/model-prop-tern-figurehead-01.glb`.
2. Placement and scale in the harbour scene with the Gilded Tern integration.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v3 | approved | owner | 2026-11-15 | via `prop-ship-gilded-tern-01` |
| turntable | v1 | pending | owner | — | — |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added on approval.
