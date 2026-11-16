# tex-roof-tin-harbour-01

**Status: owner-approved image** (v1, approved 2026-11-16). From the `e37-asset-tex-harbour-prompts` set (plan/assets-harbor.json).

## 1. Asset

| Field | Value |
|---|---|
| Asset id | `tex-roof-tin-harbour-01` |
| Category | texture |
| Consuming bead(s) | `e37-asset-tex-harbour-integrate`; Loud net-loft roofs on the thief route (`e40-rooftops-net-lofts`); paired with the `metal-grate` footstep surface (+8 dB). |
| Template | `_templates/tileable-texture.md` v1 |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 2k, 1:1, plan plus, 2026-11-15, job `983ead9e-e6f6-4f97-9d48-f1abcde96a9a` |
| Reference inputs | approved `tex-planks-salt-bleached-01` (job `26cf2a8e-e811-445a-8553-761b2f2a87cd`) and `concept-wendmouth-stone-wharf-probe-01` |
| Staging copy | `assets/_incoming/tex-roof-tin-harbour-01/v1.png` (gitignored) |

## 2. Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Seamless tileable texture, perfectly repeating on all four edges, top-down orthographic, flat even lighting with no directional shadows or highlights, no perspective, low contrast at the edges, no single standout feature, hand-painted stylized surface.

MATERIAL: a loud corrugated tin roof of the Wendmouth net lofts: overlapping sheets of ribbed tin running vertically, each sheet nailed at its edges, some sheets patched over others.
REAL-WORLD SCALE: one tile = 2 m × 2 m; ribs about 8 cm apart, sheets about 60 cm wide.
COLOURS: cool grey tin #8C9196 to #A7B0B5 with rust streaks and patches #9A5A34 and #C07A3E, nail heads ink-violet #1E1B2E.
SURFACE CHARACTER: crisp repeating ribs painted with broad strokes, bright highlights on the rib tops, strong rib rhythm so it reads as noisy metal at a glance and is clearly distinct from a soft tar roof even in greyscale.
WEAR: rust runs from the nails, a few dents; no holes.
REFERENCE IMAGES: the attached painted images are approved in-game textures and concepts for this harbour: match their brushwork, value range and palette.
```

## 3. Output spec

1:1, 2k generate → seam repair → 1024² WebP runtime (KTX2 once `mw-e37.8` lands), seamless on both axes.

## 4. Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image | v1 | approved | owner | 2026-11-16 | "They pass" (with the tin/tar roof assignment) |

## 5. Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-15 | Higgsfield / gpt_image_2_6 (high, 2k) / plus | initial | `assets/_incoming/tex-roof-tin-harbour-01/v1.png` | kept — approved |

## 6. Runtime

`public/assets/texture/tex-roof-tin-harbour-01.webp`: 1024² WebP, both axes overlap-blended (10%) for a seamless tile, sha256 `c9b58a6f3304cc289f64a719e4408f6faa2836eff920fe39481df7db33e1b50b`. Source PNG `assets/source/texture/tex-roof-tin-harbour-01/tex-roof-tin-harbour-01.png`.
