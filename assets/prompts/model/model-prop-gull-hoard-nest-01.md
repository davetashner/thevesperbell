# model-prop-gull-hoard-nest-01

**Status: owner-approved model** (2026-11-16, standing pre-approval; Claude passed the turntable gate).

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-harbour-rooftop-set-01/prop-harbour-rooftop-set-01.png` (neighbouring props blanked where they crept in), padded on parchment to a square; Higgsfield media `4e6c622a-2f5b-4f6b-9166-97da6260ee36`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `f4165f0a-ccfc-4eaf-b2bb-c3fa246312e0`; `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,806 triangles, 1 material, one 2048x2048 texture, bounds 0.57 × 0.8 × 0.65 (x × y × z), front on +x.
- Raw file: `assets/_incoming/model-prop-gull-hoard-nest-01/v1.glb` (SHA-256 `24c83ccfeeb5ff8bd3ccdc6a2824f7efc2e7ec0f0b8a025e37249a8388822c3a`), turntable `assets/_incoming/model-prop-gull-hoard-nest-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-gull-hoard-nest-01/v1.glb public/assets/model/model-prop-gull-hoard-nest-01.glb --compress meshopt --texture-compress webp --texture-size 512` → 53 KB (SHA-256 `dc61d2ad7f39539ee4ac9fa0e77f9a994e4905d1b948d06f48a92642dd0b2380`). Not yet placed in the scene.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | via `prop-harbour-rooftop-set-01` |
| turntable | v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | Claude checked the turntable: one object, readable, cues kept |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
