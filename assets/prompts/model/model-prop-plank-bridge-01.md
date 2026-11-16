# model-prop-plank-bridge-01

**Status: owner-approved model** (2026-11-16, standing pre-approval; Claude passed the turntable gate).

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-harbour-rooftop-set-01/prop-harbour-rooftop-set-01.png` (neighbouring props blanked where they crept in), padded on parchment to a square; Higgsfield media `a8081429-6e24-450b-beeb-c748ca705479`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `332e468e-4d6c-4e4d-b073-65efc54aa4c4`; `face_limit` 3000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 2,939 triangles, 1 material, one 2048x2048 texture, bounds 1.12 × 1.2 × 2.76 (x × y × z), front on +x.
- Raw file: `assets/_incoming/model-prop-plank-bridge-01/v1.glb` (SHA-256 `7f84f3bbe25b5beccc7257ffa451ea126846afdb8c4b04ca30206062a1de00e3`), turntable `assets/_incoming/model-prop-plank-bridge-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-plank-bridge-01/v1.glb public/assets/model/model-prop-plank-bridge-01.glb --compress meshopt --texture-compress webp --texture-size 512` → 59 KB (SHA-256 `c64ddc0df5d4d210c5e12aa107d7422446755433efd0a2fe8f16e1f9dcbefaab`). Not yet placed in the scene.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | via `prop-harbour-rooftop-set-01` |
| turntable | v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | Claude checked the turntable: one object, readable, cues kept |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
