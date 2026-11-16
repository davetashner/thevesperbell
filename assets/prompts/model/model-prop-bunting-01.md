# model-prop-bunting-01

**Status: owner-approved model** (2026-11-16, standing pre-approval; Claude passed the turntable gate).

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-tidefair-set-01/prop-tidefair-set-01.png` (neighbouring props blanked where they crept in), padded on parchment to a square; Higgsfield media `905df5c8-11a8-4514-b439-8e01e423f373`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `31b92958-e6cf-4120-85cc-502b829e901e`; `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,899 triangles, 1 material, one 2048x2048 texture, bounds 0.74 × 1.2 × 4.58 (x × y × z), front on +x.
- Raw file: `assets/_incoming/model-prop-bunting-01/v1.glb` (SHA-256 `4a0f7094e2f1e72c07939fe48454bdf865cf5694c292bcce7364a0ba4024fc02`), turntable `assets/_incoming/model-prop-bunting-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-bunting-01/v1.glb public/assets/model/model-prop-bunting-01.glb --compress meshopt --texture-compress webp --texture-size 512` → 45 KB (SHA-256 `45e877d7b9f0021b1c3dc7ead7ac0bf6f96a76c6361d165e9554d035cb0a4906`). Not yet placed in the scene.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | via `prop-tidefair-set-01` |
| turntable | v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | Claude checked the turntable: one object, readable, cues kept |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
