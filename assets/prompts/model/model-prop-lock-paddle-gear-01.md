# model-prop-lock-paddle-gear-01

**Status: approved model** (2026-11-25; Claude, delegated by owner 2026-11-07; Claude passed the turntable gate). Bead `mw-e37.434`.

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-river-kestrel-lock-set-01/prop-river-kestrel-lock-set-01.png` with `scripts/assets/crop-cli.ts` (largest shape kept, padded square on parchment); Higgsfield media `5d2ae91e-f803-4dfd-83c1-32065a46d203`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-25, 9 credits. Job `cb43bcca-0db3-415f-a3fd-6579a069443b`; `face_limit` 3000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 2,859 triangles, 1 material, one 2048x2048 texture, bounds 0.29 × 0.5 × 0.52 (x × y × z).
- Raw file: `assets/_incoming/model-prop-lock-paddle-gear-01/v1.glb` (SHA-256 `1c6e4caf81ce8506f019a45f58bcca20ab076fc87d4c0240ae2452e4165a8cea`), turntable `assets/_incoming/model-prop-lock-paddle-gear-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-lock-paddle-gear-01/v1.glb public/assets/model/model-prop-lock-paddle-gear-01.glb --compress meshopt --texture-compress webp --texture-size 1024` → 107 KB (SHA-256 `8d2ad3899a16936c85732fe8f3c5f59c4d348b28c9b5fde8dfdba9f7afdc8bf7`). Scale it in the scene placement; not yet placed.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | via `prop-river-kestrel-lock-set-01` |
| turntable | v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | one object, readable from four sides, faithful to the sheet |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
