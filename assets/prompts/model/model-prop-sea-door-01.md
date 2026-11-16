# model-prop-sea-door-01

**Status: owner-approved model** (turntable approved 2026-11-16, "Approved"); runtime file in place, not yet placed in the scene. Design approved on `prop-breakwater-figurehead-01` (owner, 2026-11-16, "They look great").

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Source | cropped from the approved sheet `assets/source/prop/prop-breakwater-figurehead-01/prop-breakwater-figurehead-01.png` (the sea-door in its wall (3); the second figurehead view was painted out of the crop), padded on parchment to a square, uploaded as Higgsfield media `c3f5badf-2bfe-48ec-9f58-ecbbd1c5c6d9` |

No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `430b367a-9e44-4e70-9ba8-3ba5a31dee5d`; `face_limit` 5000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 4,549 triangles, 1 material, one 2048x2048 texture, bounds 1.17 × 2.5 × 2.49 (x × y × z, before placement scaling).
- Raw file: `assets/_incoming/model-prop-sea-door-01/v1.glb` (SHA-256 `19b0d1e191fb2aa506401e898b202026ba2af7a289f295b074aacf1cf88d271c`), turntable `assets/_incoming/model-prop-sea-door-01/v1-turntable.png`.

## Use in the level

The smugglers' sea-door at the tide line, iron lock plate. Budget: large 2–5 k tris, one prop atlas, one material per set (style bible §13.2); decimated at processing.

## Processing

1. `npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-sea-door-01/v1.glb public/assets/model/model-prop-sea-door-01.glb --texture-size 1024`
   → 198 KB, one 1024² texture, meshopt-compressed (SHA-256 `fb60bba4b1d61af841df947adb54d3a7d0647bd53d25e49cf369599c0153a3c9`).
2. Placement waits for the interior beads (Bonded Warehouse, Customs House, breakwater).

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner | 2026-11-16 | via `prop-breakwater-figurehead-01` |
| turntable | v1 | approved | owner | 2026-11-16 | "Approved" (session chat; `assets/approvals.json` does not exist yet) |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added 2026-11-16 (`placeholder: yes` until `assets/approvals.json` exists).
