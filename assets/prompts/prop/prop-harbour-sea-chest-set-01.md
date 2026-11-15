# prop-harbour-sea-chest-set-01

**Status: owner-approved concept** (2026-11-15, "They all look great!"). Made from the owner's dock and ship reference photos.

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `prop-harbour-sea-chest-set-01` |
| Category | prop |
| Consuming bead(s) | `e40-gilded-tern` (crew chests, locked berth), `e40-undertow` (smuggler strongbox), `e37-asset-props-harbour-waterfront-kit-*` (`model-prop-smuggler-crate-01`) |
| Template | `_templates/prop-sheet.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, resolution 2k, aspect 3:2, account plan "plus" |
| Higgsfield job | `0c21ccbd-a107-4ede-a238-4d2dd84bb916` |
| Output | `assets/source/prop/prop-harbour-sea-chest-set-01/prop-harbour-sea-chest-set-01.png` (SHA-256 `b242ca7f0f503daf3746d974dd47c4ef27e4dc6775de47e8bae8ade97ac946eb`) |
| Staging copy | `assets/_incoming/prop-harbour-sea-chest-set-01/v1.png` (gitignored) |

### Reference inputs

- Owner's reference photo IMG_5573 — two iron-strapped sea chests against hull ceiling planks (Higgsfield media `1cf26901-528c-4852-9a82-026ea855dd2e`); used for form and construction only, people cropped out
- Owner's reference photo IMG_5572 — between-decks: mast trunks, rope-wrapped mast, chests, kegs (cropped to the right half) (Higgsfield media `da9bdb29-3715-4cbd-a981-fdb2ccf4e514`); used for form and construction only, people cropped out
- `assets/source/prop/prop-marsh-store-set-01/prop-marsh-store-set-01.png` — approved style anchor (Higgsfield media `13347870-e15e-4ec9-936c-465b447fc295`)

The owner supplied the photos as reference for this set (2026-11-15). They are used only as reference inputs for form and construction: they are never shipped and never pasted into an asset.

## 2. Brief

Sailors’ sea chests and strongboxes for the Tern’s crew deck, the passenger berth and the Undertow. Lockable chests show lock quality by keyhole-plate material (iron simple, brass medium, black-steel hard); handles show polished interactable wear.

## 3. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Prop design sheet: several related props arranged in a grid with generous spacing, each shown in three-quarter view, consistent scale and lighting, plain flat parchment background, no overlapping.

SET: sailors' sea chests and strongboxes for the Wendmouth waterfront and the merchantman Gilded Tern. Wendmouth palette: salt-grey glenstone #9C9788, harbour stone #7E8584, tarred plank #2F2A28, sea grey-green #5E7A7A, sail canvas #E6D9BC, net tan #B08A58; worked wood #8A6440 and bark #5A3E2B; iron in ink-violet #1E1B2E; brass #C9A042 for wear and medium locks.
PROPS (left to right, top to bottom): 1. a sailor's sea chest of honey-orange pine, slightly tapered sides, an overhanging plank lid, dark forged iron strap hinges and L-shaped corner straps, a front hasp over a plain iron keyhole plate; 2. the same chest with its lid open, empty plank interior, lid held by a short cord; 3. a sea chest with tan hemp rope becket handles on both ends, a rope pull-ring on the front and cut-out bracket feet; 4. a smaller ditty box with a brass keyhole plate; 5. a smuggler's strongbox in darker wood with black-steel banding and a black-steel keyhole plate; 6. two chests stacked, the upper one set back.
SYSTEMIC CUES: lockable chests show a visible keyhole plate whose material shows lock quality — iron = simple (props 1–3), brass = medium (prop 4), black-steel = hard (prop 5); hasps and pull-rings carry polished brass wear #C9A042 (interactable); rope beckets are tan hemp (flammable). No pale cracked wood (none are breakable).
SHAPE: chunky, bevelled, boxy blocks with heavy lids and thick strap hardware; big–medium–small; readable at 10 m.
SCALE REFERENCE: include a small 1.8 m human outline at the edge.
REFERENCE IMAGES: the attached photographs show real construction to borrow — shapes, proportions, joinery, hardware and how things are used. Reinterpret them completely in the painted style above: never copy photographic texture, lighting, noise or framing, and leave out anything modern. The attached painted image is an approved in-game style anchor: match its brushwork, bevel size, lighting and palette.
```

## 4. Output spec

| Property | Value |
|---|---|
| Aspect / size | 3:2, 2k (about 2048×1365) |
| Background | flat parchment |
| Format | PNG |
| Downstream | small 50–400 tris, medium 400–2 k (casks, chests), large 2–5 k (hutch); one shared prop atlas, one material per set (style bible §13.2). Flat concept for the image-to-3D flow after the owner approves it (§17.2). |

## 5. Consistency checklist (Claude self-check of v1; owner confirms at the gate)

Preamble verbatim, palette, no text/logos, lighting and shape language checked by Claude on v1; per-asset notes in §7. Owner approved v1 on 2026-11-15.

## 6. Approval gate(s)

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image (flat concept) | v1 | approved | owner | 2026-11-15 | "They all look great!" (session chat; `assets/approvals.json` does not exist yet) |

## 7. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/prop-harbour-sea-chest-set-01/v1.png` | approved — Lock tiers read: iron plates on 1–3, brass on 4, black-steel on 5; brass hasps/pull-ring show interactable wear; rope beckets tan. Stacked pair (#6) uses a brass plate on the upper chest. |

## 8. Provenance (recorded in `assets/CREDITS.md`)

| Asset id | Tool / model | Tier | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|
| `prop-harbour-sea-chest-set-01` | generated:higgsfield/gpt_image_2_6 | Higgsfield plus (quality high, 2k) | 2026-11-15 | GEN-OWNED — Higgsfield Terms of Use §4.4 (see the door-wood-01 row in CREDITS.md). https://higgsfield.ai/terms-of-use-agreement | this file |
