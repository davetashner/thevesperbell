# model-prop-brute-maul-01: the brute's two-handed maul (placeholder model)

**Status: owner-approved placeholder** (2026-10-24, "you're approved on all requests"): the flat (`prop-brute-maul-01 variant b`) and the model, recorded under mw-ju8.35 (no approvals.json yet). Still `placeholder: yes` in CREDITS because the model is unanimated (miner precedent, mw-0i5). The Tripo half of the licence is confirmed (owner, 2026-10-24, mw-uuk). Animation clips for the Forgotten variants stay in mw-ju8.23, mw-ju8.24 and mw-ju8.25.

## Generation

- Source: `prop-brute-maul-01 variant b` (see `assets/prompts/`), flat job `d2108aea-9597-449a-a682-306340664ea1`.
- Provider: Tripo H3.1 (`tripo_h3_1_image_to_3d`) through Higgsfield's `generate_3d` (MCP), plan Plus, 2026-10-24,
  9 credits. Job `3ef0a820-b638-47f6-8d1b-e9f6443cc133`; `face_limit` 1500, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,454 (1,424 optimised) triangles, one material, unrigged, 0.85 m long raw, 42 KB.

## Processing

1. `gltf-transform optimize … --compress meshopt --texture-compress webp --texture-size 512` →
   `public/assets/model/model-prop-brute-maul-01.glb` (held weapon budget 300 to 1.5 k triangles).
2. At load: `maulPlacement` (`forgotten-kit.ts`): +90° about y so the head's faces strike fore and aft, scaled to 1.6 m, haft 0.5 m below the brute's right hand (`rightHandPoint`). Fixed to the `sword` bone.

## Known gaps

- Static rigid mesh; no LOD1/LOD2, no KTX2 (mw-e37.8). Placement is by eye against the rig's idle pose.

## Licence (checked 2026-10-03, mw-qov; Tripo terms confirmed by the owner 2026-10-24, mw-uuk)

The jobs ran on Higgsfield (Plus plan), so Higgsfield's Terms of Use bind us (§4.4: the user owns Outputs and
may use and sublicense them commercially; §8: the third-party provider's policy applies). Tripo's own terms
were confirmed by the owner on 2026-10-24 (mw-uuk) to allow our use of Tripo-generated models. See
`assets/prompts/model/model-char-knight-01.md` for the full note. The CREDITS row stays `placeholder: yes`.
