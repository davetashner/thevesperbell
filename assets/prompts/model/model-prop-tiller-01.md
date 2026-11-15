# model-prop-tiller-01: tiller for the Wendmouth waterfront and the Gilded Tern

**Status: generated v1, turntable awaiting owner approval** (2026-11-15). Design approved on the sheet `prop-ship-gilded-tern-deck-fittings-01` (owner, 2026-11-15, "They all look great!").

## Single-prop image (input to image-to-3D)

| Field | Value |
|---|---|
| Image id | `prop-tiller-01` |
| Source design | prop 1 of `assets/source/prop/prop-ship-gilded-tern-deck-fittings-01/prop-ship-gilded-tern-deck-fittings-01.png` (Higgsfield job `125575c8-8a9f-4120-9647-10dd60850eab`), passed as the reference |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 1:1, plan plus, 2026-11-15, job `26d29729-0f88-4577-8be4-ab191916fc5a` |
| Staging copy | `assets/_incoming/prop-tiller-01/v1.png` (gitignored) |

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Single prop for image-to-3D: one object only, centred, the whole object in frame with generous margin, front three-quarter view from slightly above, plain flat parchment (#EFE2C4) background, even soft lighting, only a faint contact shadow, no other objects, no human figure, no scale bar, no text.

SUBJECT: reproduce prop 1 from the attached approved prop sheet exactly — the steering tiller: long honey-varnished oak bar with rope-wrapped grip, socketed into the square rudder-head post with its metal cap and base frame. Keep its shape, proportions, colours, materials, hardware and legibility cues identical to the sheet; do not redesign it. About 1.3 m tall in the world.
```

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-15, 9 credits. Job `48093164-d64e-4401-a855-f4bcbabcb2a8`;
  `face_limit` 2500, `texture` true, `pbr` false, `auto_size` true (same settings as `model-prop-chest-wooden-01`).
- Raw result: 2,332 triangles, 1 material, one 2048x2048 base-colour texture,
  bounds 1.3 × 0.65 × 0.5 m (x × y × z). Target height in the world about 1.3 m:
  `auto_size` is not reliable for these props, so the loader scales to the target height as it does for the chest.
- Raw file: `assets/_incoming/model-prop-tiller-01/v1.glb` (SHA-256 `6918751e30fb441e8e61522b33882588a05a936982c01c26c1a86a6164b234b6`), turntable `assets/_incoming/model-prop-tiller-01/v1-turntable.png`
  (four views, three.js headless render on parchment).

## Processing (after turntable approval)

1. `gltf-transform optimize … --texture-size 512` → `public/assets/model/model-prop-tiller-01.glb` (the tool is not installed in the
   repo; see the session notes).
2. Load-time placement (scale to 1.3 m, facing) when the harbour props are wired.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner | 2026-11-15 | via `prop-ship-gilded-tern-deck-fittings-01` |
| turntable | v1 | pending | owner | — | — |

## Licence

Higgsfield Plus (Terms of Use §4.4: the user owns Outputs, commercial use and sublicensing allowed); Tripo's own
terms confirmed by the owner on 2026-10-24 (mw-uuk), as for `model-prop-chest-wooden-01`. CREDITS row added when the
turntable is approved and the runtime file lands.
