# model-npc-nell-01: Nell Gannet's body (creature `npc-nell`)

**Status: generated v1, turntable awaiting owner approval** (2026-11-16). Design approved on `char-npc-nell-01` (owner, 2026-11-16).

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Source | the front view cropped from the approved turnaround `assets/source/character/char-npc-nell-01/char-npc-nell-01.png`, with the 1.8 m scale line, its label and any neighbouring view removed so exactly one figure remains (checked by eye), padded on parchment to a square; Higgsfield media `e90cb2ed-615c-4519-81fd-b781e78ce8cd` |

No prompt: a crop of the approved sheet. Same method as the Briar Glen townsfolk (`model-npc-bodies-01.md`): a whole sheet makes Tripo build four figures.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `b09bee51-8db3-4965-878e-ddd02942ab4b`; `face_limit` 6000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 5,877 triangles, 1 material, one 2048x2048 texture, bounds 0.54 × 1.7 × 0.75 (x × y × z), unrigged A-pose facing +x.
- Raw file: `assets/_incoming/model-npc-nell-01/v1.glb` (SHA-256 `44b3ed84e0ced2301570de9d52e5034529322739a3a6540546c5414d7dbcd743`), turntable `assets/_incoming/model-npc-nell-01/v1-turntable.png`.

## Use

Key NPC body for `npc-nell`: 4–7 k triangles, one material (style bible §13.2). Swapped in for the capsule through `NPC_MODEL_URLS` in `src/render/creatures/npc-model.ts`, scaled to the creature's height. Static, like the Briar Glen bodies.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | approved | owner | 2026-11-16 | via `char-npc-nell-01` |
| turntable | v1 | pending | owner | — | — |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-npc-bodies-01`. CREDITS row on approval.
