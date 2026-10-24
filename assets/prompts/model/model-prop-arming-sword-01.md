# model-prop-arming-sword-01: the knight's sword (placeholder model)

**Status: placeholder.** Not owner-approved (no turntable approval, mw-e37.21) and the Tripo half of the
licence is confirmed (owner, 2026-10-24, mw-uuk).

## Source

- Approved flat: `prop-arming-sword-01` `source-3d-v1.png` (single object on plain background, ChatGPT
  image generation), uploaded as is.

## Generation

- Provider: Tripo H3.1 (`tripo_h3_1_image_to_3d`) through Higgsfield's `generate_3d` (MCP), plan Plus,
  2026-10-03, 9 credits. Job `b2e5d301-7914-428b-91d6-0066d440e0f6`; `face_limit` 1500, `texture` true,
  `pbr` false, standard quality, `auto_size` true.
- Raw result: 1,464 triangles, one material, unrigged. Tripo kept the source picture's diagonal: the sword
  lies tilted 37.3° in the y-z plane, pommel up and back.

## Processing

1. `gltf-transform optimize … --compress meshopt --texture-compress webp --texture-size 512` →
   `public/assets/model/model-prop-arming-sword-01.glb` (43 KB, 1,424 triangles; held weapon budget 300 to 1.5 k).
2. At load (`SWORD_PLACEMENT` in `src/render/player/knight-model.ts`): turned 37.3° about x so the blade
   hangs straight down, scaled to 0.85 m, hilt end at the rig's `sword` bone (the right hand), the grip
   0.1 m below the bone origin so it sits in the fist. The prop is rigid on that bone.

## Licence (checked 2026-10-03, mw-qov; Tripo terms confirmed by the owner 2026-10-24, mw-uuk)

Same as `model-char-knight-01`: the job ran on Higgsfield (Plus plan), so Higgsfield's Terms of Use bind us
(§4.4: the user owns Outputs and may use and sublicense them commercially; §8: the third-party provider's
policy applies). Tripo's own terms: the owner confirmed on 2026-10-24 (mw-uuk) that they allow our use of
Tripo-generated models. See `assets/prompts/model/model-char-knight-01.md` for the full note. The CREDITS
row stays `placeholder: yes`.
