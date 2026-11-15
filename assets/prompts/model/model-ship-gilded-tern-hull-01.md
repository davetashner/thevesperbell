# model-ship-gilded-tern-hull-01: the Gilded Tern — the hull

**Status: generated v2, turntable awaiting owner approval** (2026-11-15). v1 was too short (about 2.65:1); the owner asked for a redo. Design approved on `prop-ship-gilded-tern-01` v3 (owner, 2026-11-15).

## Single image (input to image-to-3D)

| Field | Value |
|---|---|
| Image id | `prop-ship-gilded-tern-hull-01` |
| Source | Higgsfield `gpt_image_2_6`, quality high, 2k, 1:1, plan plus, 2026-11-15, job `2ba668c1-4fe9-4ef5-8ae4-6dc8e945e8ed`, with the approved v3 sheet (job `6763240f-1ca4-473c-b831-39cde6ba8d2d`) as the reference |
| Staging copy | `assets/_incoming/prop-ship-gilded-tern-hull-01/v1.png` (gitignored) |

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Single prop for image-to-3D: one object only, centred, the whole object in frame with generous margin, three-quarter view from slightly above, plain flat parchment (#EFE2C4) background, even soft lighting, only a faint contact shadow, no other objects, no water, no human figure, no scale bar, no text.

SUBJECT: reproduce the Gilded Tern's hull alone, from the attached approved design sheet (view 3), seen from the bow quarter: the round-bellied tarred hull about four times as long as it is wide, broad ochre wale stripes, cream-and-ochre bulwarks with rail posts, rolled tan hemp boarding nets lashed along the bulwarks, a row of round shuttered scuttles, the caulked iron-barred lading port under the wale on this side, the raised stern castle with its cabin windows and two stern lanterns, the open salt-grey deck with its grating hatch and companionway hutch, three empty mast steps (round holes) in the deck, and the slim tapering bowsprit. No masts, no rigging, no figurehead, no springalds, no anchor cable. The keel and the bottom of the hull are fully visible. Keep its shape, proportions, colours, materials and legibility cues identical to the sheet; do not redesign it.
```

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-15, 9 credits. Job `97fc2b41-b005-4d35-af94-df3cc822df2d`;
  `face_limit` 5000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 4,811 triangles, 1 material, one 2048x2048 texture, bounds 0.66 × 0.8 × 1.75 (x × y × z, before placement scaling).
- Raw file: `assets/_incoming/model-ship-gilded-tern-hull-01/v1.glb` (SHA-256 `c3b8071fc8124861a41e9fece5d7ca51ec49fa49df1d52751bb2b8e1bd53cb7f`), turntable `assets/_incoming/model-ship-gilded-tern-hull-01/v1-turntable.png`.
- Notes: Tripo made it about 2.65 times as long as wide (the level hull is 4:1): integration either stretches it about 1.5× along its length or re-rolls it from a longer single image.

## Use in the level

The hull, deck at y = 2 over the 10 m × 40 m blocking platform (x 30–40, z 106–146). Budget: modular ship pieces ≤ 5 k triangles each, one material (style bible §13.2, §5.6).

## Processing (after turntable approval)

1. `npx @gltf-transform/cli@4.5.1 optimize … --texture-size 512` (1024 for the hull, a hero piece) → `public/assets/model/model-ship-gilded-tern-hull-01.glb`.
2. Placement and scale in the harbour scene with the Gilded Tern integration.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v3 | approved | owner | 2026-11-15 | via `prop-ship-gilded-tern-01` |
| turntable | v1 | pending | owner | — | — |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added on approval.

## v2 (redo at the level's proportions, 2026-11-15)

- Single image `prop-ship-gilded-tern-hull-01` v2: Higgsfield `gpt_image_2_6`, high, 2k, 21:9, job `9a419ba8-fc5a-41e6-ae2c-b0ec5cc54ef2`,
  references the approved v3 sheet and the v1 hull image; the prompt asks for a hull exactly four times as long as wide,
  seen side-on across the frame (`assets/_incoming/prop-ship-gilded-tern-hull-01/v2.png`).
- Tripo H3.1 via Higgsfield, job `070ff2f5-24f9-4b74-8203-6f5119d50bcd`, `face_limit` 5000, texture on, PBR off, auto_size on.
- Raw result: 4,714 triangles, 1 material, one 2048² texture, bounds 1.49 × 1.2 × 5.64 (about 3.8:1).
- Raw file `assets/_incoming/model-ship-gilded-tern-hull-01/v2.glb` (SHA-256 `f996f770dd6f83dc0b4063490d97cf20594be421d5f88c7ffec27a3ea71fea72`), turntable `v2-turntable.png`.

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| turntable | v1 | rejected | owner | 2026-11-15 | "Let's redo the hull" (too short for the level's 4:1 hull) |
| turntable | v2 | pending | owner | — | — |
