# model-prop-wooden-gull-target-01

**Status: owner-approved model** (2026-11-16, standing pre-approval; Claude passed the turntable gate).

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-tidefair-set-01/prop-tidefair-set-01.png` (neighbouring props blanked where they crept in), padded on parchment to a square; Higgsfield media `b626a045-4a96-4b84-9384-cb7db43a716e`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `86e5560c-dda8-403c-8e9c-458106774bc9`; `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,875 triangles, 1 material, one 2048x2048 texture, bounds 0.35 × 1.2 × 1.01 (x × y × z), front on +x.
- Raw file: `assets/_incoming/model-prop-wooden-gull-target-01/v1.glb` (SHA-256 `2b284675a123884c3c86e95a12af6601b80050def4cfaa1a548f6e2a7846c559`), turntable `assets/_incoming/model-prop-wooden-gull-target-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-wooden-gull-target-01/v1.glb public/assets/model/model-prop-wooden-gull-target-01.glb --compress meshopt --texture-compress webp --texture-size 512` → 44 KB (SHA-256 `851c32b7932194616ac50c3f589c426fca90aeb4a41d54a0c00b476641409823`). Not yet placed in the scene.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | via `prop-tidefair-set-01` |
| turntable | v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | Claude checked the turntable: one object, readable, cues kept |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
