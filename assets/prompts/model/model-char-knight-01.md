# model-char-knight-01 — the knight (placeholder model)

**Status: placeholder.** Not owner-approved (no turntable approval, mw-e37.21 AC-6 open) and the
licence is verified on the Higgsfield side only (see Licence). Replace before m3 unless both are settled.

## Source

- Approved flat: `char-knight-base-01` v1 (four-view sheet, ChatGPT image generation), sheet sha256
  `2ccb44e05f5c58250afcd699f134aed54893fd4b76a23508376decb86d0864d4`.
- v1 of this model came from the sheet's front view and had the sword and shield fused into the body
  (and the whole sheet makes Tripo build four knights, job `e374cfdd-41d6-4f62-84ae-fa9f55f7e1c4`, discarded).
- **v2 (current)** is from a derived flat: the front view edited to remove the sword and shield, hands
  empty, neutral A-pose, same armour and colours. Higgsfield `gpt_image_2_5`, 2026-10-03, 0.25 credits per
  image, job `e7f8f3d9-a600-4a8c-91c9-e065bdbc23a4` (the second variant, `1f1fc055-…`, was not used). This
  derived image has **not** had the owner's flat-image approval.

## Generation

- Provider: Tripo H3.1 (`tripo_h3_1_image_to_3d`) through Higgsfield's `generate_3d` (MCP), plan Plus,
  2026-10-03, 9 credits. Job `47d7a533-3d63-4344-9c6d-26689dc790ec`; `face_limit` 10000, `texture` true,
  `pbr` false, `texture_quality` / `geometry_quality` standard, `quad` false, `auto_size` true.
- Raw result: 9,456 triangles, one material, one 2048² JPEG base-colour texture, unrigged, facing +x, A-pose.

## Licence (checked 2026-10-03, mw-qov; Tripo terms confirmed by the owner 2026-10-24, mw-uuk)

The job ran on Higgsfield (Plus plan), so Higgsfield's terms are the ones that bind us.

- **Higgsfield Terms of Use** (https://higgsfield.ai/terms-of-use-agreement; the Terms page and the
  update post give different effective dates, 2026-07-26 and 2026-08-27, so re-read before relying on
  a section number):
  - §4.4: Higgsfield "does not claim ownership of any of your Inputs or Outputs, nor does it restrict
    your commercial use of Outputs"; rights in exported Outputs survive cancellation and can be
    transferred or sublicensed. Help page (modified 2026-09-12): commercial rights are not tied to a plan.
  - §4.4: Outputs "may not be unique across users" and Higgsfield may use Inputs and Outputs to train
    its models; no uniqueness or originality warranty (§13.2). Nothing here stops us publishing the GLB.
  - §8: models supplied by a third party (here Tripo) come with that provider's acceptable-use policy.
  - §5.2(iv): do not use Outputs to train a machine-learning model. We do not.
- **Tripo's own terms: confirmed by the owner on 2026-10-24 (mw-uuk)** to allow our use of Tripo-generated
  models (knight, miners, town NPCs, gear). Earlier checks could not read tripo3d.ai (403 to automated fetches).
  The CREDITS row stays `placeholder: yes` for the other reason: the turntable and rig are not approved.

## Processing

1. `gltf-transform optimize … --compress meshopt --texture-compress webp --texture-size 1024` →
   `public/assets/model/model-char-knight-01.glb` (167 KB, 9,337 triangles; with the sword and shield
   about 12.1 k, a little over the §13.2 character budget of 8 to 12 k).
2. At load (`src/render/player/knight-model.ts`): turned to face −z, stood on the ground, and skinned to
   the grey-box humanoid rig (`src/render/animation/auto-skin.ts`): each vertex binds to the nearest bones,
   with a radius per bone so the torso keeps its own cloth, a lateral limit so a side limb cannot drag the
   tabard, and the `sword` bone excluded (the sword is its own prop, `model-prop-arming-sword-01`; the
   shield is `model-prop-wooden-shield-01`).

## Known gaps

- Automatic weights: at extreme poses (arm raised 70° to 120°) a hairline sliver of tabard edge still
  stretches from the shoulder. Hand weights or a Meshy rig would remove it.
- No LOD1, no KTX2 (e37-model-import-pipeline, mw-e37.8).
- The turntable and the derived flat image still need the owner's approval.
