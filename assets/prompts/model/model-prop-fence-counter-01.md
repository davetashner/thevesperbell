# model-prop-fence-counter-01

**Status: owner-approved model** (2026-11-16, standing pre-approval; Claude passed the turntable gate).

## Single image (input to image-to-3D)

Cropped from the approved sheet `assets/source/prop/prop-harbour-rooftop-set-01/prop-harbour-rooftop-set-01.png` (neighbouring props blanked where they crept in), padded on parchment to a square; Higgsfield media `4918b714-2bed-4ccc-80d1-e935e00dc0c9`. No prompt: a crop of the approved sheet.

## Generation

- Tripo H3.1 through Higgsfield `generate_3d` (`tripo_h3_1_image_to_3d`), plan Plus, 2026-11-16, 9 credits. Job `3ab76a0f-0b84-41ab-924d-02e6e641e609`; `face_limit` 2000, `texture` true, `pbr` false, `auto_size` true.
- Raw result: 1,892 triangles, 1 material, one 2048x2048 texture, bounds 0.45 × 0.85 × 0.99 (x × y × z), front on +x.
- Raw file: `assets/_incoming/model-prop-fence-counter-01/v1.glb` (SHA-256 `3d84983ce60a981c59bd58c3f3601a2a2078d88fbd723bbcccd4747b595d299f`), turntable `assets/_incoming/model-prop-fence-counter-01/v1-turntable.png`.

## Processing

`npx @gltf-transform/cli@4.5.1 optimize assets/_incoming/model-prop-fence-counter-01/v1.glb public/assets/model/model-prop-fence-counter-01.glb --compress meshopt --texture-compress webp --texture-size 512` → 48 KB (SHA-256 `c15ed12915c3a41b45c69ab4ca577511d298800285fd9968a60ce9c2b69d8517`). Not yet placed in the scene.

## Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | sheet v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | via `prop-harbour-rooftop-set-01` |
| turntable | v1 | approved | owner (standing pre-approval 2026-11-16) | 2026-11-16 | Claude checked the turntable: one object, readable, cues kept |

## Licence

Higgsfield Plus (Terms of Use §4.4) and Tripo's terms (owner-confirmed 2026-10-24, mw-uuk).
