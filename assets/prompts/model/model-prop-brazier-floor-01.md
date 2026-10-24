# model-prop-brazier-floor-01: the arena's floor brazier (placeholder model)

**Status: placeholder.** Flat and turntable not owner-approved (see the set-pieces approval bead), Tripo terms confirmed by the owner 2026-10-24 (mw-uuk).

## Generation

- Source: `prop-brazier-floor-01` variant b (`assets/prompts/props/prop-brazier-floor-01.md`).
- Tripo H3.1 through Higgsfield `generate_3d`, plan Plus, 2026-10-03, 9 credits. Job
  `cb5d40e8-329c-479a-8d54-ec9c0685e1ad`; `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,906 triangles, one material, 0.7 m tall. Unlit, bowl of coals.

## Processing

1. `gltf-transform optimize … --texture-size 512` → `public/assets/model/model-prop-brazier-floor-01.glb` (40 KB).
2. At load (`brazierPlacement`, `src/render/props/set-pieces.ts`): scaled to 0.9 m and stood on the floor.
   **The spawn moved:** `arena-brazier` is now at y = 0.75 (was 0), the height of the coals, so the light rig's
   flame burns in the bowl instead of under it. The fire hazard tests a sphere against the whole character
   capsule, so it still reaches a character standing beside it (docs/design/vertical-slice.md).

## Licence (checked 2026-10-03, mw-qov; Tripo terms confirmed by the owner 2026-10-24, mw-uuk)

The job ran on Higgsfield (Plus plan), so Higgsfield's Terms of Use bind us (§4.4: the user owns Outputs and
may use and sublicense them commercially; §8: the third-party provider's policy applies). Tripo's own terms
were confirmed by the owner on 2026-10-24 (mw-uuk) to allow our use of Tripo-generated models. See
`assets/prompts/model/model-char-knight-01.md` for the full note. The CREDITS row stays `placeholder: yes`.
