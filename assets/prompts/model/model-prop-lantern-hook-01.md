# model-prop-lantern-hook-01

**Status: owner-approved model** (2026-11-16, standing pre-approval; Claude passed the turntable gate).

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-harbour-rooftop-set-01/prop-harbour-rooftop-set-01.png` (neighbouring props blanked where they crept in), padded on parchment to a square; Higgsfield media `b4f2ae27-2811-42af-bd11-6f29c486dda9`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `71292922-fa1a-46ed-a89b-41d0ba5f3d8a`; `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,898 triangles, 1 material, one 2048x2048 texture, bounds 0.13 × 0.5 × 0.5 (x × y × z), front on +x.
- Raw file: `assets/_incoming/model-prop-lantern-hook-01/v1.glb` (SHA-256 `ed154a8ebae96ef60ce9f835bf4c4143f79b6de3fcd4dc1adfadbac61f5fc16b`), turntable `assets/_incoming/model-prop-lantern-hook-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-lantern-hook-01/v1.glb public/assets/model/model-prop-lantern-hook-01.glb --compress meshopt --texture-compress webp --texture-size 512` → 39 KB (SHA-256 `70d06bf62a2885f23f613139438e7a1a15e9e743e057a70df4cd6f86b6ac4e79`). Not yet placed in the scene.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | via `prop-harbour-rooftop-set-01` |
| turntable | v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | Claude checked the turntable: one object, readable, cues kept |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
