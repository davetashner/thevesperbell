# portrait-npc-cray-inspector: Dialogue portrait of Inspector Prudence Cray, Lantern Court customs.

**Status: generated v1, awaiting owner approval** (2026-11-16). From `e37-asset-portraits-harbour-cast-prompts` (plan/assets-harbor.json). Canon: story bible §5.13/§5.14, style bible §5.4 silhouette hooks.

| Field | Value |
|---|---|
| Asset id | `portrait-npc-cray-inspector` |
| Category | portrait |
| Template | `_templates/npc-portrait.md` v1 |
| Consuming bead(s) | `e37-asset-portraits-harbour-cast-integrate` (dialogue UI); `e37-asset-npcs-harbour-named-*` (the turnaround must match it) |
| Tool | Higgsfield `gpt_image_2_6`, quality high, 1k, 1:1, plan plus, 2026-11-16, v1 job `96d0f51e-fce9-43a1-baec-e5051c91a5e0` |
| Anchor / reference inputs | approved `portrait-npc-ottilie-marsh-01` (Higgsfield media `d53fd904-e034-4dae-b03c-8870d60dfb4d`) |
| Staging copy | `assets/_incoming/portrait-npc-cray-inspector/v1.png`, `v2.png` (gitignored) |

## Filled prompt v2 (preamble verbatim from docs/art/style-bible.md §14, add-on from §14.1)

```text
STYLE: Stylized hand-painted fantasy art for "The Vesper Bell", a 3D third-person action RPG. Chunky low-poly forms with soft bevelled edges and slightly exaggerated, heavy proportions, painted with broad confident brush strokes and gentle colour gradients instead of fine photographic detail. Mood: souls-like weight and ancient mystery, but warm and hopeful — golden hearth light pushing back cool violet-blue shadow. Palette: deep ink-violet shadows (#1E1B2E, never pure black), moss green (#2F4A3A), weathered stone (#8C8A80), bark brown (#5A3E2B), parchment cream (#EFE2C4) and hearth amber (#E8A24A); strong saturated colour only for magic, fire and points of interest. Clear, readable silhouettes: one big shape, a few medium shapes, small detail used sparingly. Soft warm key light from the upper left with a cool fill and a gentle rim light. No photorealism, no photo textures, no text, letters or numbers, no logos, no watermark, no signature, no modern objects, no gore.

Head-and-shoulders character portrait, three-quarter view, expressive but natural face, painted, soft warm key light and cool rim, simple softly blurred background in the location's colours, bust framing with space above the head.

SUBJECT: Inspector Prudence Cray of the Lantern Court customs: a woman in her forties, upright and starched, round brass-rimmed spectacles, hair scraped into a severe bun, a high stiff white collar under a buttoned ink-coloured coat #1E1B2E, a polished brass lantern-in-ring badge on the breast, a ledger held to her chest; thin-lipped, incorruptible, with a hint of a secret romantic in her eyes. BACKGROUND: softly blurred columned glenstone customs hall, pale stone #CDB89A, a parchment Lantern Court flag (brass lantern-in-ring on parchment, no lettering).
FACE (must be distinctive): a long, narrow oval face with pale, cool-toned skin and no blush, high sharp cheekbones, a long thin straight nose, sharply arched brows, pale grey eyes behind the spectacles, thin pursed lips in a prim, disapproving line (not smiling); black hair streaked with grey pulled into a severe bun. Upright and starched.
Wendmouth palette: salt-grey glenstone #9C9788, harbour stone #7E8584, tarred plank #2F2A28, sea grey-green #5E7A7A, sail canvas #E6D9BC, net tan #B08A58; shopfront pops turquoise #2E9AA0, sunflower #E8B83A, coral #D9674E.
REFERENCE IMAGE: the attached painted portrait is an approved dialogue portrait from this game: match ONLY its brushwork, framing, lighting and level of finish. Do NOT copy her face, face shape, nose, cheeks, blush or smile: this is a different person whose face must look clearly unlike hers.
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
| 1 | 2026-11-16 | Higgsfield / gpt_image_2_6 (high, 1k) / plus | initial | `assets/_incoming/portrait-npc-cray-inspector/v1.png` | superseded (owner: the women's faces were too similar) — spectacles, high white collar, ink coat, lantern-in-ring badge, ledger, Lantern Court flag; softer and warmer than "starched" |
| 2 | 2026-11-16 | Higgsfield / gpt_image_2_6 (high, 1k) / plus | added a FACE line (distinct face shape, nose, skin, expression); the reference now lends only brushwork and lighting, never Ottilie's face. Job `f3bf5606-d0dc-476a-b019-31728acc9ed6` | `assets/_incoming/portrait-npc-cray-inspector/v2.png` | candidate — long narrow pale face, arched brows, prim unsmiling mouth, grey-streaked black bun |
