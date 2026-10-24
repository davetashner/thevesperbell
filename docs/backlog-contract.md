# Backlog Contract

This document is the single source of truth for **how** beads in this project are written.
Every epic, story, task, spike and asset-prompt bead MUST follow it so the backlog reads as one
coherent plan. Read `CONSTITUTION.md` first — this document is subordinate to it.

> Title: **The Vesper Bell** (decided in `mw-e39.2`, see `docs/adr/0002-game-title.md`). Codename: Merlin's Wrath.

---

## 1. Project-wide decisions (already made)

| Topic | Decision |
|---|---|
| Platform | Desktop browser MVP. Keyboard + mouse first, gamepad second, mobile post-MVP (E36). |
| Dimension | **3D**, third-person, stylized. |
| Language / build | TypeScript (strict), Vite, pnpm. |
| Rendering engine | **Three.js** — decided by the `mw-e00` ADR spike (key `e00-engine-decision`, `docs/adr/0001-engine-and-physics.md`). Stories still talk about "the renderer" (whatever `src/render` wraps) rather than Three.js APIs. |
| Physics | **Rapier, deterministic build** (`@dimforge/rapier3d-deterministic`, WASM), stepped inside `src/sim` on the fixed timestep behind a sim-owned physics port; the renderer only interpolates transforms (ADR-0001). |
| Tests | Vitest (unit/integration, v8 coverage), Playwright (browser smoke, e2e, perf budgets). |
| Enemy AI | **HFSM over the six alert states with utility selection of activities inside each state**, behaviour definitions as JSON content (ADR-0005, `docs/adr/0005-ai-architecture.md`). Runtime `mw-e11.2` in `src/sim/ai/`. |
| Navigation | **Pure-TypeScript navmesh** baked from grey-box geometry at content build time (`pnpm nav:bake` → `src/content/data/navmesh/<scene>.json`), queried in `src/sim/nav` (A* + funnel, capability masks, door states, per-tick request budget) — no navigation library (ADR-0006, `docs/adr/0006-navmesh-and-pathfinding.md`). |
| Content data | Data-driven JSON/TS content validated by schemas (zod). Spells, items, creatures, puzzles, dialogue, quests, loot tables are **data**, not code. |
| Repo / flow | https://github.com/davetashner/thevesperbell — all work via PR from a git worktree, **squash merge only**, branch auto-deleted, CI must be green. |
| Issue tracking | `bd` (beads), prefix `mw-`. Epics use explicit IDs `mw-e00`…`mw-e40`; children get hierarchical IDs `mw-e09.1`, `mw-e09.2`… |
| Art tool | GPT image generation for concept art, textures, UI, icons, portraits — **Claude runs it** via Codex CLI (`codex exec`, owner's ChatGPT subscription; fallback `OPENAI_API_KEY`). |
| 3D models | **Claude generates** via the Meshy or Tripo image-to-3D API from owner-approved flat images (provider chosen by bake-off spike `e37-3d-pipeline-decision`); CC0 low-poly kits for bulk props/environments. The owner never does 3D work. |
| Music tool | Suno (no official API): Claude writes the prompt, the owner pastes it into Suno and drops the chosen take in `assets/_incoming/music/`; Claude does all post-processing and integration. |
| SFX tool | Spike `e38-sfx-tool-decision`; recommended: ElevenLabs Sound Effects API (Claude generates end-to-end), CC0 libraries as fallback. |
| Voice | None for MVP — text only. |
| Distribution | Free game, public repo. Asset licences must permit free public distribution. |
| Tone | Souls-like weight and mystery, but warmer and less bleak; influenced by *Quest for Glory V*, Zelda, Dark Souls/Elden Ring, Divinity: Original Sin 2, The Elder Scrolls (Morrowind/Oblivion/Skyrim). Humour and humanity allowed; despair is not the default. |

### Hardware baseline

Reference machine: **MacBook Pro M1 Pro, 16 GB RAM, 3456×2234 Retina, Chrome current**.

- **High preset:** steady 60 fps on the reference machine at a 1440p-equivalent render resolution.
- **Low preset:** steady 60 fps at 1080p (30 fps floor in worst-case combat) on integrated GPUs of roughly Intel Iris Xe / base M1 8 GB class.
- Initial load to playable ≤ 10 s on a 50 Mbps connection, warm reload ≤ 3 s; initial download ≤ 50 MB; JS heap ≤ 1.5 GB.
- Browsers: current Chrome, Edge, Firefox, Safari (desktop).

Performance stories cite these numbers instead of inventing new ones.

---

## 2. Architecture boundary (drives testing)

```
src/
  sim/      Pure, deterministic game rules. No DOM, no renderer, no Date.now/Math.random
            (use injected clock + seeded RNG). Fixed timestep. ← the heart of the game
  content/  Schemas + data files (spells, creatures, items, dialogue, quests, puzzles…)
  game/     Orchestration glue: binds sim ↔ renderer ↔ input ↔ audio ↔ UI
  render/   Renderer-specific code (scene graph, materials, shaders, VFX, animation)
  audio/    Web Audio playback/mixing
  ui/       HUD, menus, inventory, dialogue UI (DOM or engine UI)
  tools/    Dev/content tools (debug console, editors, validators)
```

**Rule:** if a behaviour is a *rule of the game* (can I see the thief? does ice melt? does the
door open? how much stagger?) it lives in `src/sim` and is unit-testable without a browser.

## 3. Test & coverage policy

The goal is that releases can be trusted **without reading the code**. Coverage is a floor, not the goal —
tests must assert behaviour described in acceptance criteria.

| Layer | Requirement |
|---|---|
| `src/sim`, `src/content` (schemas + validators), save/load, economy, quest/dialogue runtimes | **100%** lines, branches, functions, statements. No exceptions without a bead. |
| `src/game`, `src/ui`, `src/audio`, `src/tools` | **≥ 90%** lines/branches; remaining gaps listed in `coverage-exclusions.md` with a justification. |
| `src/render`, shaders, WASM bindings, bootstrap | May be excluded from unit coverage **only** via `coverage-exclusions.md` (path + reason). Covered instead by Playwright smoke tests (scene boots, no console errors, screenshot sanity) and perf budgets. |
| Global | Coverage **ratchet**: CI fails if any metric decreases versus `main`. |
| Content | Every data file is validated by schema tests; every spell/creature/item/dialogue/quest has at least one automated test exercising it. |
| Determinism | Replay tests: recorded input logs replay to identical sim state hashes. |
| Saves | Round-trip tests + versioned migration tests for every save-schema change. |
| Regression | Every bug fix bead includes a failing-first regression test. |

### Standard Definition of Done (DoD)

Every story/task/spike implicitly includes this DoD; beads only list **additions**.

1. All acceptance criteria are satisfied and each automatable AC is covered by an automated test that names the AC (e.g. `it('AC-2: guard loses track after 8s out of sight')`).
2. Coverage thresholds in §3 met; ratchet not decreased; no new unexplained exclusions.
3. Per-PR tier green in CI (`docs/ci-gates.md`): lint, typecheck, unit and integration (coverage-gate), chromium Playwright smoke, build, and the security and PR hygiene checks.
4. Nightly tier (vitest bench, cross-browser audio, perf budget suite) green on `main`; a change that can move a budget runs the affected gate by hand (`pnpm perf`, `pnpm bench`) before merge. The release tier runs the nightly set against every release candidate.
5. Content/data schema validation green.
6. PR opened from a worktree branch, body contains one `Closes mw-…` line per completed bead, squash-merged.
7. Bead closed after merge with `--reason "Completed in PR #N"`; `backlog.html` reflects it.
8. User-facing changes: short note in `CHANGELOG.md` under `## [Unreleased]`. CI's `changelog` check (`scripts/changelog-check.ts`) requires it when a PR touches `src/{game,ui,render,audio,sim,content}/` (tests excluded), `src/main.ts`, `index.html` or `site/`; changes nothing visible to players get the `no-changelog` label instead.

---

## 4. Bead types

| Type | Use for |
|---|---|
| `epic` | One of E00–E41. Outcome statement + scope + exit criteria. |
| `feature` | A player-visible or designer-visible capability (the "story"). Fits in **one PR** (≈ ≤ 2 days). |
| `task` | Technical/enabling work with no direct player value (CI, refactor, schema). One PR. |
| `spike` | Time-boxed investigation producing a decision/ADR or prototype. States the question + time-box. |
| `decision` | ADR record (output of a spike or a design choice). |
| `chore` | Maintenance. |

Anything bigger than one PR must be split. Prefer vertical slices (thin end-to-end) over layers.

## 5. Writing a bead

### Title
Imperative, specific, ≤ 70 chars. `Guards investigate last-known position after losing sight` — not `AI stuff`.

### Description (markdown, these headings in this order)

```markdown
## Why
One–three sentences tying the work to a constitution pillar or player moment.

## What
The behaviour/capability, concretely. Include player-facing verbs and example situations.

## Scope
- In: …
- Out: … (and where it lives instead, e.g. "see mw-e10.4")

## Notes
Optional: data shape hints, edge cases, references to docs/*.md, design sketches.
```

For a `feature`, **What** opens with a user story:
`As a <thief|knight|archer|sorcerer|player|designer|developer>, I want <capability> so that <benefit>.`

### Acceptance criteria (`--acceptance`)

Numbered, independently verifiable, Given/When/Then. Tag each with how it is verified:

```markdown
- AC-1 [unit] Given a guard in Suspicious state, when the noise source is no longer audible for 6s, then the guard returns to Unaware and resumes its patrol.
- AC-2 [integration] Given …, when …, then …
- AC-3 [e2e] Given the greybox testbed, when …, then …
- AC-4 [perf] Given the combat stress scene, when 12 creatures are active, then frame time p95 ≤ 16.7 ms on the reference machine (High).
- AC-5 [manual] Given a playtest session, when …, then … (use sparingly; playfeel/art only)
- AC-6 [content] Given the spell data file, when validated, then …
```

Rules:
- 3–8 ACs per feature. Spikes: ACs describe the deliverable (ADR written, prototype in `spikes/`, recommendation with evidence).
- Numbers, not adjectives. "Responsive" → "input-to-motion latency ≤ 100 ms".
- Prefer `[unit]`/`[integration]`. `[manual]` only for feel, art or fun; pair it with automated ACs where possible.
- Include at least one **failure/edge** AC (the constitution values failure creating stories).
- Systemic interaction ACs are expressed through properties, never specific pairings: "any `flammable` object in a fire volume ignites", **not** "Fireball burns rope".

### Priority

| P | Meaning |
|---|---|
| P0 | Critical path to Milestone M1 (foundation / grey-box vertical slice). |
| P1 | Required for MVP. |
| P2 | MVP-desirable; cut if needed. |
| P3 | Post-MVP. |
| P4 | Someday / deferred (E36 mobile). |

### Labels (always include the first three kinds)

- `epic:eNN` — owning epic.
- `area:<sim|render|game|ui|audio|content|tools|infra|design|art|music|sfx|narrative|qa|perf>`.
- `milestone:<m0|m1|m2|m3|m4|post-mvp>`:
  - **m0 Foundation** — repo, CI, coverage gate, backlog.html, engine ADR, sim core, greybox testbed.
  - **m1 Grey-box vertical slice** — one room→corridor→fight→loot→save/reload loop, any class, placeholder art.
  - **m2 Class fantasies proven** — each of the 4 classes has its core verbs working in grey-box.
  - **m3 MVP content complete** — Briar Glen, wilderness, the Labyrinth, story, final art/audio pass.
  - **m4 Fun validation** — external playtests, polish, performance.
  - **post-mvp**.
- Optional: `class:<knight|archer|sorcerer|thief|all>`, `size:<s|m|l>` (l = must justify, prefer split), `asset:<concept|texture|model|ui|icon|portrait|vfx|music|sfx>`, `needs-human` (a human must act, e.g. generate an image in ChatGPT), `too-useful` (deliberately powerful ability — protected from balance nerfs per constitution §4).

### Dependencies

- Use `blocks` edges only where work truly cannot start. Don't over-link.
- **Gameplay is never blocked by final art or audio.** Gameplay uses grey-box/placeholder assets. Final assets arrive via separate integration beads.
- Cross-epic dependencies reference **anchor keys** (§7) so parallel planners can link to each other.

---

## 6. Asset beads (art, music, SFX)

Consistency is defined **up-front** in bibles, then every asset follows a template.

1. `docs/art/style-bible.md` (bead `e37-style-bible`): visual pillars, palette (hex), lighting, shape language, material rules, silhouette rules per class/creature family, camera/FOV, UI style, what we never do. Includes a **style preamble** paragraph pasted at the top of every GPT image prompt.
2. `docs/audio/audio-bible.md` (bead `e38-audio-bible`): musical identity (instrumentation, modes, motifs per location/character), adaptive layers (explore/tension/combat/stealth), loudness targets, SFX sonic palette, formats, naming. Includes a **Suno style preamble** and an **SFX preamble**.
3. Prompt templates, one per asset category, in `assets/prompts/_templates/`.
4. One **prompt bead per asset** (or per tightly-related asset set, e.g. "goblin camp props sheet"). A prompt bead's deliverable is `assets/prompts/<category>/<asset-id>.md` containing:
   - asset id (kebab-case, matches final filename), category, consuming bead(s)
   - template used + filled prompt (style preamble included verbatim)
   - output spec (tool, resolution/aspect, transparency, tileable?, duration/BPM/key for music, loop points, file format)
   - consistency checklist from the bible (palette, lighting, silhouette, motif…)
   - iteration log placeholder
5. Each prompt bead is followed by a **generate** task and an **integrate** task.
   - **Generate** is run by Claude for images (Codex CLI), 3D models (Meshy/Tripo API) and SFX (ElevenLabs API). Only music generation is `needs-human` (owner pastes the prompt into Suno, ~1 min/track).
   - **Approval gates** are `needs-human`: the owner approves (a) the flat image, (b) the 3D turntable render, (c) the music take, (d) SFX batches by listening. Approvals are recorded in the approval log (`e37-asset-approval-log`); CI refuses final assets without an approval record.
   - **Integrate** wires the approved asset in, records provenance/licence in `assets/CREDITS.md`, and replaces the placeholder (blocked by generate + approval and by the consuming gameplay feature).
   - API keys come only from environment variables and are never committed or logged.

Asset IDs: `<category>-<subject>-<variant>`, e.g. `portrait-npc-mirela-bookseller`, `music-briar-glen-day-explore`, `sfx-knight-parry-metal-01`.

---

## 7. Anchor keys

Planning agents write plan files with **keys** (`eNN-short-slug`). The keys below are reserved: the owning
group MUST create a bead with exactly this key, and any group MAY depend on them.

| Key | Owner | Meaning |
|---|---|---|
| `e00-repo-scaffold` | Foundation | TS/Vite/pnpm project, lint/format/typecheck, Vitest + coverage config |
| `e00-ci-pipeline` | Foundation | GitHub Actions: lint, typecheck, tests, coverage gate + ratchet, Playwright smoke |
| `e00-branch-protection` | Foundation | main protection, squash-only, required checks |
| `e00-backlog-html` | Foundation | backlog.html generator + Pages deploy (Completed / Upcoming tabs) |
| `e00-engine-decision` | Foundation | Spike + ADR: Three.js vs Babylon.js (+ physics) |
| `e00-sim-core` | Foundation | Deterministic fixed-timestep loop, seeded RNG, injected clock, entity/component store, event bus |
| `e00-content-pipeline` | Foundation | Schema-validated content loading (zod), content test harness |
| `e00-greybox-testbed` | Foundation | Dev scene + greybox level kit, debug camera, scene loader |
| `e00-replay-harness` | Foundation | Input recording + deterministic replay + state hashing in tests |
| `e30-save-serialization` | Foundation | Versioned save format, IndexedDB storage, migrations |
| `e31-settings-framework` | Foundation | Settings store + options UI skeleton |
| `e32-perf-budgets` | Foundation | Automated perf budget suite against baseline numbers |
| `e33-debug-console` | Foundation | In-game debug console / cheats / spawners |
| `e34-telemetry-events` | Foundation | Local-first telemetry event schema + export |
| `e02-input-actions` | Core | Remappable action map (KB/M first, gamepad second) |
| `e02-player-controller` | Core | Third-person movement, jump, climb hooks, stance |
| `e02-camera` | Core | Third-person camera, lock-on, collision |
| `e02-interaction` | Core | Interact verb, targeting/focus, contextual prompts |
| `e03-world-properties` | Core | Property tags: flammable, wet, frozen, conductive, weight, fragile, etc. |
| `e03-element-propagation` | Core | Fire/heat, water, ice, electricity, gas propagation rules |
| `e03-light-field` | Core | Queryable light level per position (for stealth + puzzles) |
| `e03-physics-objects` | Core | Movable, throwable, breakable, stackable objects |
| `e03-doors-locks-switches` | Core | Doors, locks, levers, pressure plates, mechanisms |
| `e03-triggers` | Core | Trigger volumes + scripted-free event wiring |
| `e15-puzzle-kit` | Core | Designer puzzle composition from world objects |
| `e27-world-state-store` | Core | Persistent world facts (opened, looted, befriended…) |
| `e04-damage-model` | Combat | Hitboxes/hurtboxes, damage types, poise/stagger |
| `e04-melee-core` | Combat | Knight attack chain, block, parry, dodge |
| `e05-bow-core` | Combat | Draw, aim, release, arrow projectile physics |
| `e28-audio-engine` | Combat | Positional audio, buses, mixer, occlusion hooks |
| `e29-vfx-framework` | Combat | Particle/VFX system, hit sparks, spell visuals hook |
| `e06-spell-pipeline` | Magic | Data-driven spell definition → effect pipeline |
| `e07-spellbook-learning` | Magic | Learn spells from book items |
| `e21-bookshop-system` | Magic | Bookshop inventory rules (regional, rare, secret, rotating) |
| `e09-visibility-model` | Stealth/AI | Visibility score from light, stance, motion, distance |
| `e09-sound-propagation` | Stealth/AI | Noise events, surfaces, propagation, occlusion |
| `e11-perception` | Stealth/AI | Creature senses (sight cone, hearing, smell hooks) |
| `e11-alert-states` | Stealth/AI | Unaware→Suspicious→Investigating→Searching→Alerted→Combat |
| `e12-creature-schema` | Stealth/AI | Data schema for creatures (senses, locomotion, dispositions…) |
| `e17-inventory-core` | Systems | Inventory model, equip slots, keys, books, quest items |
| `e18-loot-tables` | Systems | Loot table data + placement |
| `e19-progression-core` | Systems | Capability-unlock progression model |
| `e20-shop-system` | Systems | Merchants, prices, stock, buy/sell |
| `e22-dialogue-runtime` | Systems | Dialogue graph runtime, conditions, disposition |
| `e23-quest-runtime` | Systems | Quest state machine, branching objectives, multi-resolution |
| `e37-style-bible` | Art/Audio | Visual style bible + GPT style preamble |
| `e37-3d-pipeline-decision` | Art/Audio | Spike: how 3D models/animations are sourced |
| `e37-prompt-templates` | Art/Audio | Image prompt templates per category |
| `e38-audio-bible` | Art/Audio | Audio bible + Suno and SFX preambles |
| `e38-sfx-tool-decision` | Art/Audio | Spike: SFX generation/sourcing tool |
| `e38-prompt-templates` | Art/Audio | Music + SFX prompt templates |
| `e39-story-bible` | Narrative | Story bible: premise, cast, factions, main quest, twists, title |

---

## 8. Plan file format (for planning agents)

Planning agents do **not** call `bd create` directly. Each writes `plan/<group>.json`, which is validated and
loaded by `scripts/load-plan.mjs` (two passes: create, then link).

```json
{
  "group": "stealth-ai",
  "epics": [
    {
      "id": "mw-e09",
      "title": "E09 — Systemic Stealth",
      "priority": 1,
      "labels": ["epic:e09", "area:sim", "milestone:m2"],
      "description": "## Outcome\n…\n## Scope\n- In: …\n- Out: …\n## Exit criteria\n- …",
      "acceptance": "- EC-1 …"
    }
  ],
  "items": [
    {
      "key": "e09-visibility-model",
      "epic": "mw-e09",
      "type": "feature",
      "title": "Compute player visibility from light, stance, motion and distance",
      "priority": 0,
      "labels": ["epic:e09", "area:sim", "milestone:m2", "class:thief"],
      "estimate_minutes": 480,
      "description": "## Why\n…\n## What\nAs a thief, …\n## Scope\n- In: …\n- Out: …\n## Notes\n…",
      "acceptance": "- AC-1 [unit] Given …, when …, then …\n- AC-2 …",
      "depends_on": ["e03-light-field", "e00-sim-core"]
    }
  ]
}
```

- `key`: unique, `eNN-kebab-slug`, prefix = owning epic.
- `depends_on`: keys (own or anchor keys) or explicit epic IDs (`mw-e03`) meaning "the whole epic".
- Unknown keys fail the loader — only use your own keys or anchor keys from §7. Put anything else in the
  description under `## Notes` as "Related: <free text>" for the integration pass.
- Items are listed in intended implementation order within an epic.
