# model-prop-quay-toll-shed-01

**Status: approved model** (2026-11-25; Claude, delegated by owner 2026-11-07; Claude passed the turntable gate). Bead `mw-e37.434`.

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-river-quay-weir-set-01/prop-river-quay-weir-set-01.png` with `scripts/assets/crop-cli.ts` (largest shape kept, padded square on parchment); Higgsfield media `87f90851-0de0-4635-8bc8-0f98d03ee41f`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-25, 9 credits. Job `7302a8a8-05c8-4c48-a86a-659bd11829e7`; `face_limit` 4000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 3,564 triangles, 1 material, one 2048x2048 texture, bounds 1.44 × 1.8 × 1.79 (x × y × z).
- Raw file: `assets/_incoming/model-prop-quay-toll-shed-01/v1.glb` (SHA-256 `2926b71378c5a0747ed91ad9d9077835831523f1af821582aa83d4bbf3d3ba32`), turntable `assets/_incoming/model-prop-quay-toll-shed-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-quay-toll-shed-01/v1.glb public/assets/model/model-prop-quay-toll-shed-01.glb --compress meshopt --texture-compress webp --texture-size 1024` → 124 KB (SHA-256 `fd144b8353f3d9109fe86fb57b7aff59e031b52b3b2d8a0bcedff7046b88822a`). Scale it in the scene placement; not yet placed.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | via `prop-river-quay-weir-set-01` |
| turntable | v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | one object, readable from four sides, faithful to the sheet |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
