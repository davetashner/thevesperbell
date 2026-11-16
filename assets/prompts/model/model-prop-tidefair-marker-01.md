# model-prop-tidefair-marker-01

**Status: owner-approved model** (2026-11-16, standing pre-approval; Claude passed the turntable gate).

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-harbour-wharf-set-01/prop-harbour-wharf-set-01.png` (neighbouring props blanked where they crept in), padded on parchment to a square; Higgsfield media `a4d4df97-97e7-4cd2-9eba-9a2f7bbd9e6f`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `12dd19eb-d84b-41a7-880e-a0a8c8e82a77`; `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,860 triangles, 1 material, one 2048x2048 texture, bounds 0.96 × 2.5 × 1.27 (x × y × z), front on +x.
- Raw file: `assets/_incoming/model-prop-tidefair-marker-01/v1.glb` (SHA-256 `5ea025d7ba074f413cb4baf748dd4fdb4e95fa594804eb53bb73279901237b4f`), turntable `assets/_incoming/model-prop-tidefair-marker-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-tidefair-marker-01/v1.glb public/assets/model/model-prop-tidefair-marker-01.glb --compress meshopt --texture-compress webp --texture-size 512` → 45 KB (SHA-256 `7197553c85bed6101a200829125943e854463c42587e947baaac5750c6c199df`). Not yet placed in the scene.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | via `prop-harbour-wharf-set-01` |
| turntable | v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | Claude checked the turntable: one object, readable, cues kept |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
