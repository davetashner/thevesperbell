# model-npc-{ottilie,dot,watchman,hollis,juniper,oswin,garrick,rooke}-01: the Briar Glen townsfolk's placeholder bodies

**Status: owner-approved placeholder** (2026-10-24, "you're approved on all requests"): the flats (Ottilie's earlier, mw-ju8.8) and the six models, recorded under mw-ju8.36 (no approvals.json yet). Still `placeholder: yes` in CREDITS because the models are static and unanimated (miner precedent, mw-0i5). The Tripo half of the licence is confirmed (owner, 2026-10-24, mw-uuk). Beads: mw-ju8.34 (Ottilie, Dot, watchmen), mw-ju8.37 (Hollis, Juniper, Oswin). Garrick and Rooke (mw-ju8.13, Bridgeward College) and Idris Quillon (mw-ju8.14, the sorcery teacher under the bridge) were added 2026-10-24 under the same owner pre-approval.

Nine models cover all ten NPCs: Ottilie, Dot, Hollis, Juniper, Oswin, the day and night watchmen (one shared
`model-npc-watchman-01`), the Bridgeward College's two instructors, Garrick and Rooke, and Idris Quillon, the sorcery teacher under the Miners' Bridge.

## Models

All nine: Tripo H3.1 (`tripo_h3_1_image_to_3d`) through Higgsfield `generate_3d` (MCP), plan Plus, 2026-10-24,
9 credits each (81 in all; the first three on 2026-10-24 by mw-ju8.34, the next three by mw-ju8.37, Garrick and Rooke by mw-ju8.13, Quillon by mw-ju8.14), `face_limit` 6000, `texture` true, `pbr` false, standard quality, `auto_size` true.
About 5.5 to 5.8 k triangles, 1.7 to 1.75 m tall, one 512² texture, 70 to 80 KB optimised.

| Asset id | NPC | Source flat (front view cropped) | Tripo job |
|---|---|---|---|
| `model-npc-ottilie-01` | npc-ottilie | `char-ottilie-marsh-base-01` (owner-approved, reused) | `8207ae00-a9e0-4afc-a52c-f528eab291c7` |
| `model-npc-dot-01` | npc-dot | `char-dot-farrow-base-01` b | `78052e70-3a94-4b17-bf05-1990e2522abb` |
| `model-npc-watchman-01` | npc-watchman-day, npc-watchman-night | `char-watchman-base-01` a | `9c93bfb4-0aea-4e35-85a4-1b7a85d027fe` |
| `model-npc-hollis-01` | npc-hollis | `char-hollis-pell-base-01` b | `a106703e-f660-4420-911c-e2abb332f804` |
| `model-npc-juniper-01` | npc-juniper | `char-juniper-fenn-base-01` a | `a1aa155a-2428-4d28-ab12-2fadebc3a609` |
| `model-npc-oswin-01` | npc-oswin | `char-oswin-brand-base-01` b | `fa7b1179-a197-4357-88c9-0d00e07b51cc` |
| `model-npc-garrick-01` | npc-garrick | `char-maud-garrick-base-01` a | `fefcf521-e69f-4481-a73a-db925b26b967` |
| `model-npc-rooke-01` | npc-rooke | `char-ewan-rooke-base-01` a | `94f66855-3fac-4ee9-a778-5146948e52af` |
| `model-npc-quillon-01` | npc-quillon | `char-idris-quillon-base-01` a | `b0090db0-5a57-4e2e-8cff-464ab206590f` |

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
   capsule, keyed on `presentation.mesh` (`npc-ottilie`, `npc-dot`, `npc-watchman`, `npc-garrick`, `npc-rooke`, `npc-quillon`). If the model never loads the capsule stays.

## Crop lesson

A first batch of six cropped the sheet wrongly (`sips -c` with `--cropOffset 0 0` centres the crop, giving the 3/4 and side
views, so Tripo built two figures; 54 credits wasted). The three here used `ffmpeg -vf crop=368:752:0:0`, each
crop checked by eye to hold exactly one figure before the job ran (2026-10-24, mw-ju8.37). Garrick and Rooke (mw-ju8.13) used the same crop, checked the same way: 18 credits, no waste. Quillon (mw-ju8.14) the same: front view `crop=368:752:0:0`, read and confirmed as one full-body figure before the 9-credit job; 9 credits, no waste.

## Known gaps

- **Static, one pose.** NPCs have no animation driver; they slide and keep the A-pose.
- The watchmen are one model; the day and night guards look identical.
- Weapons and tools (Juniper's bow, Oswin's hammer) are not modelled; hands are empty.
- No LOD1/LOD2, no KTX2 (mw-e37.8).

## Licence (checked 2026-10-03, mw-qov; Tripo terms confirmed by the owner 2026-10-24, mw-uuk)

As for the Forgotten miner (`model-creature-forgotten-miner-01.md`): Higgsfield's Terms of Use bind us
(§4.4, §8); Tripo's own terms are confirmed by the owner, 2026-10-24 (mw-uuk). The CREDITS rows stay `placeholder: yes`.
