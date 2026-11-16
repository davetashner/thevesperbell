# model-npc-jasper-01: Jasper Quell's body (creature `npc-quell`)

**Status: generated v1, turntable awaiting owner approval** (2026-11-16). Design approved on `char-npc-jasper-01` (owner, 2026-11-16).

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Source | the front view cropped from the approved turnaround `assets/source/character/char-npc-jasper-01/char-npc-jasper-01.png`, with the 1.8 m scale line, its label and any neighbouring view removed so exactly one figure remains (checked by eye), padded on parchment to a square; Higgsfield media `da455a8c-a275-4c4c-9b57-691bf5d745fc` |

No prompt: a crop of the approved sheet. Same method as the Briar Glen townsfolk (`model-npc-bodies-01.md`): a whole sheet makes Tripo build four figures.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `3aea7eb0-ef97-4fbd-b9be-45086285c514`; `face_limit` 6000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 5,664 triangles, 1 material, one 2048x2048 texture, bounds 0.42 × 1.8 × 0.79 (x × y × z), unrigged A-pose facing +x.
- Raw file: `assets/_incoming/model-npc-jasper-01/v1.glb` (SHA-256 `3cac491b5bc180a434787bb175aa3f138712a42cc0dedde3d214a79fc758731c`), turntable `assets/_incoming/model-npc-jasper-01/v1-turntable.png`.

## Use

Key NPC body for `npc-quell`: 4–7 k triangles, one material (style bible §13.2). Swapped in for the capsule through `NPC_MODEL_URLS` in `src/render/creatures/npc-model.ts`, scaled to the creature's height. Static, like the Briar Glen bodies.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | approved | owner | 2026-11-16 | via `char-npc-jasper-01` |
| turntable | v1 | pending | owner | — | — |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-npc-bodies-01`. CREDITS row on approval.
