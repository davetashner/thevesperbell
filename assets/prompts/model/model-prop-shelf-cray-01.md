# model-prop-shelf-cray-01

**Status: owner-approved model** (turntable approved 2026-11-16, "Approved"); runtime file in place, not yet placed in the scene. Design approved on `prop-harbour-story-set-01` (owner, 2026-11-16, "They look great").

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Source | cropped from the approved sheet `assets/source/prop/prop-harbour-story-set-01/prop-harbour-story-set-01.png` (Cray's shelf (8)), padded on parchment to a square, uploaded as Higgsfield media `59565037-1d60-40c0-8ad5-5eb4e747283d` |

No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `c40793f3-1b2e-4ce8-9dc7-9e0fd7e573fa`; `face_limit` 5000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 4,438 triangles, 1 material, one 2048x2048 texture, bounds 0.57 × 1.2 × 0.98 (x × y × z, before placement scaling).
- Raw file: `assets/_incoming/model-prop-shelf-cray-01/v1.glb` (SHA-256 `ef1fd634eab28e5058556158495200e9be37bf25d69b697795bb7403bedec33a`), turntable `assets/_incoming/model-prop-shelf-cray-01/v1-turntable.png`.

## Use in the level

Inspector Cray's well-read shelf: ledgers in front, romances below. Budget: medium 400–2 k tris, one prop atlas, one material per set (style bible §13.2); decimated at processing.

## Processing

1. `npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-shelf-cray-01/v1.glb public/assets/model/model-prop-shelf-cray-01.glb --texture-size 512`
   → 86 KB, one 512² texture, meshopt-compressed (SHA-256 `016aa841e649e58bbfb4d66b125c7d19cb632e3ab44adc8879c773e5d715eea4`).
2. Placement waits for the interior beads (Bonded Warehouse, Customs House, breakwater).

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner | 2026-11-16 | via `prop-harbour-story-set-01` |
| turntable | v1 | approved | owner | 2026-11-16 | "Approved" (session chat; `assets/approvals.json` does not exist yet) |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added 2026-11-16 (`placeholder: yes` until `assets/approvals.json` exists).
