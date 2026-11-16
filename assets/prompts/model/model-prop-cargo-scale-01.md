# model-prop-cargo-scale-01

**Status: owner-approved model** (turntable approved 2026-11-16, "Approved"); runtime file in place, not yet placed in the scene. Design approved on `prop-harbour-story-set-01` (owner, 2026-11-16, "They look great").

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Source | cropped from the approved sheet `assets/source/prop/prop-harbour-story-set-01/prop-harbour-story-set-01.png` (the customs scale with its weights (6)), padded on parchment to a square, uploaded as Higgsfield media `7e7f4324-d280-4d24-b4ad-b22a536158e6` |

No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `4afb51f5-888d-425f-ada2-de778233f1f1`; `face_limit` 5000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 4,874 triangles, 1 material, one 2048x2048 texture, bounds 0.33 × 0.65 × 0.65 (x × y × z, before placement scaling).
- Raw file: `assets/_incoming/model-prop-cargo-scale-01/v1.glb` (SHA-256 `8db97a681f5cbc1585455c307ca7bc8412f61ee6511d444709558e11323f0890`), turntable `assets/_incoming/model-prop-cargo-scale-01/v1-turntable.png`.

## Use in the level

The Customs House cargo scale. Budget: medium 400–2 k tris, one prop atlas, one material per set (style bible §13.2); decimated at processing.

## Processing

1. `npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-cargo-scale-01/v1.glb public/assets/model/model-prop-cargo-scale-01.glb --texture-size 512`
   → 83 KB, one 512² texture, meshopt-compressed (SHA-256 `8a32d6e598710c0e192dd480681159774fb6897ea11a61f3c36b71de8af5fe71`).
2. Placement waits for the interior beads (Bonded Warehouse, Customs House, breakwater).

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner | 2026-11-16 | via `prop-harbour-story-set-01` |
| turntable | v1 | approved | owner | 2026-11-16 | "Approved" (session chat; `assets/approvals.json` does not exist yet) |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added 2026-11-16 (`placeholder: yes` until `assets/approvals.json` exists).
