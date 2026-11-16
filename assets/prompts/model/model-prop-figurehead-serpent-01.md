# model-prop-figurehead-serpent-01

**Status: owner-approved model** (turntable approved 2026-11-16, "Approved"); runtime file in place, not yet placed in the scene. Design approved on `prop-breakwater-figurehead-01` (owner, 2026-11-16, "They look great").

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Source | cropped from the approved sheet `assets/source/prop/prop-breakwater-figurehead-01/prop-breakwater-figurehead-01.png` (the front view of the serpent figurehead (1)), padded on parchment to a square, uploaded as Higgsfield media `599e352c-d26c-4689-b195-4ec5484e3533` |

No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `76eace1d-f0b7-4619-aac4-940779cc6575`; `face_limit` 5000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 4,856 triangles, 1 material, one 2048x2048 texture, bounds 1.46 × 2.5 × 0.97 (x × y × z, before placement scaling).
- Raw file: `assets/_incoming/model-prop-figurehead-serpent-01/v1.glb` (SHA-256 `008e987fe6ca74d79736d779e2166fb7cb72c7fadf9edbd8a950ac88f327ee27`), turntable `assets/_incoming/model-prop-figurehead-serpent-01/v1-turntable.png`.

## Use in the level

The sunken serpent figurehead under the breakwater, lantern eyes (story bible rumour 18). Budget: large 2–5 k tris, one prop atlas, one material per set (style bible §13.2); decimated at processing.

## Processing

1. `npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-figurehead-serpent-01/v1.glb public/assets/model/model-prop-figurehead-serpent-01.glb --texture-size 1024`
   → 180 KB, one 1024² texture, meshopt-compressed (SHA-256 `b08fafcee214332fc612cb140ec435cd59f6d32b2071255b99b353d544b38210`).
2. Placement waits for the interior beads (Bonded Warehouse, Customs House, breakwater).

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner | 2026-11-16 | via `prop-breakwater-figurehead-01` |
| turntable | v1 | approved | owner | 2026-11-16 | "Approved" (session chat; `assets/approvals.json` does not exist yet) |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added 2026-11-16 (`placeholder: yes` until `assets/approvals.json` exists).
