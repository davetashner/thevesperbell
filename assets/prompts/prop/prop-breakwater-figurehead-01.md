# prop-breakwater-figurehead-01

**Status: owner-approved concept** (v1, approved 2026-11-16, "They look great"). From the `e37-asset-props-harbour-story-concept-prompts` set (plan/assets-harbor.json).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `prop-breakwater-figurehead-01` |
| Category | prop |
| Consuming bead(s) | `e37-asset-props-harbour-story-*` (`model-prop-figurehead-serpent-01`, `model-prop-sea-door-01`), `e40-breakwater-sea-door` |
| Template | `_templates/prop-sheet.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, plan plus, 2026-11-16, job `74d9cac1-e61d-40d4-a227-74fc5dd0106b` |
| Reference inputs | approved style anchors `prop-marsh-store-set-01` (media `13347870-e15e-4ec9-936c-465b447fc295`) and `prop-harbour-cask-set-01` (job `a96511e4-7938-4204-b3c9-6b7f08462886`) |
| Staging copy | `assets/_incoming/prop-breakwater-figurehead-01/v1.png` (gitignored) |

## 2. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: the sunken figurehead and the smugglers' sea-door under the Wendmouth breakwater. Harbour stone #7E8584, salt-grey glenstone #9C9788, sea grey-green #5E7A7A, weed #2F4A3A, barnacle cream #D8CDB4, iron ink-violet #1E1B2E, old gilt #C9A042.
PROPS (left to right): 1. an old sunken ship's figurehead carved as a sea-serpent's head and long arched neck, carved timber gone grey-green and crusted with barnacles and weed, gilt flaking, mouth open; two big round glass "lantern eyes" set in its head glowing a faint warm amber #FFB85C; it reads as a monster when seen low from the water surface and as an old wooden carving up close (visible chisel cuts, iron mounting bolts in the neck); 2. the same figurehead seen from the side; 3. the barnacled, iron-bound smugglers' sea-door: a low arched door of black-tarred planks with three heavy iron straps and a ring handle, set in a weed-hung glenstone block wall, barnacles along a clear tide line halfway up; a simple iron lock plate.
SHAPE: chunky, bevelled, heavy proportions; the serpent head is the big shape, the eyes the focal points.
SCALE REFERENCE: include a small 1.8 m human outline at the edge.
REFERENCE IMAGES: the attached painted images are approved in-game style anchors for this harbour: match their brushwork, bevel size, lighting and palette.
```

## 3. Output spec

3:2, 2k flat concept on parchment for the image-to-3D flow; models: small 50–400 tris, medium 400–2 k, large 2–5 k (LOD1 50 %), one prop atlas, one material per set (style bible §13.2).

## 4. Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image | v1 | approved | owner | 2026-11-16 | "They look great" (session chat; `assets/approvals.json` does not exist yet) |

## 5. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-16 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/prop-breakwater-figurehead-01/v1.png` | approved — serpent head with amber lantern eyes, barnacles and weed, iron bolts; sea-door with tide line, ring handle and iron lock plate. Scale figure is a full character. |

## 6. Files

Source `assets/source/prop/prop-breakwater-figurehead-01/prop-breakwater-figurehead-01.png` (sha256 `ffdd209f2a11e231959837c6a0e9c5cf7675bb5d9d4468f587e7a56cae3dcf0f`).
