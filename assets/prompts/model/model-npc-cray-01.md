# model-npc-cray-01: Inspector Prudence Cray's body (creature `npc-cray`)

**Status: owner-approved model** (turntable approved 2026-11-16, "They look good"); in the harbour scene. Design approved on `char-npc-cray-01` (owner, 2026-11-16).

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Source | the front view cropped from the approved turnaround `assets/source/character/char-npc-cray-01/char-npc-cray-01.png`, with the 1.8 m scale line, its label and any neighbouring view removed so exactly one figure remains (checked by eye), padded on parchment to a square; Higgsfield media `b6e8b8ac-2bc5-4ed3-a08d-8e4db2ebdc87` |

No prompt: a crop of the approved sheet. Same method as the Briar Glen townsfolk (`model-npc-bodies-01.md`): a whole sheet makes Tripo build four figures.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `63c1acfa-0130-4fc7-a1d0-5e5880c63406`; `face_limit` 6000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 5,544 triangles, 1 material, one 2048x2048 texture, bounds 0.44 × 1.75 × 0.74 (x × y × z), unrigged A-pose facing +x.
- Raw file: `assets/_incoming/model-npc-cray-01/v1.glb` (SHA-256 `275e8f9828345329dd761f817f7b2fd8bc58be559457ac99cd54d50d0defffcd`), turntable `assets/_incoming/model-npc-cray-01/v1-turntable.png`.

## Use

Key NPC body for `npc-cray`: 4–7 k triangles, one material (style bible §13.2). Swapped in for the capsule through `NPC_MODEL_URLS` in `src/render/creatures/npc-model.ts`, scaled to the creature's height. Static, like the Briar Glen bodies.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-npc-cray-01/v1.glb public/assets/model/model-npc-cray-01.glb --compress meshopt --texture-compress webp --texture-size 512` → 71 KB, one 512² texture (SHA-256 `e83d1141ac5ec36e07a88032713bfdbadac7c063f056e36ec791b65ea92eb080`).

Height: scaled to the creature's size class like every NPC, so Nell is not yet tiny nor Oona huge in game (owner left it as is, 2026-11-16).

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | approved | owner | 2026-11-16 | via `char-npc-cray-01` |
| turntable | v1 | approved | owner | 2026-11-16 | "They look good" (session chat; `assets/approvals.json` does not exist yet) |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-npc-bodies-01`. CREDITS row added 2026-11-16 (`placeholder: yes` until `assets/approvals.json` exists).
