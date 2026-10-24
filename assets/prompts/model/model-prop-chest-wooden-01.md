# model-prop-chest-wooden-01: the loot alcove's chest (placeholder model)

**Status: placeholder.** Flat and turntable not owner-approved (mw-va0 approval bead), Tripo terms confirmed by the owner 2026-10-24 (mw-uuk).

## Generation

- Source: `prop-chest-wooden-01` variant a (`assets/prompts/props/prop-chest-wooden-01.md`).
- Tripo H3.1 through Higgsfield `generate_3d`, plan Plus, 2026-10-03, 9 credits. Job
  `5192cf08-9cc7-4e70-9a30-11085763b823`; `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,713 triangles, one material, 0.45 m tall, 0.57 m wide, lock on +x.

## Processing

1. `gltf-transform optimize … --texture-size 512` → `public/assets/model/model-prop-chest-wooden-01.glb` (46 KB).
2. At load (`CHEST_PLACEMENT`, `src/render/props/set-pieces.ts`): turned 180° about y so the lock faces −x
   (west into the arena, from the east alcove), scaled to 0.6 m tall, standing on its spawn point.
   `createGreyboxView` swaps it in for the box stand-in on container spawns (the box stays if it fails to load).

## Known gaps

- Closed only: opening the chest has no animation yet (the lid does not lift).
- It faces west whatever scene it is in; a chest elsewhere needs a yaw on its spawn.

## Licence (checked 2026-10-03, mw-qov; Tripo terms confirmed by the owner 2026-10-24, mw-uuk)

The job ran on Higgsfield (Plus plan), so Higgsfield's Terms of Use bind us (§4.4: the user owns Outputs and
may use and sublicense them commercially; §8: the third-party provider's policy applies). Tripo's own terms
were confirmed by the owner on 2026-10-24 (mw-uuk) to allow our use of Tripo-generated models. See
`assets/prompts/model/model-char-knight-01.md` for the full note. The CREDITS row stays `placeholder: yes`.
