# model-prop-weir-sluice-gate-01

**Status: approved model** (2026-11-25; Claude, delegated by owner 2026-11-07; Claude passed the turntable gate). Bead `mw-e37.434`.

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-river-quay-weir-set-01/prop-river-quay-weir-set-01.png` with `scripts/assets/crop-cli.ts` (largest shape kept, padded square on parchment); Higgsfield media `243811b8-91b9-41ff-9869-b466ca222414`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-25, 9 credits. Job `15eedb68-e710-4b1c-9a5c-88938f6696e5`; `face_limit` 4000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 3,739 triangles, 1 material, one 2048x2048 texture, bounds 1.02 × 1.8 × 1.79 (x × y × z).
- Raw file: `assets/_incoming/model-prop-weir-sluice-gate-01/v1.glb` (SHA-256 `2d0d0de3769cc568c8363a836c2bb2de4c2ca946c17482c795153a2bda502ce7`), turntable `assets/_incoming/model-prop-weir-sluice-gate-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-weir-sluice-gate-01/v1.glb public/assets/model/model-prop-weir-sluice-gate-01.glb --compress meshopt --texture-compress webp --texture-size 1024` → 121 KB (SHA-256 `5521473cd19b9f4af012947d767e41479ffc8dc17757c66c11b0213fdaa51ad2`). Scale it in the scene placement; not yet placed.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | via `prop-river-quay-weir-set-01` |
| turntable | v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | one object, readable from four sides, faithful to the sheet |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
