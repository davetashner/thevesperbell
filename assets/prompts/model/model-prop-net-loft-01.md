# model-prop-net-loft-01

**Status: owner-approved model** (2026-11-16, standing pre-approval; Claude passed the turntable gate).

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-harbour-rooftop-set-01/prop-harbour-rooftop-set-01.png` (neighbouring props blanked where they crept in), padded on parchment to a square; Higgsfield media `51b58529-363d-418f-8a1a-bc20a064b184`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `53fc8c09-285b-4acb-b508-8af9770579b6`; `face_limit` 5000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 4,763 triangles, 1 material, one 2048x2048 texture, bounds 3.25 × 4 × 4.34 (x × y × z), front on +x.
- Raw file: `assets/_incoming/model-prop-net-loft-01/v1.glb` (SHA-256 `cefeafa832af4433f59e6526271e2c7e50664a8121c0485f62d4c7abd2e902dd`), turntable `assets/_incoming/model-prop-net-loft-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-net-loft-01/v1.glb public/assets/model/model-prop-net-loft-01.glb --compress meshopt --texture-compress webp --texture-size 1024` → 137 KB (SHA-256 `0cfd0084a29804c4b4ed31312d3ebe75e6a353a144b8e0325328ca7240f9f079`). Not yet placed in the scene.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | via `prop-harbour-rooftop-set-01` |
| turntable | v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | Claude checked the turntable: one object, readable, cues kept |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
