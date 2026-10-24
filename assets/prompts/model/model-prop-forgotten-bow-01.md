# model-prop-forgotten-bow-01: the archer's bow (placeholder model)

**Status: owner-approved placeholder** (2026-10-24, "you're approved on all requests"): the flat (`prop-forgotten-bow-01 variant a`) and the model, recorded under mw-ju8.35 (no approvals.json yet). Still `placeholder: yes` in CREDITS because the model is unanimated (miner precedent, mw-0i5). The Tripo half of the licence is confirmed (owner, 2026-10-24, mw-uuk). Animation clips for the Forgotten variants stay in mw-ju8.23, mw-ju8.24 and mw-ju8.25.

## Generation

- Source: `prop-forgotten-bow-01 variant a` (see `assets/prompts/`), flat job `d12c748c-e8b3-4e54-87fc-133c5133e1ce`.
- Provider: Tripo H3.1 (`tripo_h3_1_image_to_3d`) through Higgsfield's `generate_3d` (MCP), plan Plus, 2026-10-24,
  9 credits. Job `4e0ecd79-7ae2-4531-aa96-fdf495946372`; `face_limit` 1200, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,142 (1,126 optimised) triangles, one material, unrigged, 0.85 m long raw, 39 KB.

## Processing

1. `gltf-transform optimize … --compress meshopt --texture-compress webp --texture-size 512` →
   `public/assets/model/model-prop-forgotten-bow-01.glb` (held weapon budget 300 to 1.5 k triangles).
2. At load: `bowPlacement`: +90° about y turns the belly outward (the creature's left) with the string toward the body so it reads as a bow from the front, scaled to 1.15 m, centred on the left hand (`leftHandPoint`). Fixed to the `forearm-l` bone. The arm is not posed to draw it; no arrow is modelled (animation: mw-ju8.24).

## Known gaps

- Static rigid mesh; no LOD1/LOD2, no KTX2 (mw-e37.8). Placement is by eye against the rig's idle pose.

## Licence (checked 2026-10-03, mw-qov; Tripo terms confirmed by the owner 2026-10-24, mw-uuk)

The jobs ran on Higgsfield (Plus plan), so Higgsfield's Terms of Use bind us (§4.4: the user owns Outputs and
may use and sublicense them commercially; §8: the third-party provider's policy applies). Tripo's own terms
were confirmed by the owner on 2026-10-24 (mw-uuk) to allow our use of Tripo-generated models. See
`assets/prompts/model/model-char-knight-01.md` for the full note. The CREDITS row stays `placeholder: yes`.
