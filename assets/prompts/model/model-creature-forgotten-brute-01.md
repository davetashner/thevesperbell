# model-creature-forgotten-brute-01: the Forgotten brute's skeleton (placeholder model)

**Status: owner-approved placeholder** (2026-10-24, "you're approved on all requests"): the flat (`creature-forgotten-brute-base-01 variant b`) and the model, recorded under mw-ju8.35 (no approvals.json yet). Still `placeholder: yes` in CREDITS because the model is unanimated (miner precedent, mw-0i5). The Tripo half of the licence is confirmed (owner, 2026-10-24, mw-uuk). Animation clips for the Forgotten variants stay in mw-ju8.23, mw-ju8.24 and mw-ju8.25.

## Generation

- Source: `creature-forgotten-brute-base-01 variant b` (see `assets/prompts/`), flat job `6cede322-6326-4ea0-a212-831d26d1459c`.
- Provider: Tripo H3.1 (`tripo_h3_1_image_to_3d`) through Higgsfield's `generate_3d` (MCP), plan Plus, 2026-10-24,
  9 credits. Job `333a8a33-84d5-4309-9767-fa7e459b5283`; `face_limit` 6000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 5,647 (5,577 optimised) triangles, one material, unrigged, 2.1 m tall, facing +x, A-pose, 86 KB.

## Processing

1. `gltf-transform optimize … --compress meshopt --texture-compress webp --texture-size 512` →
   `public/assets/model/model-creature-forgotten-brute-01.glb` (creature budget 2 to 6 k triangles, one 512² texture).
2. At load: `forgotten-model.ts` loads it for `forgotten-brute` only (`forgotten-kit.ts`), turns it -90° about y, stands it on the ground and scales it to the creature's nav height (2.3 m, so about 1.1x). Skinned to the shared humanoid rig like the miner, with the maul on the `sword` bone.

## Known gaps

- Static rigid mesh; no LOD1/LOD2, no KTX2 (mw-e37.8). Placement is by eye against the rig's idle pose.

## Licence (checked 2026-10-03, mw-qov; Tripo terms confirmed by the owner 2026-10-24, mw-uuk)

The jobs ran on Higgsfield (Plus plan), so Higgsfield's Terms of Use bind us (§4.4: the user owns Outputs and
may use and sublicense them commercially; §8: the third-party provider's policy applies). Tripo's own terms
were confirmed by the owner on 2026-10-24 (mw-uuk) to allow our use of Tripo-generated models. See
`assets/prompts/model/model-char-knight-01.md` for the full note. The CREDITS row stays `placeholder: yes`.
