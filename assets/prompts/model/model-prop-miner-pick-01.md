# model-prop-miner-pick-01: the miner's pick (placeholder model)

**Status: placeholder.** The flat (`prop-miner-pick-01` variant b) and the turntable are not owner-approved
(mw-2l9), and the Tripo half of the licence is confirmed (owner, 2026-10-24, mw-uuk).

## Generation

- Source: `prop-miner-pick-01` variant b (see `assets/prompts/props/`).
- Provider: Tripo H3.1 through Higgsfield's `generate_3d` (MCP), plan Plus, 2026-10-03, 9 credits. Job
  `f2f6091a-5165-480a-bd68-24a166171d68`; `face_limit` 1500, `texture` true, `pbr` false, standard quality,
  `auto_size` true.
- Raw result: 1,482 triangles, one material, 0.5 m long (Tripo's guess), lying tilted 17.9° in the y-z plane.

## Processing

1. `gltf-transform optimize … --texture-size 512` → `public/assets/model/model-prop-miner-pick-01.glb`
   (39 KB, held weapon budget 300 to 1.5 k triangles).
2. At load (`pickPlacement` in `src/render/creatures/forgotten-model.ts`): +17.9° about x so the haft stands
   upright with the head swinging fore and aft, scaled to 0.85 m, butt 0.12 m below that skeleton's right
   hand (`rightHandPoint` finds the hand from each of the four miner meshes). Rigid, in the miner's space.

## Licence (checked 2026-10-03, mw-qov; Tripo terms confirmed by the owner 2026-10-24, mw-uuk)

The job ran on Higgsfield (Plus plan), so Higgsfield's Terms of Use bind us (§4.4: the user owns Outputs and
may use and sublicense them commercially; §8: the third-party provider's policy applies). Tripo's own terms
were confirmed by the owner on 2026-10-24 (mw-uuk) to allow our use of Tripo-generated models. See
`assets/prompts/model/model-char-knight-01.md` for the full note. The CREDITS row stays `placeholder: yes`.
