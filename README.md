# The Vesper Bell

A desktop-first, browser-based fantasy action RPG. Start with [`CONSTITUTION.md`](CONSTITUTION.md)
for the vision and [`docs/backlog-contract.md`](docs/backlog-contract.md) for how work is planned and tested.
The backlog is published at https://thevesperbell.com/backlog.html.

## Build, launch and play

### 1. Install the toolchain

You need **Node 24 LTS** (pinned in `.node-version`; `engine-strict` makes `pnpm install` fail on any
other major) and **pnpm**, which comes through corepack at the version pinned by `packageManager` in
`package.json`. You also need a desktop browser with WebGL 2 and WebAssembly (current Chrome, Edge,
Firefox or Safari); the game shows an "unsupported" message otherwise.

```bash
# Node 24 — pick one:
fnm install && fnm use                  # fnm / mise / nodenv / nvm read .node-version
brew install node@24 && export PATH="$(brew --prefix node@24)/bin:$PATH"   # macOS Homebrew

node -v                                 # must print v24.x
corepack enable                         # Node 25+ no longer bundles corepack: npm i -g corepack first
```

### 2. Install dependencies

```bash
git clone https://github.com/davetashner/thevesperbell.git
cd thevesperbell
pnpm install
```

### 3. Launch

**Development** (hot reload, debug console always on):

```bash
pnpm dev                                # http://localhost:5173
```

**Production build** (what players get; the debug console needs `?debug=1`):

```bash
pnpm build                              # outputs dist/
pnpm preview                            # serves dist/ at http://localhost:4173
```

`dist/` is a static site: any static file server works too (it must serve `.wasm` files).

### 4. Play

There is no title screen or pause menu yet (mw-e01.2, mw-e01.3), so you start a game from the URL.
The best place to start is the vertical slice as the Knight:

> **http://localhost:5173/?scene=slice&newgame** — pick your class on the class-select screen
> (only the Knight is playable in m1), or skip it with
> **http://localhost:5173/?scene=slice&class=knight**.

Then **click the game view** to capture the mouse and play; **Esc** releases it. Use port `4173`
instead of `5173` under `pnpm preview`.

Without `?class=` or `?newgame` you play a classless character with no starting kit. With no
`?scene=` you land in the grey-box testbed.

#### Controls

All bindings are remappable (`src/game/input/bindings.ts`); a controller works alongside keyboard and
mouse with no setup, and the on-screen hints follow whichever device you used last.

| Action                  | Keyboard + mouse          | Controller (Xbox labels) |
| ----------------------- | ------------------------- | ------------------------ |
| Move                    | WASD / arrow keys         | Left stick               |
| Look                    | Mouse                     | Right stick              |
| Camera zoom             | Mouse wheel               | —                        |
| Jump / mantle           | Space                     | A                        |
| Sprint                  | Left Shift (hold)         | LS click (toggle)        |
| Crouch                  | C                         | D-pad down               |
| Slow walk               | X                         | Light push on left stick |
| Dodge roll              | R                         | B                        |
| Interact (doors, levers, pick up, loot) | E         | X                        |
| Attack (hold to draw a bow) | Left click            | RT                       |
| Block / shield          | Right click               | LT                       |
| Lock on                 | Q or middle click         | RS click                 |
| Cycle lock-on target    | Tab                       | —                        |
| Abilities 1–4 (4 = bow) | 1 2 3 4                   | Y/D-pad up, RB/D-pad right, LB, D-pad left |
| Inventory               | I                         | View                     |
| Drop / throw item       | G / T                     | —                        |
| Pause / release mouse   | Esc or P                  | Menu                     |

#### Scenes

Load any scene with `?scene=<id>` (an unknown id lists the available ones):

| Scene id          | What's there |
| ----------------- | ------------ |
| `slice`           | The m1 vertical slice: spawn room → wooden door → dim corridor (optional ivy climb) → arena → loot alcove → locked iron exit. Walking into the vestibule behind the exit completes it. |
| `testbed` (default) | Climbing wall, arrow target, locked closet with its key nearby, a supply chest, a hazard strip and an arena with three training dummies to lock on to. |
| `combat-sandbox`  | Arena with a training dummy and an attacker dummy for practising block, parry and dodge (see [Combat sandbox](#combat-sandbox)). |
| `mechanism-room`  | Every mechanism: lever and portcullis, burnable wooden door, locked iron door, timed button door, crank and trapdoor. |
| `weak-wall-room`  | A cracked wall to smash with a heavy attack and a breakable crate. |
| `lighting-room`   | Torches, a burning crate and moonlight, with dark corners to hide in. |
| `kit-gallery`     | Every grey-box kit piece in a row (an art check, not gameplay). |

**What the slice can't do yet:** the Forgotten miner skeleton and the gallery key it drops are not
placed in the level yet (mw-e01.6), so the arena is empty and the exit door stays locked. Until then,
use the debug console to play those beats: `spawn forgotten-miner` puts a skeleton in front of you,
and `noclip` walks you through the exit door into the vestibule.

#### Debug console and URL options

Press **`` ` ``** (backtick) to open the debug console; `help` lists every command and `help <command>`
shows its usage. It is always on under `pnpm dev` and in the combat sandbox, and on production builds
with `?debug=1`. Handy commands:

| Command | Does |
| ------- | ---- |
| `spawn <id> [count] [at-cursor]` | Spawn a creature or prop (Tab completes ids), e.g. `spawn forgotten-miner` |
| `give <itemId> [n]` | Add items, e.g. `give healing-draught 3` (ids are the files in `src/content/data/item/`) |
| `god`, `noclip` | Toggle invulnerability / walking through walls |
| `tp <x y z \| place>` | Teleport, e.g. `tp player-start` |
| `timescale <0–n>` | Slow down or freeze the sim |
| `scene <id>` | Load another scene |
| `save [slot]` | Save into a slot |

| URL parameter | Does |
| ------------- | ---- |
| `?scene=<id>` | Load a scene |
| `?newgame` | Open class select |
| `?class=<id>` | Start as `knight` (or `archer`, `sorcerer`, `thief` once unlocked) |
| `?allclasses` | Unlock every class on the class-select screen (builds with the debug console) |
| `?debug=1` | Enable the debug console on a production build |
| `?frames` / `?hitboxes` | Combat frame-data overlay / hit-volume wireframes |
| `?perf` | Frame-time probe |
| **F2** (key) | Free-fly debug camera (WASD, Q/E down/up, Shift fast, drag to look) |

Dying plays a death beat, then the death screen lets you reload a save or restart the area.

#### Troubleshooting

- **`pnpm install` fails with an engine error** — you're not on Node 24; check `node -v`.
- **`pnpm: command not found`** — run `corepack enable` (on Node 25+, `npm i -g corepack` first).
- **Black screen or "unsupported" message** — the browser lacks WebGL 2 or WebAssembly; enable hardware
  acceleration or try another browser.
- **The mouse doesn't turn the camera** — click the game view to capture the pointer.

## Developer scripts

| Script               | What it does                                                     |
| -------------------- | ---------------------------------------------------------------- |
| `pnpm dev`           | Vite dev server with HMR                                         |
| `pnpm build`         | Production build into `dist/`                                    |
| `pnpm preview`       | Serve `dist/` locally                                            |
| `pnpm lint`          | ESLint (typed `typescript-eslint` strict rules + Prettier compat) |
| `pnpm format`        | Prettier write (`format:check` to verify only)                   |
| `pnpm typecheck`     | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| `pnpm test`          | Vitest unit + integration tests                                  |
| `pnpm test:coverage` | Vitest with v8 coverage into `coverage/` (text, json-summary, lcov) |
| `pnpm e2e`           | Playwright smoke tests against the production build              |
| `pnpm bench`         | Vitest benchmarks (`*.bench.ts`) that assert sim perf budgets    |
| `pnpm perf`          | Perf budget suite, CI mode (see [Perf budgets](#perf-budgets)); `PERF_HEAP_IDLE_S=30` shortens the 5-minute heap idle |
| `pnpm perf:ref`      | Perf budget suite, reference mode: absolute frame-time budgets on the reference machine only |
| `pnpm perf:budgets`  | Validates `perf/perf-budgets.json`: every budget quotes the contract's hardware baseline |
| `pnpm content:coverage` | After `pnpm test`: fails listing content entries no passing test exercised |
| `pnpm content:schemas`  | Regenerates `src/content/data/<type>.schema.json` for editor autocompletion |
| `pnpm content:docs`     | Regenerates the field reference `docs/content/<type>-schema.md` for each content type |
| `pnpm nav:bake [scene…]` | Bakes creature navmeshes into `src/content/data/navmesh/<scene>.json` (`nav:check` fails when one is stale) |
| `pnpm replay:record`    | Records a registered sim scenario into a golden replay in `tests/replays/` |
| `pnpm replay:rebless`   | Re-records golden replays after an intended sim/content change (review the diff) |

First e2e run: `pnpm exec playwright install chromium`.

## Opening the game

`/` is the front door: the title screen (New Game, Continue, Load) over the game's start scene
(`game.startScene` in `src/content/data/game/game.json`; the slice in m1). New Game opens class
selection, and confirming starts the run at the start scene's spawn point. Any of `?scene=<id>`,
`?newgame`, `?class=<id>` or `?menu=title|load|save` skips the title for development and the e2e:
**`/?scene=testbed`** is the grey-box testbed, `/?scene=slice` the slice without the menus.

## Perf budgets

`perf/perf-budgets.json` holds every perf budget, each quoting the hardware baseline in
`docs/backlog-contract.md` §1 (mw-e32.1). The suite (`e2e/perf/`, its own `playwright.perf.config.ts`)
has two modes:

- **CI mode** (`pnpm perf`, the `perf-budget` CI job): initial transfer and build size ≤ 50 MB,
  load-to-playable ≤ 10 s and warm reload ≤ 3 s at 50 Mbps (CDP throttling), JS heap ≤ 1.5 GB after
  5 minutes idle in the testbed. The runners have no GPU, so every frame is software-rendered and is
  itself a 100–200 ms main-thread task. That gives frame time no absolute budget: CI compares it with
  main's last report and only warns when p50 or p95 is more than 15 % slower. For the same reason,
  long tasks that are frame renders (they overlap a `requestAnimationFrame` callback) are only
  reported. The budget is on the other long tasks ≥ 200 ms (GC, parsing, timers), of which there must
  be none during play: the `perf-baseline` sampling window and the testbed's idle minutes. Long tasks
  while loading are reported only.
- **Reference mode** (`pnpm perf:ref`, by hand on the reference machine — MacBook Pro M1 Pro, Chrome):
  headed Chrome, uncapped, 2560×1440 drawing buffer, 1,800 frames after a 3 s warm-up in the
  `perf-baseline` scene. It fails unless frame time p50 and p95 are ≤ 16.7 ms and no task of 200 ms or
  more, frame renders included, runs while frames are sampled. Writes
  `perf/results/<date>-<sha>.json`; commit it so results build a trend. Close other apps first.

Every run writes `test-results/perf-report.json` and prints a per-budget table. `perf-baseline`
(`/?scene=perf-baseline`) is the stress scene: 64 crates kept tumbling by force blasts at its
`perf-agitator` markers, eight lamps and moonlight, fixed camera.

## Combat sandbox

Where combat feel is judged and tuned: open **`/?scene=combat-sandbox`** (e.g.
`http://localhost:5173/?scene=combat-sandbox` under `pnpm dev`, or the same path on a preview or
playtest build). A walled arena with a training dummy to hit and an attacker dummy that swings at
you every 2.0 s for block, parry and dodge practice. Click to take control (the usual knight controls).

| Key / command | What it does |
| --- | --- |
| `F3` | Frame-data overlay (on by default): each fighter's move, phase, tick, i-frame and hyperarmor badges, hit reaction, health, poise and DPS, plus the hitbox/hurtbox wireframes |
| `F4` | Slow motion: the sim runs at 0.25× wall time (tick counts and frame data are unchanged) |
| `` ` `` | Debug console (always available in the sandbox); `dummies` lists every option below |
| `spawn dummy [n] --health 500 --poise 60 --resist slash=0.5 --regions head,torso,limb,weakpoint --infinite off` | Spawn training dummies in front of you |
| `spawn attacker-dummy --move sword-light-1 --every 1.5 --unblockable on` | Spawn another attacker |
| `attacker --every 1 --parryable off --unblockable on`, `attacker off` | Retune every attacker's metronome |
| `dummies --infinite off` | Mortal dummies (infinite ones refill 3 s after the last hit) |
| `timescale 0.1`, `god`, `tp player-start` | The console's usual speed, cheat and teleport commands |
| `blast [intensity 1500] [radius 4]` | Set off a force blast in front of you: it throws you (and props) back |
| `ctl.get [runSpeed]`, `ctl.set runSpeed 6`, `ctl.dump` | Read and live-edit the player's movement values (validated, from the next tick; replays record it), then print the edited `src/content/data/controller/player.json`. In `pnpm dev`, saving that file retunes the player without a reload |

The dummies and the knight's placeholder numbers are content: `src/content/data/sandbox/combat-sandbox.json`
(all flagged placeholders to tune). The overlay's World column shows the latest harm the world dealt
each fighter — a fall, a wall strike, a crushing object or a hazard — with falls priced by
`src/content/data/environment-damage/default.json`. `?frames` adds the overlay to any scene; the sandbox's sim seed is
fixed, so e2e tests and replays see the same arena every time.

## Layout

Code lives in `src/`, split into layers (contract §2), each importable through an alias (`@sim/*`,
`@content/*`, …) defined once in `tsconfig.json` `paths`:

| Layer          | Holds                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| `src/sim`      | Pure, deterministic game rules: no DOM, no renderer, no wall clock or `Math.random` |
| `src/content`  | Schemas and data files                                                 |
| `src/game`     | Glue that binds sim, renderer, input, audio and UI                     |
| `src/render`   | Renderer-specific code                                                 |
| `src/audio`    | Web Audio playback and mixing                                          |
| `src/ui`       | HUD, menus and dialogue UI                                             |
| `src/tools`    | Dev and content tools                                                  |

**Layer rules are enforced by ESLint** (`eslint/layers.js`; each rule is proven by a fixture in
`tests/lint-fixtures/`):

- `src/sim` must stay deterministic: no `Math.random`, `Date`, `performance`, `crypto`, timers, DOM or
  browser globals. Use the seeded RNG and injected clock instead. `eslint-disable` comments for these rules
  are themselves errors. Iterate arrays and `Map`s (insertion-ordered); avoid `for…in`, even where the
  spec fixes the order.
- Imports: `sim` and `content` may import each other only as types. `render`, `audio` and `ui` may import
  `sim` and `content`. `game` may import every runtime layer, but not `tools`. `tools` may import anything.
  The bootstrap (`src/main.ts`) is unrestricted.

**Coverage** (contract §3) is enforced in CI from one file, `coverage-layers.json`. `src/sim`,
`src/content`, `src/game/save` and `scripts/*.ts` need 100% on every file. `src/game`, `src/ui`, `src/audio`
and `src/tools` need ≥ 90% lines and branches. A **ratchet** (`pnpm coverage:ratchet`) fails a PR if any
metric falls versus main, globally or per layer. When main's CI artifact is unavailable it falls back to the
committed `coverage-baseline.json`; refresh that with `pnpm test:coverage && pnpm coverage:baseline`.
Exclusions and glue-layer gaps live only in `coverage-exclusions.md` (`pnpm coverage:exclusions` checks
them); see that file for how to request one.

**Content** (mw-e00.18) is data, not code. Each content type is a zod schema registered in
`src/content/registry.ts`; each entry is one JSON file at `src/content/data/<type>/<name>.json` (optionally
starting with `"$schema": "../<type>.schema.json"` for editor autocompletion). `loadGameContent()` validates
every file, rejects duplicate ids and references (`ref('creature')`) to missing entries, reporting every
problem with file and JSON pointer, and returns a deeply frozen catalogue with a content hash. Every entry
needs a passing test: `describeContent(type, 'AC-n: …', (entry) => …)` from `src/content/testing.ts`
generates one per entry (or credit a hand-written test with `markExercised`); CI's `pnpm content:coverage`
fails otherwise.

**Replays** (mw-e00.17) are the determinism net (contract §3). A replay (`src/sim/replay/format.ts`) is a
versioned JSON file: the scenario, seed and tick rate, the run-length encoded sim commands fed to
`World.step` on each tick, and a state hash (plus snapshot) every 60 ticks. Every `tests/replays/*.json`
runs in CI (`expectReplay` from `src/tools/replay/expect-replay.ts`); a failure names the first diverging
checkpoint and the entity/component/field that differs, and says when the content hash changed instead.
Scenarios (the code that builds the world a replay drives) register in `src/sim/replay/scenarios/`; scenarios that need
game content register in `src/tools/replay/scenarios.ts`. The character controller goldens (mw-e02.7:
`character-basic`, `character-course`, `character-stress`, from `src/tools/replay/character-scenarios.ts`)
lock movement: after an intended controller or tuning change run `pnpm replay:rebless`, which rewrites
each changed golden and prints its first changed checkpoint and field; after editing an input log run
`pnpm replay:record <name> --force`.

Replays check **outcomes, not the content hash** (mw-e00.31). A golden's `contentHash` (and `buildSha`)
records what its outcomes were last blessed against and is diagnostic only: when a replay diverges and the
content differs from that, the report says "content changed since recording" rather than "determinism
failure". A content change that moves no checkpoint hash passes every golden, and `pnpm replay:rebless`
leaves those files byte-for-byte untouched, so two PRs that add unrelated content never conflict on
`tests/replays/` or the `tests/integration/fixtures/*.replay.json` fixtures; don't rebless or re-record just
because content changed. A content change that does move an outcome still fails until re-blessed, and the
rebless then refreshes the stored hash with the new checkpoints. (Chosen over per-scenario content
fingerprints, which would need every scenario to declare the content it reads, and over moving the hash to
one shared generated file, which would still conflict on every content PR.) Real nondeterminism is caught
independently by the tests that replay a log twice and compare final hashes.

**Secrets** never go in the repo. The `secrets` CI job (`.github/workflows/security.yml`) runs gitleaks over
every PR's commits and the full history on main, and GitHub push protection is on. Locally,
`pnpm hooks:install` (or `bd hooks install`) points git at `.beads/hooks`, whose pre-commit also scans staged
changes when gitleaks is installed (`brew install gitleaks`). A false positive gets an allowlist entry in
`.gitleaks.toml` with a comment explaining it (`pnpm secrets:lint` enforces that).

**Dependencies:** the `audit` CI job (also nightly) fails on any CRITICAL advisory, whether in a runtime
or a dev dependency, and warns on HIGH; `pnpm deps:audit` runs the same check locally. A temporary waiver
goes in `audit-waivers.json` with the GHSA id, a reason, a bead and an expiry date. PRs also run GitHub
dependency review (critical advisories, GPL/AGPL licences). Dependabot opens grouped weekly updates.

Tests sit next to the code as `*.test.ts`. Toolchain tests live in `tests/`, Playwright specs in `e2e/`.
`site/` is the separate static landing site; it is not part of the Vite app.
