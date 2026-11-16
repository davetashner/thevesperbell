# prop-harbour-story-set-01

**Status: owner-approved concept** (v1, approved 2026-11-16, "They look great"). From the `e37-asset-props-harbour-story-concept-prompts` set (plan/assets-harbor.json).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `prop-harbour-story-set-01` |
| Category | prop |
| Consuming bead(s) | `e37-asset-props-harbour-story-*` (`model-prop-bay-door-seal-01`, `model-prop-relic-crate-01`, `model-prop-ballast-crate-01`, `model-prop-cargo-scale-01`, `model-prop-strongroom-door-01`, `model-prop-shelf-cray-01`), `e40-bonded-warehouse`, `e40-customs-house` |
| Template | `_templates/prop-sheet.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, plan plus, 2026-11-16, job `2f7cb7c5-70ba-44fc-968c-bc8888517158` |
| Reference inputs | approved style anchors `prop-marsh-store-set-01` (media `13347870-e15e-4ec9-936c-465b447fc295`) and `prop-harbour-cask-set-01` (job `a96511e4-7938-4204-b3c9-6b7f08462886`) |
| Staging copy | `assets/_incoming/prop-harbour-story-set-01/v1.png` (gitignored) |

## 2. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: the bay nine heist pieces of the Wendmouth Bonded Warehouse and Customs House. Wendmouth palette: salt-grey glenstone #9C9788, harbour stone #7E8584, tarred plank #2F2A28, sea grey-green #5E7A7A, sail canvas #E6D9BC, net tan #B08A58. Worked wood #8A6440, bark #5A3E2B, iron in ink-violet #1E1B2E, brass #C9A042.
PROPS (left to right, top to bottom): 1-3. the same heavy plank bay door with a round wax customs seal on a cord across its iron hasp, shown three times: intact (a whole red-wax disc #8E2F2F with a pressed lantern-in-ring emblem, cord taut), broken (the wax disc split in two, cord hanging loose, one half on the floor), and re-sealed (a fresh brighter wax disc #C8553D on top of the old broken one, cord re-tied in a different knot); the three states must read apart at 3 m by shape, not only colour; 4-5. two identical sturdy iron-bound export crates side by side, closed, the same size, planks and stencil-free lids; on the right-hand one the lid is lifted to show it is packed with dressed grey ballast stone blocks #8C8A80, on the left-hand one the lid is lifted to show straw packing around a dark shrouded bundle wrapped in oilcloth; 6. a tall customs cargo scale: a brass beam balance on an oak post with two big hanging iron pans and a stack of iron weights; 7. a squat strongroom door of black iron plates and rivets in a stone frame with a large black-steel lock plate, a heavy bar and a dial-less keyhole (reads hard to pick); 8. a well-read bookshelf of starched official ledgers on the front with a row of soft, colourful, much-thumbed romance novels hidden behind them (blank spines, no lettering).
SYSTEMIC CUES: the strongroom lock is black-steel (hard, style bible §7); the crates are not breakable — no pale wood, no nail-heads.
SHAPE: chunky, bevelled, heavy proportions; big–medium–small; readable at 10 m.
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
| 1 | 2026-11-16 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/prop-harbour-story-set-01/v1.png` | approved — three seal states read apart by shape (taut cord / loose halves on the floor / re-tied knot over the old wax); crates identical outside; black-steel strongroom lock; romances behind ledgers. Scale figure is a full character, not an outline. |

## 6. Files

Source `assets/source/prop/prop-harbour-story-set-01/prop-harbour-story-set-01.png` (sha256 `51327ce80b154571d87923812fe997634f911a10b294bff2ee1ca6b9dea77548`).
