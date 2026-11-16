# model-prop-wharf-crane-01

**Status: owner-approved model** (2026-11-16, standing pre-approval; Claude passed the turntable gate).

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-harbour-wharf-set-01/prop-harbour-wharf-set-01.png` (neighbouring props blanked where they crept in), padded on parchment to a square; Higgsfield media `bc54320a-c35f-46e8-aae9-10cf5479b594`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `6ddc8bfe-8bdc-44c3-bf79-4d8e8fee1433`; `face_limit` 5000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 4,672 triangles, 1 material, one 2048x2048 texture, bounds 3.2 × 2.5 × 3.94 (x × y × z), front on +x.
- Raw file: `assets/_incoming/model-prop-wharf-crane-01/v1.glb` (SHA-256 `a188ae48eac9944ead16034c0f17d04e0b98fdc58fd94609b9a52bdae8496f95`), turntable `assets/_incoming/model-prop-wharf-crane-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-wharf-crane-01/v1.glb public/assets/model/model-prop-wharf-crane-01.glb --compress meshopt --texture-compress webp --texture-size 1024` → 129 KB (SHA-256 `c60bb212b0bde20251b51503d47dbd8c4291107ba7f3d2764fc1b655bd55a4a5`). Not yet placed in the scene.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | via `prop-harbour-wharf-set-01` |
| turntable | v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | Claude checked the turntable: one object, readable, cues kept |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
