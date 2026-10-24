# model-creature-forgotten-miner-01 to -04: the Forgotten miner's four looks (placeholder models)

**Status: placeholder.** None of the flats (`creature-forgotten-miner-base-01` variants a to d) or turntables
is owner-approved yet (mw-0i5), and the Tripo half of the licence is confirmed (owner, 2026-10-24, mw-uuk).

## The four looks (mw-1ja)

Each flat variant is its own model. A miner wears one of them, drawn at random per game session (see
Processing). All four: Tripo H3.1 through Higgsfield `generate_3d`, plan Plus, 2026-10-03, 9 credits each,
`face_limit` 6000, `texture` true, `pbr` false, standard quality, `auto_size` true; about 5.9 k triangles,
1.8 m tall, one 512² texture, 92 to 99 KB optimised.

| Asset id | Flat variant | Flat job | Tripo job |
|---|---|---|---|
| `model-creature-forgotten-miner-01` | b | `f4e10e41-3594-4b23-8f7c-06dccb63c109` | `6185891b-49c1-4b5e-82f5-056bd3e8aff4` |
| `model-creature-forgotten-miner-02` | a | `05e63dd5-89a5-41d7-a023-9794db1d0b2c` | `80c99842-c5a0-4b4f-a418-2ac0cdf70ac5` |
| `model-creature-forgotten-miner-03` | c | `f1a81981-c24c-4999-8eab-94d0b04d9d92` | `65e22e59-7153-4aae-8744-40a8d0de7ff3` |
| `model-creature-forgotten-miner-04` | d | `c2c220e0-acab-45b9-bac0-3e83f4689e57` | `6b439de2-7f6e-4a73-8c19-5bc35f8843dd` |

## Generation

- Source: `creature-forgotten-miner-base-01` variants a to d (see `assets/prompts/creature/`); the job table
  above lists each. The text below describes `-01` (variant b); the others differ only in their source.
- Provider: Tripo H3.1 (`tripo_h3_1_image_to_3d`) through Higgsfield's `generate_3d` (MCP), plan Plus,
  2026-10-03, 9 credits. Job `6185891b-49c1-4b5e-82f5-056bd3e8aff4`; `face_limit` 6000, `texture` true,
  `pbr` false, standard quality, `auto_size` true.
- Raw result: 5,936 triangles, one material, unrigged, 1.8 m tall, facing +x, A-pose. The cold eye glow is
  painted into the base colour.

## Processing

1. `gltf-transform optimize … --compress meshopt --texture-compress webp --texture-size 512` →
   `public/assets/model/model-creature-forgotten-miner-01.glb` (93 KB; standard creature budget 2 to 6 k
   triangles, one 512² texture).
2. At load (`src/render/creatures/forgotten-model.ts`): turned −90° about y so it faces +z (creatures face
   +z), stood on the ground, scaled to the creature's nav height. `createCreatureProxy` swaps it in for the
   placeholder capsule once loaded and keeps the capsule if it never loads. The material is cloned per
   creature so the telegraph glow lights one miner at a time.
3. Which look: `pickVariant` (src/render/creatures/variant.ts) hashes a random per-session salt (the
   browser's crypto source; the project bans Math.random) with the miner's entity id, so one game's miners
   can differ from each other, a new game looks different, and a session never changes a miner's look. It is
   visual only: the sim and its seed are untouched. `?miner=1` to `?miner=4` pins a look for tests and
   screenshots. A saved game reloaded in a new session may show a different look.
4. The pick is set in each skeleton's own right hand (`rightHandPoint` finds it from the mesh), so it needs
   no per-look tuning.

## Known gaps

- **Static.** Creatures have no animation driver yet, so the miner slides and does not walk or swing
  (animation integration: mw-e37.401, mw-e37.402). It is a rigid mesh, not skinned.
- The pick floats in an open hand (the hands are open in the A-pose).
- No LOD1/LOD2, no KTX2 (mw-e37.8).

## Licence (checked 2026-10-03, mw-qov; Tripo terms confirmed by the owner 2026-10-24, mw-uuk)

The job ran on Higgsfield (Plus plan), so Higgsfield's Terms of Use bind us (§4.4: the user owns Outputs and
may use and sublicense them commercially; §8: the third-party provider's policy applies). Tripo's own terms
were confirmed by the owner on 2026-10-24 (mw-uuk) to allow our use of Tripo-generated models. See
`assets/prompts/model/model-char-knight-01.md` for the full note. The CREDITS row stays `placeholder: yes`.
