# model-prop-smuggler-crate-01

**Status: owner-approved model** (2026-11-16, standing pre-approval; Claude passed the turntable gate).

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-harbour-rooftop-set-01/prop-harbour-rooftop-set-01.png` (neighbouring props blanked where they crept in), padded on parchment to a square; Higgsfield media `2c066575-6266-4ceb-924f-f85f172001e6`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `fba7d18c-b157-4e3c-ac24-70d40c2c6597`; `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,804 triangles, 1 material, one 2048x2048 texture, bounds 0.54 × 0.5 × 0.62 (x × y × z), front on +x.
- Raw file: `assets/_incoming/model-prop-smuggler-crate-01/v1.glb` (SHA-256 `5842b8117a616b1d72e061b92c76e6e9f05cb56e6ddb4cdf2200e4753c534598`), turntable `assets/_incoming/model-prop-smuggler-crate-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-smuggler-crate-01/v1.glb public/assets/model/model-prop-smuggler-crate-01.glb --compress meshopt --texture-compress webp --texture-size 512` → 48 KB (SHA-256 `75ba7086170cd13127e8d184cb861fca4210c21976a2f82e6fd04e3ad32400b5`). Not yet placed in the scene.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | via `prop-harbour-rooftop-set-01` |
| turntable | v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | Claude checked the turntable: one object, readable, cues kept |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
