# portrait-npc-mags-bargewoman: Dialogue portrait of Mags Oakum, skipper of the Patient Ann.

**Status: owner-approved concept** (v2, approved 2026-11-16). From `e37-asset-portraits-harbour-cast-prompts` (plan/assets-harbor.json). Canon: story bible §5.13/§5.14, style bible §5.4 silhouette hooks.

| Field | Value |
|---|---|
| Asset id | `portrait-npc-mags-bargewoman` |
| Category | portrait |
| Template | `_templates/npc-portrait.md` v1 |
| Consuming bead(s) | `e37-asset-portraits-harbour-cast-integrate` (dialogue UI); `e37-asset-npcs-harbour-named-*` (the turnaround must match it) |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 1k, 1:1, plan plus, 2026-11-16, v1 job `ef88116f-3aca-4a44-94b3-06f09fbdaf2f` |
| Anchor / reference inputs | approved `portrait-npc-ottilie-marsh-01` (Higgsfield media `d53fd904-e034-4dae-b03c-8870d60dfb4d`) |
| Staging copy | `assets/_incoming/portrait-npc-mags-bargewoman/v1.png`, `v2.png` (gitignored) |

## Filled prompt v2 (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Head-and-shoulders character portrait, three-quarter view, expressive but natural face, painted, soft warm key light and cool rim, simple softly blurred background in the location's colours, bust framing with space above the head.

SUBJECT: Mags Oakum, skipper of the stone barge Patient Ann: a broad, weathered bargewoman in her fifties with a short clay pipe clenched in her teeth trailing a thread of smoke, huge bare forearms like hawsers (sleeves rolled to the elbow), wind-burnt cheeks, grey-streaked hair tied back under a battered wide felt hat, a tarred canvas waistcoat over a faded ochre shirt (#C9923A, the Patient Ann's hull-stripe colour), a coil of rope over one shoulder. Gruff, steady, kind under it. BACKGROUND: softly blurred river and towpath, brown river water #6B5A3E, reeds #8FA05A, tarred barge timber #3A2E26.
FACE (must be distinctive): a square, heavy-jawed, wind-leathered face with deep sun-browned skin, a flat broken nose, deep-set narrow squinting eyes in a nest of deep crow's feet, thick dark brows, a thin straight mouth clamped on the pipe stem, no smile and no blush, cropped iron-grey hair under the hat; she squints into the wind, unimpressed.
Wendmouth palette: salt-grey glenstone #9C9788, harbour stone #7E8584, tarred plank #2F2A28, sea grey-green #5E7A7A, sail canvas #E6D9BC, net tan #B08A58; shopfront pops turquoise #2E9AA0, sunflower #E8B83A, coral #D9674E.
REFERENCE IMAGE: the attached painted portrait is an approved dialogue portrait from this game: match ONLY its brushwork, framing, lighting and level of finish. Do NOT copy her face, face shape, nose, cheeks, blush or smile: this is a different person whose face must look clearly unlike hers.
```

## Output spec

1024² generate → 512²/256² PNG → KTX2 UASTC; bust framing with head-room, softly blurred location-coloured background.

## Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image | v2 | approved | owner | 2026-11-16 | v2 approved: "Yes much better" (session chat; `assets/approvals.json` does not exist yet) |

## Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-16 | Higgsfield / gpt_image_2_6 (high, 1k) / plus | initial | `assets/_incoming/portrait-npc-mags-bargewoman/v1.png` | superseded (owner: the women's faces were too similar) — pipe with smoke, hawser forearms, ochre shirt, rope coil; river behind |
| 2 | 2026-11-16 | Higgsfield / gpt_image_2_6 (high, 1k) / plus | added a FACE line (distinct face shape, nose, skin, expression); the reference now lends only brushwork and lighting, never Ottilie's face. Job `d0e44827-30d9-48b7-b43d-9454eed0307d` | `assets/_incoming/portrait-npc-mags-bargewoman/v2.png` | approved — square jaw, sun-browned and squinting, unsmiling round the pipe |

## Output

`assets/source/portrait/portrait-npc-mags-bargewoman/portrait-npc-mags-bargewoman.png` (v2, 1024², SHA-256 `d911827c2259522c04baea92d1c882d1434a6d139197b8c1c16688bf3917928b`). Runtime 512²/256² copies are made by `e37-asset-portraits-harbour-cast-integrate`.
