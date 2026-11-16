# model-npc-hesketh-01: Captain Hesketh's body (creature `npc-hesketh`)

**Status: owner-approved model** (turntable approved 2026-11-16, "They look good"); in the harbour scene. Design approved on `char-npc-hesketh-01` (owner, 2026-11-16).

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Source | the front view cropped from the approved turnaround `assets/source/character/char-npc-hesketh-01/char-npc-hesketh-01.png`, with the 1.8 m scale line, its label and any neighbouring view removed so exactly one figure remains (checked by eye), padded on parchment to a square; Higgsfield media `a06cab3e-0f06-4adc-88b7-2764905d7734` |

No prompt: a crop of the approved sheet. Same method as the Briar Glen townsfolk (`model-npc-bodies-01.md`): a whole sheet makes Tripo build four figures.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `4edb04d0-7e4f-4a59-881a-45233fdc85a7`; `face_limit` 6000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 5,946 triangles, 1 material, one 2048x2048 texture, bounds 0.51 × 1.85 × 0.91 (x × y × z), unrigged A-pose facing +x.
- Raw file: `assets/_incoming/model-npc-hesketh-01/v1.glb` (SHA-256 `d1b0f586d813f7d796dcccc34436965eefdf5b306ad7754ffc2fa53bbe072c1a`), turntable `assets/_incoming/model-npc-hesketh-01/v1-turntable.png`.

## Use

Key NPC body for `npc-hesketh`: 4–7 k triangles, one material (style bible §13.2). Swapped in for the capsule through `NPC_MODEL_URLS` in `src/render/creatures/npc-model.ts`, scaled to the creature's height. Static, like the Briar Glen bodies.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-npc-hesketh-01/v1.glb public/assets/model/model-npc-hesketh-01.glb --compress meshopt --texture-compress webp --texture-size 512` → 76 KB, one 512² texture (SHA-256 `82b148b298c57954fbe8b9c7d5905893a498d23ed7a3473517f648bdd3c7c586`).

Height: scaled to the creature's size class like every NPC, so Nell is not yet tiny nor Oona huge in game (owner left it as is, 2026-11-16).

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | approved | owner | 2026-11-16 | via `char-npc-hesketh-01` |
| turntable | v1 | approved | owner | 2026-11-16 | "They look good" (session chat; `assets/approvals.json` does not exist yet) |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-npc-bodies-01`. CREDITS row added 2026-11-16 (`placeholder: yes` until `assets/approvals.json` exists).
