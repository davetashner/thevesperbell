# model-npc-{ottilie,dot,watchman}-01: the Briar Glen townsfolk's placeholder bodies

**Status: placeholder.** None of the flats or turntables is owner-approved yet (the NPC approval bead filed
with mw-ju8.34), and the Tripo half of the licence is unconfirmed (mw-uuk). Bead: mw-ju8.34.

Three models cover four of the seven NPCs: Ottilie, Dot, and the day and night watchmen (one shared
`model-npc-watchman-01`). Hollis, Juniper and Oswin are still capsules (see Not done).

## Models

All three: Tripo H3.1 (`tripo_h3_1_image_to_3d`) through Higgsfield `generate_3d` (MCP), plan Plus, 2026-10-24,
9 credits each (27 in all), `face_limit` 6000, `texture` true, `pbr` false, standard quality, `auto_size` true.
About 5.5 to 5.8 k triangles, 1.7 to 1.75 m tall, one 512² texture, 70 to 80 KB optimised.

| Asset id | NPC | Source flat (front view cropped) | Tripo job |
|---|---|---|---|
| `model-npc-ottilie-01` | npc-ottilie | `char-ottilie-marsh-base-01` (owner-approved, reused) | `8207ae00-a9e0-4afc-a52c-f528eab291c7` |
| `model-npc-dot-01` | npc-dot | `char-dot-farrow-base-01` b | `78052e70-3a94-4b17-bf05-1990e2522abb` |
| `model-npc-watchman-01` | npc-watchman-day, npc-watchman-night | `char-watchman-base-01` a | `9c93bfb4-0aea-4e35-85a4-1b7a85d027fe` |

## Generation

- Each flat is a four-view turnaround sheet (1344x752). A whole sheet makes Tripo build four characters
  (see `model-char-knight-01.md`), so the front view alone (the left 368 px, `ffmpeg -vf crop=368:752:0:0`)
  was uploaded (`media_upload`, PUT, `media_confirm`) and passed as the image reference. Crops live in
  `assets/_incoming/front2/` (gitignored).
- Raw result: 5.7 to 5.9 k triangles, one material, unrigged, A-pose, front facing +x, centred on the origin.

## Processing

1. `gltf-transform optimize … --compress meshopt --texture-compress webp --texture-size 512` →
   `public/assets/model/model-npc-<name>-01.glb`.
2. At load (`src/render/creatures/npc-model.ts`): turned −90° about y so it faces +z (creatures face +z) and
   stood on the ground; `createCreatureProxy` scales it to the creature's nav height and swaps it in for the
   capsule, keyed on `presentation.mesh` (`npc-ottilie`, `npc-dot`, `npc-watchman`). If the model never loads the capsule stays.

## Not done

Hollis, Juniper and Oswin have approved-candidate flats (`char-hollis-pell-base-01` b, `char-juniper-fenn-base-01` a,
`char-oswin-brand-base-01` b) but no model: a first batch of all six cropped the sheet wrongly (the 3/4 and side
views instead of the front, so Tripo built two figures; 54 credits wasted) and the credit cap allowed only three
redos. The crop that works is `ffmpeg -vf crop=368:752:0:0` (sips `-c` with `--cropOffset 0 0` centres the crop).
Their Tripo runs (9 credits each) are tracked in the follow-up bead.

## Known gaps

- **Static, one pose.** NPCs have no animation driver; they slide and keep the A-pose.
- The watchmen are one model; the day and night guards look identical.
- Weapons and tools (Juniper's bow, Oswin's hammer) are not modelled; hands are empty.
- No LOD1/LOD2, no KTX2 (mw-e37.8).

## Licence (checked 2026-10-03, mw-qov; open item mw-uuk)

As for the Forgotten miner (`model-creature-forgotten-miner-01.md`): Higgsfield's Terms of Use bind us
(§4.4, §8); Tripo's own terms are unconfirmed (mw-uuk). The CREDITS rows stay `placeholder: yes`.
