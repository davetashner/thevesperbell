# Asset Credits & Provenance

Every asset committed to this repository — generated, downloaded, or made by hand — has a row here,
**added in the same commit as the asset**. The asset validator (`e37-asset-validator`) fails CI when a runtime
asset has no matching row, or a row uses a licence that isn't allowed.

Rules: `docs/art/style-bible.md` §16–17 and `docs/audio/audio-bible.md` §9. Every **final** (non-placeholder)
asset must also have an owner approval record in `assets/approvals.json` matching its file hash
(`e37-asset-approval-log`).

Typical sources: `generated:codex-gpt-image/<model>` (ChatGPT subscription via Codex CLI),
`generated:openai-images-api/<model>`, `generated:meshy-api/<model>` or `generated:tripo-api/<model>`,
`generated:suno/<model>` (owner-generated, paid tier), `generated:elevenlabs-sfx/<model>`, `kit:<name>`,
`library:<url>` (CC0). Never record API keys or account emails here.

## Allowed licences

| Licence id | Meaning | In-game credit required |
|---|---|---|
| `CC0-1.0` | Public domain dedication | No (credited anyway as courtesy) |
| `CC-BY-4.0` | Attribution | **Yes** — listed on the in-game credits screen |
| `OFL-1.1` | SIL Open Font License (fonts only) | Licence text shipped alongside font |
| `MIT` / `Apache-2.0` | Permissive | Licence text retained |
| `GEN-OWNED` | Generated with an AI tool whose terms, **at the recorded tier and date**, grant us rights to distribute the output freely (e.g. paid-tier ownership) | Per tool terms |
| `ORIGINAL` | Made by the project | No |

**Not allowed:** CC-BY-NC, CC-BY-ND, CC-BY-SA, "editorial use", "royalty-free — no redistribution" (the repo is
public), unknown/unrecorded provenance. Free-tier AI outputs whose terms restrict ownership or require
non-commercial use are **placeholders only** and must be flagged `placeholder: yes`.

## Column reference

- **Asset id** — exact asset id (= filename stem), or a glob for a set/kit (`kit-kaykit-dungeon/*`).
- **Type** — concept | texture | model | anim | ui | icon | portrait | book | vfx | sky | keyart | music | sfx | amb | font | kit.
- **Source** — `generated:<tool>/<model-version>` | `library:<url>` | `kit:<name>@<version>` | `original`.
- **Tier** — account tier at generation (e.g. `ChatGPT Plus`, `Suno Pro`, `Meshy Free`) or `n/a`.
- **Date** — generation/download date (YYYY-MM-DD).
- **Licence** — licence id from the table above.
- **Terms / URL** — link to the licence or tool terms page as read on that date.
- **Author / attribution** — required text for CC-BY; author name for kits.
- **Prompt file** — `assets/prompts/<category>/<asset-id>.md` for generated assets.
- **Placeholder** — `yes` if it must be replaced before m3.

---

## Art

| Asset id | Type | Source | Tier | Date | Licence | Terms / URL | Author / attribution | Prompt file | Placeholder |
|---|---|---|---|---|---|---|---|---|---|
| `tex-glenstone-quay-wendmouth-probe-01` | texture | generated:codex-gpt-image/model-unreported | ChatGPT subscription | 2026-10-03 | GEN-OWNED | https://openai.com/policies/terms-of-use/ | owner + Codex seamless edit | `assets/prompts/texture/tex-glenstone-quay-wendmouth-probe-01.md` | yes |
| `concept-wendmouth-stone-wharf-probe-01` | concept | generated:chatgpt-image-generation/model-unreported | ChatGPT subscription (tier not recorded) | 2026-10-03 | GEN-OWNED | https://openai.com/policies/terms-of-use/ | owner | n/a (owner-generated in ChatGPT as a style probe; prompt not recorded; tests the stone-harbour canon) | yes |
| `icon-item-horn-coin-probe-01` | icon | generated:chatgpt-image-generation/model-unreported | ChatGPT subscription (tier not recorded) | 2026-10-03 | GEN-OWNED | https://openai.com/policies/terms-of-use/ | owner | n/a (owner-generated in ChatGPT as a style probe; prompt not recorded; item-icon probe) | yes |
| `portrait-npc-nell-gannet-probe-01` | portrait | generated:chatgpt-image-generation/model-unreported | ChatGPT subscription (tier not recorded) | 2026-10-03 | GEN-OWNED | https://openai.com/policies/terms-of-use/ | owner | n/a (owner-generated in ChatGPT as a style probe; prompt not recorded; NPC portrait probe) | yes |
| `vfx-*` — the procedural placeholder VFX textures: every `.png` under `public/assets/vfx/` (entries flagged `placeholder: true` in `src/game/vfx/data/texture-manifest.json`) | vfx | original (procedural shapes and seeded value noise: `scripts/vfx/gen-placeholders.ts`, mw-e29.2; no images, kits or generation APIs) | n/a | 2026-10-02 | ORIGINAL | n/a | The Vesper Bell project | n/a | yes |
| door-wood-01 | texture | generated:higgsfield-gpt-image/gpt_image_2_5 | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party model provider's policy applies. https://higgsfield.ai/terms-of-use-agreement | owner | `assets/prompts/props/prop-door-wood-01.md` | yes |
| door-iron-01 | texture | generated:higgsfield-gpt-image/gpt_image_2_5 | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party model provider's policy applies. https://higgsfield.ai/terms-of-use-agreement | owner | `assets/prompts/props/prop-door-iron-01.md` | yes |
| crate-01 | texture | generated:higgsfield-gpt-image/gpt_image_2_5 | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party model provider's policy applies. https://higgsfield.ai/terms-of-use-agreement | owner | `assets/prompts/props/prop-crate-01.md` | yes |
| pillar-glenstone-01 | texture | generated:higgsfield-gpt-image/gpt_image_2_5 | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party model provider's policy applies. https://higgsfield.ai/terms-of-use-agreement | owner | `assets/prompts/props/prop-pillar-glenstone-01.md` | yes |
| ivy-stone-01 | texture | generated:higgsfield-gpt-image/gpt_image_2_5 | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party model provider's policy applies. https://higgsfield.ai/terms-of-use-agreement | owner | `assets/prompts/props/prop-ivy-stone-01.md` | yes |
| `concept-marsh-store-exterior-01` | concept | generated:higgsfield/gpt_image_2_5 | Higgsfield plus (quality low, 1k) | 2026-10-04 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03, see the door-wood-01 row): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them. https://higgsfield.ai/terms-of-use-agreement | owner (approved 2026-10-04, "these look great"; approval recorded in bead mw-ju8.8, no approvals.json yet) | `assets/prompts/concept/concept-marsh-store-exterior-01.md` | yes |
| `concept-marsh-store-shop-floor-01` | concept | generated:higgsfield/gpt_image_2_5 | Higgsfield plus (quality low, 1k) | 2026-10-04 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03, see the door-wood-01 row): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them. https://higgsfield.ai/terms-of-use-agreement | owner (approved 2026-10-04, "these look great"; approval recorded in bead mw-ju8.8, no approvals.json yet) | `assets/prompts/concept/concept-marsh-store-shop-floor-01.md` | yes |
| `concept-marsh-store-upstairs-home-01` | concept | generated:higgsfield/gpt_image_2_5 | Higgsfield plus (quality low, 1k) | 2026-10-04 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03, see the door-wood-01 row): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them. https://higgsfield.ai/terms-of-use-agreement | owner (approved 2026-10-04, "these look great"; approval recorded in bead mw-ju8.8, no approvals.json yet) | `assets/prompts/concept/concept-marsh-store-upstairs-home-01.md` | yes |
| `char-ottilie-marsh-base-01` | concept | generated:higgsfield/gpt_image_2_5 | Higgsfield plus (quality low, 1k) | 2026-10-04 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03, see the door-wood-01 row): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them. https://higgsfield.ai/terms-of-use-agreement | owner (approved 2026-10-04, "these look great"; approval recorded in bead mw-ju8.8, no approvals.json yet) | `assets/prompts/character/char-ottilie-marsh-base-01.md` | yes |
| `portrait-npc-ottilie-marsh-01` | portrait | generated:higgsfield/gpt_image_2_5 | Higgsfield plus (quality low, 1k) | 2026-10-04 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03, see the door-wood-01 row): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them. https://higgsfield.ai/terms-of-use-agreement | owner (approved 2026-10-04, "these look great"; approval recorded in bead mw-ju8.8, no approvals.json yet) | `assets/prompts/portrait/portrait-npc-ottilie-marsh-01.md` | yes |
| `prop-marsh-store-set-01` | concept | generated:higgsfield/gpt_image_2_5 | Higgsfield plus (quality low, 1k) | 2026-10-04 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03, see the door-wood-01 row): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them. https://higgsfield.ai/terms-of-use-agreement | owner (approved 2026-10-04, "these look great"; approval recorded in bead mw-ju8.8, no approvals.json yet) | `assets/prompts/prop/prop-marsh-store-set-01.md` | yes |

## 3D models & animation

| Asset id | Type | Source | Tier | Date | Licence | Terms / URL | Author / attribution | Prompt file | Placeholder |
|---|---|---|---|---|---|---|---|---|---|
| model-char-knight-01 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-char-knight-01.md` | yes |
| model-prop-arming-sword-01 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-prop-arming-sword-01.md` | yes |
| model-prop-wooden-shield-01 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-prop-wooden-shield-01.md` | yes |
| model-creature-forgotten-miner-01 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-creature-forgotten-miner-01.md` | yes |
| model-creature-forgotten-miner-02 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-creature-forgotten-miner-01.md` | yes |
| model-creature-forgotten-miner-03 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-creature-forgotten-miner-01.md` | yes |
| model-creature-forgotten-miner-04 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-creature-forgotten-miner-01.md` | yes |
| model-npc-ottilie-01 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-24 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-npc-bodies-01.md` | yes |
| model-npc-dot-01 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-24 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-npc-bodies-01.md` | yes |
| model-npc-watchman-01 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-24 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-npc-bodies-01.md` | yes |
| model-prop-miner-pick-01 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-prop-miner-pick-01.md` | yes |
| model-creature-forgotten-brute-01 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-24 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-24): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-creature-forgotten-brute-01.md` | yes |
| model-prop-brute-maul-01 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-24 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-24): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-prop-brute-maul-01.md` | yes |
| model-prop-forgotten-bow-01 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-24 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-24): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-prop-forgotten-bow-01.md` | yes |
| model-prop-forgotten-shield-01 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-24 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-24): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-prop-forgotten-shield-01.md` | yes |
| model-prop-wall-torch-01 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-prop-wall-torch-01.md` | yes |
| model-prop-brazier-floor-01 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-prop-brazier-floor-01.md` | yes |
| model-prop-chest-wooden-01 | model | generated:tripo-via-higgsfield/tripo_h3_1_image_to_3d | Higgsfield Plus | 2026-10-03 | GEN-OWNED | Higgsfield Terms of Use §4.4 (read 2026-10-03): the user owns Outputs, commercial use and sublicensing allowed, Outputs not guaranteed unique, Higgsfield may train on them; §8: the third-party provider's acceptable-use policy applies. https://higgsfield.ai/terms-of-use-agreement. Tripo's own terms NOT read (site blocks automated fetch; secondary sources say free-tier output is non-commercial, paid/API output commercial): owner to confirm (mw-uuk) | owner | `assets/prompts/model/model-prop-chest-wooden-01.md` | yes |

## Music

| Asset id | Type | Source | Tier | Date | Licence | Terms / URL | Author / attribution | Prompt file | Placeholder |
|---|---|---|---|---|---|---|---|---|---|
| music-title-main-theme | music | generated:suno/v6 | Suno Pro (annual) | 2026-09-27 | GEN-OWNED | https://suno.com/terms | owner | `assets/prompts/music/music-title-main-theme.md` | no |
| music-open-world | music | generated:suno/v6 | Suno Pro (annual) | 2026-10-03 | GEN-OWNED | https://suno.com/terms | owner | `assets/prompts/music/music-open-world.md` | yes |
| music-skeleton-arena-combat-music | music | generated:suno/v6 | Suno Pro (annual) | 2026-10-03 | GEN-OWNED | https://suno.com/terms | owner | `assets/prompts/music/music-skeleton-arena-combat-music.md` | yes |

## Sound effects & ambience

| Asset id | Type | Source | Tier | Date | Licence | Terms / URL | Author / attribution | Prompt file | Placeholder |
|---|---|---|---|---|---|---|---|---|---|
| `sfx-*` — the synthesised placeholder pack: every `.wav` under `public/assets/audio/` (entries flagged `placeholder: true` in `src/audio/data/sound-manifest.json`) | sfx | original (procedural synthesis: `scripts/audio/gen-placeholders.ts`, mw-e28.2; no recordings, clips or generation APIs) | n/a | 2026-09-29 | ORIGINAL | n/a | The Vesper Bell project | n/a | yes |
| amb-deepworks-drips-01 (source take `mine-ambience-bed`, Suno Sounds mode) | amb | generated:suno/v6 | Suno Pro (annual) | 2026-10-03 | GEN-OWNED | https://suno.com/terms | owner | `assets/prompts/music/mine-ambience-bed.md` | yes |

## Fonts

| Asset id | Type | Source | Tier | Date | Licence | Terms / URL | Author / attribution | Prompt file | Placeholder |
|---|---|---|---|---|---|---|---|---|---|
| _(none yet — planned: Cinzel, Cinzel Decorative, Alegreya Sans, IM Fell English, Uncial Antiqua, Atkinson Hyperlegible; all OFL-1.1)_ | | | | | | | | | |

## Third-party kits

| Asset id | Type | Source | Tier | Date | Licence | Terms / URL | Author / attribution | Prompt file | Placeholder |
|---|---|---|---|---|---|---|---|---|---|
| _(none yet)_ | | | | | | | | | |

---

## Audit log

| Date | Milestone | Auditor | Result | Notes |
|---|---|---|---|---|
| _(first audit at m1 exit — bead `e37-credits-audit`)_ | | | | |
