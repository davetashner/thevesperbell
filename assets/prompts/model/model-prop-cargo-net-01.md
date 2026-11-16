# model-prop-cargo-net-01

**Status: owner-approved model** (2026-11-16, standing pre-approval; Claude passed the turntable gate).

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-harbour-wharf-set-01/prop-harbour-wharf-set-01.png` (neighbouring props blanked where they crept in), padded on parchment to a square; Higgsfield media `f0cc4609-91e0-4998-883b-2a3b72c5670d`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `0af6a673-b796-4e8a-b767-dd62c875e83d`; `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,966 triangles, 1 material, one 2048x2048 texture, bounds 0.35 × 0.8 × 0.51 (x × y × z), front on +x.
- Raw file: `assets/_incoming/model-prop-cargo-net-01/v1.glb` (SHA-256 `26ab231e09beceb192ffc153944a55c90232424cccf4682b165fd7e4ca6bef7a`), turntable `assets/_incoming/model-prop-cargo-net-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-cargo-net-01/v1.glb public/assets/model/model-prop-cargo-net-01.glb --compress meshopt --texture-compress webp --texture-size 512` → 32 KB (SHA-256 `0530498a0b2a5d9a3e9193a8136365b503a1da3d0f69edf169f1bdc3323647f9`). Not yet placed in the scene.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | via `prop-harbour-wharf-set-01` |
| turntable | v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | Claude checked the turntable: one object, readable, cues kept |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
