# model-prop-lock-gate-01

**Status: approved model** (2026-11-25; Claude, delegated by owner 2026-11-07; Claude passed the turntable gate). Bead `mw-e37.434`.

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-river-kestrel-lock-set-01/prop-river-kestrel-lock-set-01.png` with `scripts/assets/crop-cli.ts` (largest shape kept, padded square on parchment); Higgsfield media `e85eca8c-3a63-4add-b492-4b687cdeff44`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-25, 9 credits. Job `269d67b5-86fb-4362-9896-671004b41f6d`; `face_limit` 4000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 3,694 triangles, 1 material, one 2048x2048 texture, bounds 0.47 × 1.2 × 2.18 (x × y × z).
- Raw file: `assets/_incoming/model-prop-lock-gate-01/v1.glb` (SHA-256 `d391af560f370b44f8b4c0d719e317861b15d7d304cc1e3b751b74dc5deaa2b9`), turntable `assets/_incoming/model-prop-lock-gate-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-lock-gate-01/v1.glb public/assets/model/model-prop-lock-gate-01.glb --compress meshopt --texture-compress webp --texture-size 1024` → 129 KB (SHA-256 `514e60da3550fa5dd84956f544ff720792135659439ed32ed521ab0992b21759`). Placed at Kestrel Lock (mw-e25.27): the gate as the lock-gate door profile's model, the cottage as the keeper-cottage dressing.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | via `prop-river-kestrel-lock-set-01` |
| turntable | v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | one object, readable from four sides, faithful to the sheet |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
