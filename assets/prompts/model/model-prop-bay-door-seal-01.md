# model-prop-bay-door-seal-01

**Status: owner-approved model** (turntable approved 2026-11-16, "Approved"); runtime file in place, not yet placed in the scene. Design approved on `prop-harbour-story-set-01` (owner, 2026-11-16, "They look great").

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Source | cropped from the approved sheet `assets/source/prop/prop-harbour-story-set-01/prop-harbour-story-set-01.png` (the intact state (door 1)), padded on parchment to a square, uploaded as Higgsfield media `a0c9b71b-f2ba-4ecf-8297-396549b9d991` |

No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `3a3cbdbc-1345-4e53-91c1-0d406c3a1c1e`; `face_limit` 5000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 4,759 triangles, 1 material, one 2048x2048 texture, bounds 0.49 × 2.1 × 1.5 (x × y × z, before placement scaling).
- Raw file: `assets/_incoming/model-prop-bay-door-seal-01/v1.glb` (SHA-256 `b8ac2daf5d2ade3454360793d22bb122b3f68930ae679907a9b0f04b7a60e356`), turntable `assets/_incoming/model-prop-bay-door-seal-01/v1-turntable.png`.

## Use in the level

Bay nine's plank door with the customs seal; the broken and re-sealed states are swaps of the seal and cord, to be cut from this model or modelled as small seal pieces at integration. Budget: medium 400–2 k (≤ 5 k raw) tris, one prop atlas, one material per set (style bible §13.2); decimated at processing.

## Processing

1. `npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-bay-door-seal-01/v1.glb public/assets/model/model-prop-bay-door-seal-01.glb --texture-size 512`
   → 83 KB, one 512² texture, meshopt-compressed (SHA-256 `4fa4122010a11cecc65e2aef2a6e7f56a2cc07537ffd99790b0de1096cc1d3c7`).
2. Placement waits for the interior beads (Bonded Warehouse, Customs House, breakwater).

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner | 2026-11-16 | via `prop-harbour-story-set-01` |
| turntable | v1 | approved | owner | 2026-11-16 | "Approved" (session chat; `assets/approvals.json` does not exist yet) |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added 2026-11-16 (`placeholder: yes` until `assets/approvals.json` exists).
