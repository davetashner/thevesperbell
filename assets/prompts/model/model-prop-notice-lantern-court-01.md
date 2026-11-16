# model-prop-notice-lantern-court-01

**Status: owner-approved model** (2026-11-16, standing pre-approval; Claude passed the turntable gate).

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-harbour-wharf-set-01/prop-harbour-wharf-set-01.png` (neighbouring props blanked where they crept in), padded on parchment to a square; Higgsfield media `77ce4d7e-412b-47a2-b5ca-45da43d6890d`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `bde9fa12-343a-4c4d-8593-f87611944d69`; `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,859 triangles, 1 material, one 2048x2048 texture, bounds 0.76 × 1.2 × 1.33 (x × y × z), front on +x.
- Raw file: `assets/_incoming/model-prop-notice-lantern-court-01/v1.glb` (SHA-256 `37dd0524123c15f2f08f489874f8e84f6a48ae2016b077b340e071952517197d`), turntable `assets/_incoming/model-prop-notice-lantern-court-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-notice-lantern-court-01/v1.glb public/assets/model/model-prop-notice-lantern-court-01.glb --compress meshopt --texture-compress webp --texture-size 512` → 45 KB (SHA-256 `9758ad41a1e2d774617a6f7295806c0a0bea9c117c5c16f02aee0a71adca0302`). Not yet placed in the scene.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | via `prop-harbour-wharf-set-01` |
| turntable | v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | Claude checked the turntable: one object, readable, cues kept |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
