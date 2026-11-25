# model-prop-lock-cottage-01

**Status: approved model** (2026-11-25; Claude, delegated by owner 2026-11-07; Claude passed the turntable gate). Bead `mw-e37.434`.

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-river-kestrel-lock-set-01/prop-river-kestrel-lock-set-01.png` with `scripts/assets/crop-cli.ts` (largest shape kept, padded square on parchment); Higgsfield media `dc024158-ed7f-41de-8c93-7da3a88d69bf`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-25, 9 credits. Job `20616812-a3a6-4079-a7cf-e268c9ea29a8`; `face_limit` 5000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 4,568 triangles, 1 material, one 2048x2048 texture, bounds 2.55 × 2.5 × 2.76 (x × y × z).
- Raw file: `assets/_incoming/model-prop-lock-cottage-01/v1.glb` (SHA-256 `41f506e304924d6d005e72b71a934d87da8e8fd26424acd6ee4713c83031d43c`), turntable `assets/_incoming/model-prop-lock-cottage-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-lock-cottage-01/v1.glb public/assets/model/model-prop-lock-cottage-01.glb --compress meshopt --texture-compress webp --texture-size 1024` → 141 KB (SHA-256 `ba8280d9ab48484b4db4400a1c4a36e944a97f4314eaf79d7bba4acae73f037b`). Scale it in the scene placement; not yet placed.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | via `prop-river-kestrel-lock-set-01` |
| turntable | v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | one object, readable from four sides, faithful to the sheet |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
