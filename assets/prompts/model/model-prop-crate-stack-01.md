# model-prop-crate-stack-01

**Status: owner-approved model** (2026-11-16, standing pre-approval; Claude passed the turntable gate).

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-harbour-wharf-set-01/prop-harbour-wharf-set-01.png` (neighbouring props blanked where they crept in), padded on parchment to a square; Higgsfield media `05496578-b4b6-4ea7-bd6b-12ef7a4522de`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `6191b050-81a2-42a8-9f8f-22398feaef67`; `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,834 triangles, 1 material, one 2048x2048 texture, bounds 0.68 × 0.8 × 0.82 (x × y × z), front on +x.
- Raw file: `assets/_incoming/model-prop-crate-stack-01/v1.glb` (SHA-256 `4f275d3ec5c1f803e408c6e378d7dd229de4e445924a321f8edab0b00164c1af`), turntable `assets/_incoming/model-prop-crate-stack-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-crate-stack-01/v1.glb public/assets/model/model-prop-crate-stack-01.glb --compress meshopt --texture-compress webp --texture-size 512` → 47 KB (SHA-256 `b245d6b739b1bf80e9af2f1b4e95b660c09aca7519179dbf89d6def9aa9d847d`). Not yet placed in the scene.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | via `prop-harbour-wharf-set-01` |
| turntable | v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | Claude checked the turntable: one object, readable, cues kept |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
