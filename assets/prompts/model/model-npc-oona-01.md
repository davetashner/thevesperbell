# model-npc-oona-01: Big Oona's body (creature `npc-oona`)

**Status: generated v1, turntable awaiting owner approval** (2026-11-16). Design approved on `char-npc-oona-01` (owner, 2026-11-16).

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Source | the front view cropped from the approved turnaround `assets/source/character/char-npc-oona-01/char-npc-oona-01.png`, with the 1.8 m scale line, its label and any neighbouring view removed so exactly one figure remains (checked by eye), padded on parchment to a square; Higgsfield media `1b45f6eb-84ac-4d1b-ae96-0f255720acc2` |

No prompt: a crop of the approved sheet. Same method as the Briar Glen townsfolk (`model-npc-bodies-01.md`): a whole sheet makes Tripo build four figures.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `bfc2e474-0905-446a-87e4-5d710f56d532`; `face_limit` 6000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 5,771 triangles, 1 material, one 2048x2048 texture, bounds 0.54 × 1.8 × 0.97 (x × y × z), unrigged A-pose facing +x.
- Raw file: `assets/_incoming/model-npc-oona-01/v1.glb` (SHA-256 `8e681161fba8150015c6e1e31d7a7a464ddaef40da0784191f100125e6c54699`), turntable `assets/_incoming/model-npc-oona-01/v1-turntable.png`.

## Use

Key NPC body for `npc-oona`: 4–7 k triangles, one material (style bible §13.2). Swapped in for the capsule through `NPC_MODEL_URLS` in `src/render/creatures/npc-model.ts`, scaled to the creature's height. Static, like the Briar Glen bodies.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | approved | owner | 2026-11-16 | via `char-npc-oona-01` |
| turntable | v1 | pending | owner | — | — |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-npc-bodies-01`. CREDITS row on approval.
