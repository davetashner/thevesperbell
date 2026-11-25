# model-prop-weir-keystone-01

**Status: approved model** (2026-11-25; Claude, delegated by owner 2026-11-07; Claude passed the turntable gate). Bead `mw-e37.434`.

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-river-quay-weir-set-01/prop-river-quay-weir-set-01.png` with `scripts/assets/crop-cli.ts` (largest shape kept, padded square on parchment); Higgsfield media `87be50d5-0a6b-4417-8391-d26198868a84`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-25, 9 credits. Job `94ab0717-221f-49c8-ac9e-78f186d28d6b`; `face_limit` 1500, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,364 triangles, 1 material, one 2048x2048 texture, bounds 0.69 × 1.2 × 1.13 (x × y × z).
- Raw file: `assets/_incoming/model-prop-weir-keystone-01/v1.glb` (SHA-256 `6aac0bb55a89d1cf18dfb4be3b2587b2e1926036b4f5f731e8025de0d36092e1`), turntable `assets/_incoming/model-prop-weir-keystone-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-weir-keystone-01/v1.glb public/assets/model/model-prop-weir-keystone-01.glb --compress meshopt --texture-compress webp --texture-size 1024` → 63 KB (SHA-256 `99e83437f68ecaf4507b001a2620b86ed94ec6fdbb50d846eca075bca60c5ac9`). Scale it in the scene placement; not yet placed.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | via `prop-river-quay-weir-set-01` |
| turntable | v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | one object, readable from four sides, faithful to the sheet |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
