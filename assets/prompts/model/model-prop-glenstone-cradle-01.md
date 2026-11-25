# model-prop-glenstone-cradle-01

**Status: approved model** (2026-11-25; Claude, delegated by owner 2026-11-07; Claude passed the turntable gate). Bead `mw-e37.434`.

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-river-quay-weir-set-01/prop-river-quay-weir-set-01.png` with `scripts/assets/crop-cli.ts` (largest shape kept, padded square on parchment); Higgsfield media `512879b1-11c5-4439-8d8e-3276e23c58b0`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-25, 9 credits. Job `7dab5791-c0cf-4308-978f-369e841dae82`; `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,856 triangles, 1 material, one 2048x2048 texture, bounds 0.9 × 0.6 × 0.76 (x × y × z).
- Raw file: `assets/_incoming/model-prop-glenstone-cradle-01/v1.glb` (SHA-256 `8194a19ab5413403168567d66d2ecdf35836ad45fce55100755751d7dd1e71b2`), turntable `assets/_incoming/model-prop-glenstone-cradle-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-glenstone-cradle-01/v1.glb public/assets/model/model-prop-glenstone-cradle-01.glb --compress meshopt --texture-compress webp --texture-size 1024` → 74 KB (SHA-256 `4044215ef8204748b949a9103ea5d5402d7da3af92d2445f9b45a04f88b7d416`). Scale it in the scene placement; not yet placed.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | via `prop-river-quay-weir-set-01` |
| turntable | v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | one object, readable from four sides, faithful to the sheet |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
