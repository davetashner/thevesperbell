# model-prop-tidefair-boom-01

**Status: owner-approved model** (2026-11-16, standing pre-approval; Claude passed the turntable gate).

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-tidefair-set-01/prop-tidefair-set-01.png` (neighbouring props blanked where they crept in), padded on parchment to a square; Higgsfield media `10f0135f-6baf-4bd1-9997-a4abd2a4abae`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `13101ee9-2194-46c0-99a1-dbaa8b63a437`; `face_limit` 3000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 2,891 triangles, 1 material, one 2048x2048 texture, bounds 0.73 × 1.8 × 1.88 (x × y × z), front on +x.
- Raw file: `assets/_incoming/model-prop-tidefair-boom-01/v1.glb` (SHA-256 `33de455c2399d00372b8ded00a6ecd9aea0062d9d88acb8609ec247bc3b298a2`), turntable `assets/_incoming/model-prop-tidefair-boom-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-tidefair-boom-01/v1.glb public/assets/model/model-prop-tidefair-boom-01.glb --compress meshopt --texture-compress webp --texture-size 512` → 55 KB (SHA-256 `49635363745cbd694784e9fb8c7de731565b9e68b80947efd84619288c568f45`). Not yet placed in the scene.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | via `prop-tidefair-set-01` |
| turntable | v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | Claude checked the turntable: one object, readable, cues kept |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
