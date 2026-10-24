# model-prop-forgotten-shield-01: the shield-bearer's iron-rimmed shield (placeholder model)

**Status: owner-approved placeholder** (2026-10-24, "you're approved on all requests"): the flat (`prop-forgotten-shield-01 variant b`) and the model, recorded under mw-ju8.35 (no approvals.json yet). Still `placeholder: yes` in CREDITS because the model is unanimated (miner precedent, mw-0i5). The Tripo half of the licence is confirmed (owner, 2026-10-24, mw-uuk). Animation clips for the Forgotten variants stay in mw-ju8.23, mw-ju8.24 and mw-ju8.25.

## Generation

- Source: `prop-forgotten-shield-01 variant b` (see `assets/prompts/`), flat job `65f7b8ea-e290-4374-9592-8a6f28938b5e`.
- Provider: Tripo H3.1 (`tripo_h3_1_image_to_3d`) through Higgsfield's `generate_3d` (MCP), plan Plus, 2026-10-24,
  9 credits. Job `5d14a775-cee4-4265-a614-41400dde52f9`; `face_limit` 1500, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,360 (1,326 optimised) triangles, one material, unrigged, 0.6 m tall raw, 35 KB.

## Processing

1. `gltf-transform optimize … --compress meshopt --texture-compress webp --texture-size 512` →
   `public/assets/model/model-prop-forgotten-shield-01.glb` (held shield budget 300 to 1.5 k triangles).
2. At load: `shieldPlacement`: its face is Tripo's +x, so -90° about y turns it to the creature's +z, scaled to 0.8 m, centred just above the left hand and 0.2 m in front of the arm. Fixed to the `forearm-l` bone. Distinct from the knight's `model-prop-wooden-shield-01` (grey iron over planks, heater-shaped, violet stripe).

## Known gaps

- Static rigid mesh; no LOD1/LOD2, no KTX2 (mw-e37.8). Placement is by eye against the rig's idle pose.

## Licence (checked 2026-10-03, mw-qov; Tripo terms confirmed by the owner 2026-10-24, mw-uuk)

The jobs ran on Higgsfield (Plus plan), so Higgsfield's Terms of Use bind us (§4.4: the user owns Outputs and
may use and sublicense them commercially; §8: the third-party provider's policy applies). Tripo's own terms
were confirmed by the owner on 2026-10-24 (mw-uuk) to allow our use of Tripo-generated models. See
`assets/prompts/model/model-char-knight-01.md` for the full note. The CREDITS row stays `placeholder: yes`.
