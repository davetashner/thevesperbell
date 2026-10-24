# model-prop-wall-torch-01: the slice's wall torch (placeholder model)

**Status: placeholder.** Flat and turntable not owner-approved (mw-0i5 family; see the set-pieces approval bead), Tripo terms confirmed by the owner 2026-10-24 (mw-uuk).

## Generation

- Source: `prop-wall-torch-01` variant **b**, the owner's choice (`assets/prompts/props/prop-wall-torch-01.md`).
  Variant a was modelled first (job `e4284410-12f9-42c8-bb91-dff441f9a3ec`, 1,478 triangles) and replaced.
- Tripo H3.1 through Higgsfield `generate_3d`, plan Plus, 2026-10-03, 9 credits. Job
  `7c4bff2b-6088-4c6b-a717-29b8311bb603`; `face_limit` 1500, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,422 triangles, one material, 0.5 m tall, wall plate on −z, head up. No flame (the flame is
  the light rig's sphere at the spawn point).

## Processing

1. `gltf-transform optimize … --texture-size 512` → `public/assets/model/model-prop-wall-torch-01.glb` (33 KB).
2. At load (`TORCH_PLACEMENT`, `src/render/props/set-pieces.ts`): turned 90° about y (plate −z to −x), scaled to 0.7 m, its head 5 cm under the
   spawn point so the flame sits on it. `src/render/greybox/index.ts` swaps it in for the bracket stand-in on
   spawns tagged `torch` (the stand-in stays if it fails to load) and turns it 180° for a torch east of
   the room's centreline so the wall plate meets the wall.

## Known gaps

- The torch is oriented by the sign of its x (the slice's rooms are symmetric about x = 0); a scene with
  a torch on a north or south wall needs a yaw on the spawn.

## Licence (checked 2026-10-03, mw-qov; Tripo terms confirmed by the owner 2026-10-24, mw-uuk)

The job ran on Higgsfield (Plus plan), so Higgsfield's Terms of Use bind us (§4.4: the user owns Outputs and
may use and sublicense them commercially; §8: the third-party provider's policy applies). Tripo's own terms
were confirmed by the owner on 2026-10-24 (mw-uuk) to allow our use of Tripo-generated models. See
`assets/prompts/model/model-char-knight-01.md` for the full note. The CREDITS row stays `placeholder: yes`.
