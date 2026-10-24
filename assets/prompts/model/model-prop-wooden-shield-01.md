# model-prop-wooden-shield-01: the knight's shield (placeholder model)

**Status: placeholder.** Not owner-approved (no turntable approval, mw-e37.21) and the Tripo half of the
licence is confirmed (owner, 2026-10-24, mw-uuk).

## Source

- Approved flat: `prop-wooden-shield-01` `source-3d-v2.png` (single object on plain background, ChatGPT
  image generation), uploaded as is.

## Generation

- Provider: Tripo H3.1 (`tripo_h3_1_image_to_3d`) through Higgsfield's `generate_3d` (MCP), plan Plus,
  2026-10-03, 9 credits. Job `1a96651a-e8b1-42ad-b917-69d4581fa55a`; `face_limit` 1500, `texture` true,
  `pbr` false, standard quality, `auto_size` true.
- Raw result: 1,366 triangles, one material, unrigged, a disc facing +x with the boss toward +x.

## Processing

1. `gltf-transform optimize … --compress meshopt --texture-compress webp --texture-size 512` →
   `public/assets/model/model-prop-wooden-shield-01.glb` (47 KB, 1,344 triangles).
2. At load (`SHIELD_PLACEMENT`): turned +90° about y so it faces −z like the body, scaled to 0.75 m tall,
   fixed to the rig's `forearm-l` bone, centred 0.12 m outboard, 0.1 m down and 0.16 m in front of it. The
   prop is rigid on that bone, so it rises with the left arm.

## Licence (checked 2026-10-03, mw-qov; Tripo terms confirmed by the owner 2026-10-24, mw-uuk)

Same as `model-char-knight-01`: the job ran on Higgsfield (Plus plan), so Higgsfield's Terms of Use bind us
(§4.4: the user owns Outputs and may use and sublicense them commercially; §8: the third-party provider's
policy applies). Tripo's own terms: the owner confirmed on 2026-10-24 (mw-uuk) that they allow our use of
Tripo-generated models. See `assets/prompts/model/model-char-knight-01.md` for the full note. The CREDITS
row stays `placeholder: yes`.
