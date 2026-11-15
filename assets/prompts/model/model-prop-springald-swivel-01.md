# model-prop-springald-swivel-01: the Gilded Tern — swivel springalds on the rail posts (two a side

**Status: generated v1, turntable awaiting owner approval** (2026-11-15). Design approved on `prop-ship-gilded-tern-01` v3 (owner, 2026-11-15).

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Image id | `prop-springald-swivel-01` |
| Source | cropped from the approved v3 sheet `assets/source/prop/prop-ship-gilded-tern-01/prop-ship-gilded-tern-01.png` (the springald beside the mast), padded on parchment to 1024², uploaded as Higgsfield media `26ea08f4-66be-4fdd-bf65-d9113cf921c7` |
| Staging copy | `assets/_incoming/prop-springald-swivel-01/v1.png` (gitignored) |

No prompt: a crop of the approved sheet (see above).

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-15, 9 credits. Job `bcef5702-d86e-4767-8918-edc1d90ae1bf`;
  `face_limit` 1500, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,404 triangles, 1 material, one 2048x2048 texture, bounds 0.94 × 0.8 × 1.2 (x × y × z, before placement scaling).
- Raw file: `assets/_incoming/model-prop-springald-swivel-01/v1.glb` (SHA-256 `9344f1248eece17d703a98a2cecfde0cf69af093e59c4faf62cac8f02f4cb808`), turntable `assets/_incoming/model-prop-springald-swivel-01/v1-turntable.png`.
- Notes: The single image was cropped from the approved v3 sheet: two image generations of it were refused by the provider's content filter (weapons).

## Use in the level

Swivel springalds on the rail posts (two a side, one at the stern), dressing only. Budget: modular ship pieces ≤ 5 k triangles each, one material (style bible §13.2, §5.6).

## Processing (after turntable approval)

1. `npx @gltf-transform/cli@4.5.1 optimize … --texture-size 512` (1024 for the hull, a hero piece) → `public/assets/model/model-prop-springald-swivel-01.glb`.
2. Placement and scale in the harbour scene with the Gilded Tern integration.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v3 | approved | owner | 2026-11-15 | via `prop-ship-gilded-tern-01` |
| turntable | v1 | pending | owner | — | — |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added on approval.
