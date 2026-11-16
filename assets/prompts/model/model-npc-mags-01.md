# model-npc-mags-01: Mags Oakum's body (creature `npc-mags`)

**Status: owner-approved model** (turntable approved 2026-11-16, "They look good"); in the harbour scene. Design approved on `char-npc-mags-01` (owner, 2026-11-16).

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Source | the front view cropped from the approved turnaround `assets/source/character/char-npc-mags-01/char-npc-mags-01.png`, with the 1.8 m scale line, its label and any neighbouring view removed so exactly one figure remains (checked by eye), padded on parchment to a square; Higgsfield media `9c4229a4-1715-41dc-87cf-df7275f4501f` |

No prompt: a crop of the approved sheet. Same method as the Briar Glen townsfolk (`model-npc-bodies-01.md`): a whole sheet makes Tripo build four figures.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `5dbc346b-7ec6-4535-a763-58cbb7333387`; `face_limit` 6000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 5,579 triangles, 1 material, one 2048x2048 texture, bounds 0.46 × 1.85 × 0.95 (x × y × z), unrigged A-pose facing +x.
- Raw file: `assets/_incoming/model-npc-mags-01/v1.glb` (SHA-256 `fee1d7e20d398f8a6d51fb8e39e1ec06ae65f5082d2e4ab369fe0a5827968ac0`), turntable `assets/_incoming/model-npc-mags-01/v1-turntable.png`.

## Use

Key NPC body for `npc-mags`: 4–7 k triangles, one material (style bible §13.2). Swapped in for the capsule through `NPC_MODEL_URLS` in `src/render/creatures/npc-model.ts`, scaled to the creature's height. Static, like the Briar Glen bodies.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-npc-mags-01/v1.glb public/assets/model/model-npc-mags-01.glb --compress meshopt --texture-compress webp --texture-size 512` → 73 KB, one 512² texture (SHA-256 `22256e68b62bae698641642acc109e638ad117277004b9172f8adff395fdbc47`).

Height: scaled to the creature's size class like every NPC, so Nell is not yet tiny nor Oona huge in game (owner left it as is, 2026-11-16).

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | approved | owner | 2026-11-16 | via `char-npc-mags-01` |
| turntable | v1 | approved | owner | 2026-11-16 | "They look good" (session chat; `assets/approvals.json` does not exist yet) |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-npc-bodies-01`. CREDITS row added 2026-11-16 (`placeholder: yes` until `assets/approvals.json` exists).
