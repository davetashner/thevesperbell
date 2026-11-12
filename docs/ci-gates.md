# CI gate tiers

Every CI job and Playwright project belongs to one tier (mw-e41.5). The tiers keep the pull-request
wall clock short without losing the slow signals: those run every night on `main` and again on a
release candidate.

| Tier | Runs | Failure means |
|---|---|---|
| **per-PR** | every pull request (and, for the baseline artifacts, pushes to `main`) | the PR cannot merge |
| **nightly** | `nightly.yml`, 03:43 UTC on `main` and on `workflow_dispatch` | one GitHub issue labelled `nightly-failure` is opened, or commented on if already open; a green run closes it |
| **release** | the whole nightly set against a release candidate (mw-e41.12), via the reusable `slow-gates.yml` | the release does not ship |

Nightly gates are release gates too: `slow-gates.yml` is a `workflow_call` workflow with `bench`, `audio`,
`perf` and `matrix` switches and an optional `ref`, so nightly, the main-push baseline and the release gate share
one definition.

## Jobs

| Job (workflow) | Tier | Reason |
|---|---|---|
| `lint` (ci.yml) | per-PR | Fast; includes the sim determinism and layer-import rules; required. |
| `typecheck` (ci.yml) | per-PR | Fast; required. |
| `unit` (ci.yml) | per-PR | Required context name. A no-op that points at `coverage-gate`; vitest bench left it for the nightly tier. |
| `coverage-gate` (ci.yml) | per-PR | The only unit and integration test run; enforces the per-layer thresholds of contract §3; required. |
| `coverage-ratchet` (ci.yml) | per-PR | Coverage must not decrease versus `main`; seconds; required. |
| `e2e-shard` 1 to 6 (ci.yml) | per-PR | Chromium e2e smoke in duration-weighted shards (`e2e/shards.json`); the behaviour gate for gameplay changes. |
| `e2e-playthrough` (ci.yml) | per-PR | The slice playthrough replays a whole run; kept on every PR until path-aware selection lands (mw-e41.4). |
| `e2e-smoke` (ci.yml) | per-PR | Aggregates the e2e jobs under the required check name. |
| `perf-budget` (ci.yml) | per-PR tier skipped; runs on push to `main` | Publishes the `perf-report` baseline artifact. Warn-only on GPU-less runners, ~510 s, so it is off every PR's critical path. |
| `interaction-matrix` (ci.yml) | per-PR | 500 generated worlds x 300 ticks from a fixed seed keep every invariant (about 20 s), and the interaction matrix is regenerated, checked against the committed file and diffed into the job summary (mw-e03.26). |
| `puzzle-validate` (ci.yml) | per-PR | `pnpm puzzle:validate`: every declared puzzle solution is proven reachable by a bounded abstract search (10 s per puzzle) and its step list runs in the headless sim; fails when an `mvp` puzzle has an unreachable or diverging solution (mw-e15.6). It also runs `pnpm puzzle:coverage --check` (mw-e15.8): `docs/design/puzzle-coverage.md` must be current, every `mvp` puzzle needs 2 distinct validated solutions and 3 of 4 classes able to solve it at MVP capability levels, and the step summary shows how the PR changes the coverage. |
| `world-validate` (ci.yml) | per-PR | `pnpm world:validate`: `src/content/data/world/connectivity.json` (docs/design/world-map.md) must have every node reachable from the town spawn with the base classes' capabilities, the story bible's loops, an ability-gated shortcut per class, and a main quest that never needs Wendmouth or the barge; shortcut unlock facts no placed content writes yet are warnings (mw-e24.1). |
| `dialogue-validate` (ci.yml) | per-PR | `pnpm dialogue:validate`: every dialogue in `src/content/data/dialogue/` (docs/design/dialogue-format.md) must pass the schema, the logic DSL and content-reference checks (`validateDialogueLogic`, the persuasion table's conditions) and the graph checks of `validateDialogueGraph`: every node reachable from an entry, every step continues or ends, no choice whose options are all provably unsatisfiable, no loop with no way out (the cycle path is printed). Errors exit 1; lines or options over `DIALOGUE_MAX_TEXT_LENGTH` (240, `--max-length` overrides), single unsatisfiable options and one-class option sets are warnings that print and exit 0 (mw-e22.8). |
| `size-budget` (ci.yml) | per-PR | `pnpm build:release` then `pnpm size:check` (mw-e32.3, `perf/size-budgets.json`): initial JS <= 1.5 MB gzipped, initial payload <= 50 MB, textures <= 4 MB, audio loops <= 3 MB, no `src/tools/` module in any chunk; about 30 s. The job summary shows the delta against `main`'s `size-report` artifact. Not yet a required check: adding it to branch protection is an owner-approved step (`docs/repo-settings.md`). |
| `build` (ci.yml) | per-PR | The production build must work; required. |
| `beads-validate` (ci.yml) | per-PR | Seconds; validates the backlog export; required. |
| `element-matrix` (slow-gates.yml) | nightly, release | The same property run over 8000 worlds from a daily seed: finds the rare combinations the fixed seed misses (mw-e03.26). |
| `bench` (slow-gates.yml) | nightly, release | Vitest benchmark budgets (sim `step()` mean, mw-e00.15 AC-6); timing-sensitive and slow-moving. |
| `e2e-audio` (slow-gates.yml) | nightly, release | Firefox and WebKit Web Audio testbed with PulseAudio; engine differences change with browser releases, not with our PRs. |
| `perf-budget` (slow-gates.yml) | nightly, release | The perf budget suite including the wall-clock load budgets (mw-e41.8); noisy on shared runners. |
| `gates` (nightly.yml) | nightly | Calls `slow-gates.yml`. |
| `report` (nightly.yml) | nightly | Opens or updates the single `nightly-failure` issue; closes it when green. |
| `secrets` (security.yml) | per-PR | Secret scanning; required. Also runs nightly on its own schedule. |
| `audit` (security.yml) | per-PR | Dependency audit; required. New advisories also land on an unchanged `main`, so it runs on its own nightly schedule too. |
| `dependency-review` (security.yml) | per-PR | Flags risky dependency changes in the PR; required. |
| `pr-lint` (pr-lint.yml) | per-PR | Closes lines in the PR body; required. |
| `changelog` (pr-lint.yml) | per-PR | User-facing changes carry a CHANGELOG note; required. |
| `dco` (pr-lint.yml) | per-PR | Every commit in the PR has a `Signed-off-by` line (`git commit -s`); seconds. Not yet a required check: adding it to branch protection is an owner-approved step (`docs/repo-settings.md`). |
| `validate` (plan-check.yml) | per-PR | Backlog checks, path-filtered to `plan/`, `.beads/` and `scripts/`; seconds. |
| `publish` (publish-site.yml) | per-PR | Republishes the backlog site on PR events and `main` pushes; no test signal. |

## Playwright and Vitest projects

| Project | Tier | Reason |
|---|---|---|
| `chromium` (playwright.config.ts) | per-PR | The e2e smoke suite, run by `e2e-shard`. |
| `playthrough` (playwright.config.ts) | per-PR | Run by `e2e-playthrough`, alone on a runner. |
| `firefox` (playwright.config.ts) | nightly, release | Audio testbed only; run by `e2e-audio`. |
| `webkit` (playwright.config.ts) | nightly, release | Audio testbed only; run by `e2e-audio`. |
| `ci` (playwright.perf.config.ts) | nightly, release (and `main` pushes for the baseline) | Perf budget suite in CI mode, including the wall-clock load budgets. |
| `reference` (playwright.perf.config.ts) | manual | Absolute frame-time budgets on the reference machine; not runnable on CI hardware. |
| `latency` (playwright.perf.config.ts) | manual (`pnpm perf:ref`, `pnpm perf:latency`) | Input-to-motion latency (≤ 100 ms p95 High, ≤ 133 ms Low at 30 fps) and controller (≤ 0.3 ms/tick) and camera (≤ 0.2 ms/frame) cost on the reference machine, headed Chrome with vsync on (mw-e02.8); not runnable on CI hardware. |
| vitest unit and integration (`vite.config.ts`) | per-PR | Run once, inside `coverage-gate`. |
| vitest bench (`pnpm bench`) | nightly, release | See `bench` above. |

## Rules for changing tiers

- A job that is a required branch-protection context stays per-PR under the same name, even if its body
  becomes a no-op (as `unit` did). Changing branch protection is a separate, owner-approved step.
- A gate moves to nightly only if it is slow or noisy and catches slowly-changing problems. Correctness
  gates for code a PR touches stay per-PR.
- A nightly failure is triaged from the `nightly-failure` issue; fixing it is a normal bead.
