# model-ship-gilded-tern-rigging-01: the Gilded Tern — one mast module

**Status: owner-approved model** (turntable approved 2026-11-15, "They look good"); runtime file in place, not yet placed in the scene. Design approved on `prop-ship-gilded-tern-01` v3 (owner, 2026-11-15).

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Image id | `prop-ship-gilded-tern-mast-01` |
| Source | Higgsfield `gpt_image_2_6`, quality high, 2k, 1:1, plan plus, 2026-11-15, job `26c57ef5-9b93-4e60-a9f1-5d1e4705568b`, with the approved v3 sheet (job `6763240f-1ca4-473c-b831-39cde6ba8d2d`) as the reference |
| Staging copy | `assets/_incoming/prop-ship-gilded-tern-mast-01/v1.png` (gitignored) |

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Single prop for image-to-3D: one object only, centred, the whole object in frame with generous margin, three-quarter view from slightly above, plain flat parchment (#EFE2C4) background, even soft lighting, only a faint contact shadow, no other objects, no water, no human figure, no scale bar, no text.

SUBJECT: reproduce one mast module from the attached approved design sheet (view 4): the honey-varnished mast with iron bands, two yards with furled cream sails, the round fighting top ringed with wooden mantlet shield boards, and its shrouds with ratlines spreading down to a pair of deadeye chain plates at the foot, one on each side. The ratlines carry pale worn knotted handholds #D9C38A. No hull, no springald. Keep its shape, proportions, colours, materials and legibility cues identical to the sheet; do not redesign it.
```

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-15, 9 credits. Job `b5f0ab68-6109-497d-9603-f685386ba370`;
  `face_limit` 4000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 3,766 triangles, 1 material, one 2048x2048 texture, bounds 0.64 × 2.5 × 1.59 (x × y × z, before placement scaling).
- Raw file: `assets/_incoming/model-ship-gilded-tern-rigging-01/v1.glb` (SHA-256 `becd6dd0bd2c7236bb89cad85daef55392a0d8814b68cc8a0e3d46545109d57e`), turntable `assets/_incoming/model-ship-gilded-tern-rigging-01/v1-turntable.png`.
- Notes: Ratlines read as climbable; the mantlets are a banded ring on the top rather than separate boards.

## Use in the level

One mast module, used at the mast steps (pillars at z 124 and 136, plus the foremast); the crow's nest about 10 m above the deck. Budget: modular ship pieces ≤ 5 k triangles each, one material (style bible §13.2, §5.6).

## Processing

1. `npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-ship-gilded-tern-rigging-01/v1.glb public/assets/model/model-ship-gilded-tern-rigging-01.glb --texture-size 512`
   → 93 KB, one 512² texture, meshopt-compressed (SHA-256 `de5dfc244c841a199c2133885989ecd0eca2e877e87a51ee33f6c5b36825bdf1`).
2. Placement and scale in the harbour scene with the Gilded Tern integration.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v3 | approved | owner | 2026-11-15 | via `prop-ship-gilded-tern-01` |
| turntable | v1 | approved | owner | 2026-11-15 | "They look good" (session chat; `assets/approvals.json` does not exist yet) |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added 2026-11-15 (`placeholder: yes` until `assets/approvals.json` exists).
