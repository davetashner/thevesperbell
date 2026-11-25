# model-prop-lock-coping-stack-01

**Status: approved model** (2026-11-25; Claude, delegated by owner 2026-11-07; Claude passed the turntable gate). Bead `mw-e37.434`.

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-river-kestrel-lock-set-01/prop-river-kestrel-lock-set-01.png` with `scripts/assets/crop-cli.ts` (largest shape kept, padded square on parchment); Higgsfield media `cef6535b-92d6-41ad-a276-ae9c653ce7f5`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-25, 9 credits. Job `cbdbef42-815e-4625-b4bb-81a0fcb4fca0`; `face_limit` 1500, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,364 triangles, 1 material, one 2048x2048 texture, bounds 0.33 × 0.5 × 0.42 (x × y × z).
- Raw file: `assets/_incoming/model-prop-lock-coping-stack-01/v1.glb` (SHA-256 `e75614aad47c58ada54c82329a6c623d76b42fe4c1fb08588a5f2d27488066fe`), turntable `assets/_incoming/model-prop-lock-coping-stack-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-lock-coping-stack-01/v1.glb public/assets/model/model-prop-lock-coping-stack-01.glb --compress meshopt --texture-compress webp --texture-size 1024` → 64 KB (SHA-256 `221eea3cc7d54afaf3dca05ae0c06d666abb6f33678fd4ce6109b98ca32f0daa`). Scale it in the scene placement; not yet placed.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | via `prop-river-kestrel-lock-set-01` |
| turntable | v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | one object, readable from four sides, faithful to the sheet |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
