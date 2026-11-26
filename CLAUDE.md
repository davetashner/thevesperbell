# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## Source of truth

- `CONSTITUTION.md` — product vision and design pillars. Everything is subordinate to it.
- `docs/backlog-contract.md` — how beads are written, coverage policy, DoD, asset workflow, hardware baseline.
- `docs/narrative/story-bible.md` — story canon (names, places, plot). `docs/art/style-bible.md` and `docs/audio/audio-bible.md` — asset consistency; every asset prompt starts from their preambles.
- Backlog: `bd` (prefix `mw-`), published at https://thevesperbell.com/backlog.html on every merge to main (S3 + CloudFront in AWS account 205074708100, defined in `infra/site.yml`).

## Workflow

1. Pick work from `bd ready`; claim it (`bd update <id> --claim`).
2. Create a worktree from latest main: `git fetch origin main && git worktree add .claude/worktrees/<branch> -b <branch> origin/main`.
3. Implement with tests that name the ACs (`it('AC-2: ...')`). Coverage rules in the contract §3 are enforced by CI; never lower coverage.
   - e2e specs must not wait on long stretches of sim time: the frame loop runs at most 5 sim ticks per frame, so a 20 s settle can take minutes on a slow CI runner (PR #509). Cover long sim processes in integration tests; in e2e, assert the player's action and its immediate effect.
4. Commit with sign-off (`git commit -s`), reference the bead ID in the message.
5. Open a PR to `main` with one `Closes mw-…` line per completed bead. Squash merge only.
6. After merge: `bd close <id> --reason "Completed in PR #N"`, export (`bd export -o .beads/issues.jsonl`) in the next PR, remove the worktree.

## Build & Test

Node 24 (`.node-version`, engine-strict) and pnpm via corepack. See README Quickstart.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test   # quality gates (full: night mode or CI; see Laptop load)
pnpm lint:changed                         # day mode: lint only files changed vs origin/main
pnpm test:coverage                        # coverage/ (json-summary + lcov)
pnpm e2e                                  # Playwright smoke vs production build
pnpm bench                                # sim perf budgets (vitest benchmarks)
pnpm perf                                 # perf budget suite, CI mode (README: Perf budgets)
pnpm build                                # dist/
```

## Laptop load (day vs night)

The repo is developed on the owner's laptop (10 cores), which they use during the day. Type-aware lint, coverage, Playwright and perf runs are heavy; five agents running them at once pushed load to ~28 and turned a lint into a 45-minute crawl (2026-11-25). Check the local hour with `date +%H` before starting heavy work and dispatching workers.

**Day mode, 07:00-01:00 local (default):**

- **At most 2 implementation workers** (subagents or worktree sessions) at a time, plus the lead. Read-only research agents don't count.
- **Scoped commands only.** Don't run the full suites locally; push and let CI run them:
  - lint: `pnpm lint:changed` (only files changed against `origin/main`), not `pnpm lint`
  - types: one `pnpm typecheck` before pushing
  - tests: `pnpm vitest run <the test files you touched>`, not `pnpm test` / `pnpm test:coverage`
  - e2e: `E2E_PORT=<free port> pnpm e2e <the specs you touched>`, never the whole suite
  - no `pnpm perf`, `pnpm bench`, `pnpm content:coverage` or repeated `pnpm build`; CI runs them
  - `pnpm world:validate`, `pnpm nav:check` and `pnpm nav:bake` for the scenes you changed are light and fine
- **One heavy command at a time per agent.** Start anything that may take over ~2 minutes with `run_in_background` and wait for its notification.
- **Never re-run a command that timed out or was moved to the background**: it is still running. Wait for it, or stop it (TaskStop on your own task) before starting another.
- **Check load first.** If the 1-minute load (`sysctl -n vm.loadavg`) is above the core count (`sysctl -n hw.ncpu`), wait (a Monitor until-loop) instead of adding a heavy command.
- Stop dev servers and Playwright servers you started once you're done with them.

**Night mode, 01:00-07:00 local:** up to 5 implementation workers, and the full local gates (`pnpm lint`, `pnpm test:coverage`, `pnpm content:coverage`, the e2e suite) are fine. The one-heavy-command and no-duplicate-rerun rules still apply.

**Leads:** put the current mode's rules in every worker brief. A worker that runs past 07:00 switches to day mode for its remaining commands.

## Lead and merging

One session is the lead (named in the `HANDOFF: thevesperbell` bead, mw-77x); only the lead merges and republishes the beads export. The owner's standing agreement: merge once CI is green, without asking.

- **Review before merge.** A worker's report says what it meant to do. Read the PR diff (`gh pr diff <n>`) before merging, and spot-check any risky claim: shared state, three.js internals, anything that loosens a test.
- **One merge at a time.** Before each merge, check `gh pr view <n> --json mergeStateStatus`. If the branch is `BEHIND`, merge main into it and wait for CI again. Conflicts are usually in `e2e/shards.json`, `CHANGELOG.md`, `connectivity.json`, scene lists and perf budgets; keep both sides.
- **Wait, don't poll.** Run `gh pr checks <n> --watch` with `run_in_background` and act on the notification.
- **Beads export.** After a merge, close its beads, then fold a fresh `bd export -o .beads/issues.jsonl` into the next PR the lead merges. Workers never touch the export.
- **Worker briefs** name the files each concurrent worker owns, so the others stay out of them. Workers may push and open PRs, but they never merge or close beads.
- **Dependabot PRs** are the lead's to triage. Merge main into the branch first, because stale shard weights make e2e shards time out. A typescript-eslint minor release can add rules to `strictTypeChecked`: fix the code, or turn a rule off in `eslint.config.js` with a comment saying why. Push the fix to the dependabot branch.

## Architecture Overview

Deterministic, engine-agnostic game rules in `src/sim` (100% coverage, no DOM/renderer/wall clock/Math.random); data-driven content in `src/content`; renderer/audio/UI glue in `src/game`, `src/render`, `src/audio`, `src/ui`. World interactions are property-based (flammable, wet, conductive…) via a single stimulus API — never pairwise scripted. See contract §2.

Area crossings swap the scene in place (`swapArea` in `src/main.ts`). The canvas and WebGLRenderer (`createGlSurface`, `src/render/bootstrap`) live for the whole page; each area brings its own scene, camera and physics. Area code must not assume it has a fresh canvas or renderer. Add canvas listeners through the session's `PageScope` (`watch(canvas)`), so the swap removes them. Never call `forceContextLoss` or replace the canvas. A swap frees GPU uploads through `surface.releaseUploads()`. Audio still restarts per area (mw-ju8.47).

## Assets

Images: Claude generates via Codex CLI. 3D: Claude generates via Meshy/Tripo API from owner-approved flat images. SFX: ElevenLabs API. Music: owner pastes Claude's prompt into Suno. The owner approves every asset (flat image, 3D turntable, music take, SFX batch); approvals are recorded and enforced in CI. API keys only via environment variables — never commit or log them.
