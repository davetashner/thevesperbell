# model-prop-relic-crate-01

**Status: owner-approved model** (turntable approved 2026-11-16, "Approved"); runtime file in place, not yet placed in the scene. Design approved on `prop-harbour-story-set-01` (owner, 2026-11-16, "They look great").

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Source | cropped from the approved sheet `assets/source/prop/prop-harbour-story-set-01/prop-harbour-story-set-01.png` (the open crate with the oilcloth bundle (crate 4)), padded on parchment to a square, uploaded as Higgsfield media `dbedef9a-e0fb-46fc-81f6-9cdb21684d0a` |

No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `f5bf7963-79fc-4668-bfb3-2da4aef60e43`; `face_limit` 5000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 4,423 triangles, 1 material, one 2048x2048 texture, bounds 0.49 × 0.6 × 0.48 (x × y × z, before placement scaling).
- Raw file: `assets/_incoming/model-prop-relic-crate-01/v1.glb` (SHA-256 `f914b8be02a2bf36bf0f39400a85dd3495155f9169e546b6575a0fb23485d05b`), turntable `assets/_incoming/model-prop-relic-crate-01/v1-turntable.png`.

## Use in the level

Vane's relic crate, opened; identical outside to the ballast twin. Budget: medium 400–2 k tris, one prop atlas, one material per set (style bible §13.2); decimated at processing.

## Processing

1. `npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-relic-crate-01/v1.glb public/assets/model/model-prop-relic-crate-01.glb --texture-size 512`
   → 94 KB, one 512² texture, meshopt-compressed (SHA-256 `2d22fdc5d5eb2739e9a3fe0a5af425ddefc80945f047be52d4e99593cfe62f6b`).
2. Placement waits for the interior beads (Bonded Warehouse, Customs House, breakwater).

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner | 2026-11-16 | via `prop-harbour-story-set-01` |
| turntable | v1 | approved | owner | 2026-11-16 | "Approved" (session chat; `assets/approvals.json` does not exist yet) |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added 2026-11-16 (`placeholder: yes` until `assets/approvals.json` exists).
