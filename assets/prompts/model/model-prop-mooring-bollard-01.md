# model-prop-mooring-bollard-01

**Status: approved model** (2026-11-25; Claude, delegated by owner 2026-11-07; Claude passed the turntable gate). Bead `mw-e37.434`.

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-river-quay-weir-set-01/prop-river-quay-weir-set-01.png` with `scripts/assets/crop-cli.ts` (largest shape kept, padded square on parchment); Higgsfield media `472c4133-a9b9-464a-a178-962e6035a241`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-25, 9 credits. Job `bcab0d91-1c3b-4370-ba93-181c4f439898`; `face_limit` 1500, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,402 triangles, 1 material, one 2048x2048 texture, bounds 0.61 × 0.6 × 0.63 (x × y × z).
- Raw file: `assets/_incoming/model-prop-mooring-bollard-01/v1.glb` (SHA-256 `7029dc7c74d4de9987fb8fa4ce3a37c944a36d65e528478196e732a2097c47c1`), turntable `assets/_incoming/model-prop-mooring-bollard-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-mooring-bollard-01/v1.glb public/assets/model/model-prop-mooring-bollard-01.glb --compress meshopt --texture-compress webp --texture-size 1024` → 74 KB (SHA-256 `a692d0805748182deb247f72950cd6fb383dbd54ccee94a47ebe0d5b74335505`). Scale it in the scene placement; not yet placed.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | via `prop-river-quay-weir-set-01` |
| turntable | v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | one object, readable from four sides, faithful to the sheet |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
