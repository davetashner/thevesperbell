# model-prop-stone-barge-01

**Status: approved model** (2026-11-25; Claude, delegated by owner 2026-11-07; Claude passed the turntable gate). Bead `mw-e37.434`.

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-river-quay-weir-set-01/prop-river-quay-weir-set-01.png` with `scripts/assets/crop-cli.ts` (largest shape kept, padded square on parchment); Higgsfield media `194186d2-9341-4fe0-bff7-b03454bee3c2`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-25, 9 credits. Job `f0013e83-6d50-430a-9320-3b7f31fecbc0`; `face_limit` 5000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 4,636 triangles, 1 material, one 2048x2048 texture, bounds 1.36 × 1.2 × 2.56 (x × y × z).
- Raw file: `assets/_incoming/model-prop-stone-barge-01/v1.glb` (SHA-256 `b1788f492fb32df57c5d90e7de7c8cd27d41df68bcc1c26d78347bfd8908f73b`), turntable `assets/_incoming/model-prop-stone-barge-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-stone-barge-01/v1.glb public/assets/model/model-prop-stone-barge-01.glb --compress meshopt --texture-compress webp --texture-size 1024` → 136 KB (SHA-256 `73e2f851cbc0148c2a741a95808c4748fb707ee5402a0f8ef71ec0d73f0a8ecc`). Scale it in the scene placement; not yet placed.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | via `prop-river-quay-weir-set-01` |
| turntable | v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | one object, readable from four sides, faithful to the sheet |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
