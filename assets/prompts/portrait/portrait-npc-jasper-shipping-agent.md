# portrait-npc-jasper-shipping-agent: Dialogue portrait of Jasper Quell, shipping agent of Vane Deepworks.

**Status: generated v1, awaiting owner approval** (2026-11-16). From `e37-asset-portraits-harbour-cast-prompts` (plan/assets-harbor.json). Canon: story bible §5.13/§5.14, style bible §5.4 silhouette hooks.

| Field | Value |
|---|---|
| Asset id | `portrait-npc-jasper-shipping-agent` |
| Category | portrait |
| Template | `_templates/npc-portrait.md` v1 |
| Consuming bead(s) | `e37-asset-portraits-harbour-cast-integrate` (dialogue UI); `e37-asset-npcs-harbour-named-*` (the turnaround must match it) |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 1k, 1:1, plan plus, 2026-11-16, job `14691ea8-6064-4b32-962e-31f60dc1593b` |
| Anchor / reference inputs | approved `portrait-npc-ottilie-marsh-01` (Higgsfield media `d53fd904-e034-4dae-b03c-8870d60dfb4d`) |
| Staging copy | `assets/_incoming/portrait-npc-jasper-shipping-agent/v1.png` (gitignored) |

## Filled prompt (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Head-and-shoulders character portrait, three-quarter view, expressive but natural face, painted, soft warm key light and cool rim, simple softly blurred background in the location's colours, bust framing with space above the head.

SUBJECT: Jasper Quell, shipping agent of Vane Deepworks: a thin, anxious man in his thirties with a nervous stoop and hunched shoulders, a too-tight smile, thinning hair combed flat, ink-stained cuffs on a cheap respectable brown coat, a bundle of shipping manifests clutched to his chest (blank paper, no writing), a pencil behind one ear, eyes glancing sideways. BACKGROUND: softly blurred vaulted stone warehouse, harbour stone #7E8584, sealed crates in shadow, a dusty skylight shaft.
Wendmouth palette: salt-grey glenstone #9C9788, harbour stone #7E8584, tarred plank #2F2A28, sea grey-green #5E7A7A, sail canvas #E6D9BC, net tan #B08A58; shopfront pops turquoise #2E9AA0, sunflower #E8B83A, coral #D9674E.
REFERENCE IMAGE: the attached painted portrait is an approved dialogue portrait from this game: match its brushwork, framing, head size, lighting and level of finish exactly.
```

## Output spec

1024² generate → 512²/256² PNG → KTX2 UASTC; bust framing with head-room, softly blurred location-coloured background.

## Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| image | v1 | pending | owner | — | — |

## Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-16 | Higgsfield / gpt_image_2_6 (high, 1k) / plus | initial | `assets/_incoming/portrait-npc-jasper-shipping-agent/v1.png` | candidate — stoop, sideways glance, ink-stained cuffs, manifests, pencil behind the ear |
