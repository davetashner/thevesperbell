# model-prop-lock-toll-board-01

**Status: approved model** (2026-11-25; Claude, delegated by owner 2026-11-07; Claude passed the turntable gate). Bead `mw-e37.434`.

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-river-kestrel-lock-set-01/prop-river-kestrel-lock-set-01.png` with `scripts/assets/crop-cli.ts` (largest shape kept, padded square on parchment); Higgsfield media `f1a8e145-8a04-4054-824a-dca33cb5b33e`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-25, 9 credits. Job `0121a8df-915c-44b9-bc84-76c4964b61b5`; `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,796 triangles, 1 material, one 2048x2048 texture, bounds 0.89 × 1.8 × 1.54 (x × y × z).
- Raw file: `assets/_incoming/model-prop-lock-toll-board-01/v1.glb` (SHA-256 `96e3b1e90775ad9b212ff12fe0db8ac0f438c11157623c2557ae876a5f446e1e`), turntable `assets/_incoming/model-prop-lock-toll-board-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-lock-toll-board-01/v1.glb public/assets/model/model-prop-lock-toll-board-01.glb --compress meshopt --texture-compress webp --texture-size 1024` → 90 KB (SHA-256 `4398b4054b5155334ebf79c22b9687534f9185c0b2addc97d7dad0aef1da49d5`). Scale it in the scene placement; not yet placed.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | via `prop-river-kestrel-lock-set-01` |
| turntable | v1 | approved | Claude, delegated by owner 2026-11-07 | 2026-11-25 | one object, readable from four sides, faithful to the sheet |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
