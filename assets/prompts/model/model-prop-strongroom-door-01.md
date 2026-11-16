# model-prop-strongroom-door-01

**Status: owner-approved model** (turntable approved 2026-11-16, "Approved"); runtime file in place, not yet placed in the scene. Design approved on `prop-harbour-story-set-01` (owner, 2026-11-16, "They look great").

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Source | cropped from the approved sheet `assets/source/prop/prop-harbour-story-set-01/prop-harbour-story-set-01.png` (the strongroom door (7)), padded on parchment to a square, uploaded as Higgsfield media `b88a2836-6714-4536-9da8-ac8d0241d931` |

No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `d2f534ed-8fe6-4890-a02f-0bbc308e75e5`; `face_limit` 5000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 4,660 triangles, 1 material, one 2048x2048 texture, bounds 0.96 × 2 × 1.91 (x × y × z, before placement scaling).
- Raw file: `assets/_incoming/model-prop-strongroom-door-01/v1.glb` (SHA-256 `adeba5a15e16cafa4caf4fab65ada48e088ef13e0e1e7a61d966587fe90a3a47`), turntable `assets/_incoming/model-prop-strongroom-door-01/v1-turntable.png`.

## Use in the level

The customs strongroom door; black-steel lock plate (tier 3, style bible §7). Budget: medium 400–2 k tris, one prop atlas, one material per set (style bible §13.2); decimated at processing.

## Processing

1. `npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-strongroom-door-01/v1.glb public/assets/model/model-prop-strongroom-door-01.glb --texture-size 512`
   → 76 KB, one 512² texture, meshopt-compressed (SHA-256 `f89ac9d728c80b7e582960135989100ca9aa6f77dc149b4c0f37c641e70e9ea3`).
2. Placement waits for the interior beads (Bonded Warehouse, Customs House, breakwater).

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner | 2026-11-16 | via `prop-harbour-story-set-01` |
| turntable | v1 | approved | owner | 2026-11-16 | "Approved" (session chat; `assets/approvals.json` does not exist yet) |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added 2026-11-16 (`placeholder: yes` until `assets/approvals.json` exists).
