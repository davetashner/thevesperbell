# Contributing to The Vesper Bell

Humans and agents follow the same process. This page is the path from a fresh clone to a merged pull
request, then reference sections. It links to the documents that own each rule instead of repeating
them; when they disagree with this page, they win.

| Read | For |
|---|---|
| [`CONSTITUTION.md`](CONSTITUTION.md) | Product vision and design pillars. Everything is subordinate to it. |
| [`docs/backlog-contract.md`](docs/backlog-contract.md) | How beads are written, coverage policy, Definition of Done, asset workflow, hardware baseline. |
| [`docs/ci-gates.md`](docs/ci-gates.md) | Which CI job runs when, and what a failure means. |
| [`docs/repo-settings.md`](docs/repo-settings.md) | Branch protection and required checks. |
| [`README.md`](README.md) | Quickstart, developer scripts, perf budgets. |
| [`CLAUDE.md`](CLAUDE.md), [`AGENTS.md`](AGENTS.md) | The same workflow, condensed for coding agents. |

## From clone to merged PR

1. **Set up.** Node 24 (`.node-version`, engine-strict) and pnpm through corepack. Follow the
   [README quickstart](README.md#build-launch-and-play), then `pnpm install`. Run `pnpm hooks:install`
   once to turn on the beads git hooks. Secrets never go in the repo; see the README's Secrets note.
2. **Pick a bead.** `bd ready` lists unblocked work. Read it with `bd show <id>`, then claim it with
   `bd update <id> --claim`. Work with no bead gets one first (`bd create`, written to the
   [contract §5](docs/backlog-contract.md#5-writing-a-bead)), or a maintainer applies `no-bead` to a
   trivial chore.
3. **Make a worktree** from the latest `main`, one per branch. Never develop in the main checkout.

   ```bash
   git fetch origin main
   git worktree add .claude/worktrees/<branch> -b <branch> origin/main
   cd .claude/worktrees/<branch> && pnpm install --frozen-lockfile
   ```

4. **Implement with tests that name the acceptance criteria**, for example
   `it('AC-2: guard loses track after 8s out of sight')`. Fix-a-bug beads start with a failing
   regression test. See [Writing code](#writing-code) for the rules by layer.
5. **Run the gates** before you push ([Quality gates](#quality-gates)).
6. **Commit with a sign-off and the bead ID**, then push. Never force-push; to catch up with `main`,
   `git merge origin/main`.

   ```bash
   git commit -s -m "Short imperative summary [mw-xyz]"
   git push -u origin <branch>
   ```

7. **Open the PR** to `main` ([Pull requests](#pull-requests)). Squash merge only; the PR title and body
   become the commit on `main`.
8. **After it merges:** `bd close <id> --reason "Completed in PR #N"` for every `Closes` line,
   `git worktree remove <path>`, `git branch -D <branch>`, and `git fetch --prune`. Export the backlog
   in your next PR (below).

## Commits and sign-off

Every commit carries a `Signed-off-by: Name <email>` line, which is the
[Developer Certificate of Origin](https://developercertificate.org/): you wrote it or have the right to
submit it. `git commit -s` adds it. The `dco` job in `.github/workflows/pr-lint.yml` fails the PR when
any commit lacks one. Check before you push with
`git log origin/main..HEAD --format=%B | grep -c '^Signed-off-by:'`. If an unsigned commit slips
through, do not rewrite the pushed branch. Start a new branch from `origin/main`, bring the work over
with `git merge --squash <old-branch>`, commit it with `git commit -s`, and open a replacement PR.

Put the bead ID in the message, as in `[mw-e03.23]`. `bd orphans` finds commits that name a bead which
is still open.

## Pull requests

- **Check what is open first** (`gh pr list`). Related work usually belongs in an existing PR.
- **Pull the latest `main` first.** Branches must be up to date to merge. Check
  `gh pr view <n> --json mergeStateStatus` before anything else; a PR that is behind will not merge even
  with green CI.
- **The body follows [`.github/pull_request_template.md`](.github/pull_request_template.md).** It needs
  one `Closes mw-…` line per completed bead, full ID, alone on the line:

  ```text
  Closes mw-e00.22
  ```

  `pr-lint` fails on `Refs` or an informal mention. IDs must exist in `.beads/issues.jsonl`.
- **Changelog.** A PR that touches `src/{game,ui,render,audio,sim,content}/`, `src/main.ts`,
  `index.html` or `site/` adds a one-line note under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md)
  saying what players will notice. If nothing visible changes, apply the `no-changelog` label **when you
  create the PR**: `gh pr create --label no-changelog`. Adding it later starts a second `changelog` and
  `pr-lint` run; the cancelled one can block merging until rerun (bead `mw-0ft`). Docs, scripts, tests
  and infrastructure PRs need neither.
- **Backlog export.** The published [backlog](https://thevesperbell.com/backlog.html) is built from
  `.beads/issues.jsonl`. After closing beads, run `bd export -o .beads/issues.jsonl` **inside your
  worktree, never in the main checkout**, and include the file in your PR. Preview the page with
  `node scripts/backlog/generate-cli.ts --no-github .beads/issues.jsonl backlog.html`.
- **Merging.** Wait for the required checks ([`docs/repo-settings.md`](docs/repo-settings.md)) to be
  green. The merge is squash-only and deletes the branch.

## Definition of Done

The canonical list is [contract §3](docs/backlog-contract.md#standard-definition-of-done-dod). In
short: every acceptance criterion met and covered by a test that names it; coverage thresholds met and
the ratchet not lowered; the per-PR CI tier green; content schemas valid; a worktree-branch PR with
`Closes` lines, squash-merged; the bead closed after merge; a CHANGELOG note for visible changes. The PR
template repeats it as a checklist. A change that can move a performance budget also runs the affected
gate by hand (`pnpm perf`, `pnpm bench`); see the README's [Perf budgets](README.md#perf-budgets).

## Quality gates

Fast loop while working:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Before you push, run what CI runs on every PR:

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test:coverage \
  && pnpm coverage:exclusions && pnpm content:coverage && pnpm content:loot
```

Add `pnpm e2e` (first run: `pnpm exec playwright install chromium`) when you change gameplay, UI or
rendering. Which CI job gates what, and which are nightly only, is in [`docs/ci-gates.md`](docs/ci-gates.md).

## Writing code

### Layers and determinism

`src/sim` holds the game's rules: deterministic and engine-agnostic, with no DOM, renderer, wall clock
or `Math.random`. It needs **100% coverage** (lines, branches, functions, statements); `src/content`,
save/load and `scripts` are held to the same bar. Content is data-driven (`src/content`). Renderer,
audio and UI glue lives in `src/game`, `src/render`, `src/audio` and `src/ui`. If something is a rule of
the game, it belongs in the sim and is testable without a browser ([contract §2](docs/backlog-contract.md#2-architecture-boundary-drives-testing)).

World interactions are property-based (flammable, wet, conductive, ...) and go through the single
stimulus API; never script one thing reacting to another by name. Register new sim components lazily,
so a world without the feature hashes exactly as before and existing goldens do not move.

### Coverage and exclusions

Layer thresholds and the ratchet are in [contract §3](docs/backlog-contract.md#3-test--coverage-policy),
with the per-layer numbers in `coverage-layers.json`. Never lower coverage. The only place a file may be
excluded from unit coverage is [`coverage-exclusions.md`](coverage-exclusions.md). To request an
exclusion, add a row in the same PR as the code with the path glob, the reason, the justifying bead and
the alternative verification (a Playwright smoke, a perf budget). The reviewer approves the row, not just
the code. `pnpm coverage:exclusions` enforces the file. Do not use `v8 ignore` comments.

### Goldens and generated files

An intended sim or content change moves the golden replays. Re-record in this order and review the
diffs:

```bash
pnpm replay:rebless
TESTBED_PLAYER_RECORD=1 pnpm vitest run tests/integration/testbed-player.test.ts
pnpm slice:record
```

Run the slice playthrough (`pnpm slice:record`) even when you believe nothing moved; it is how an
unexpected hash change shows up. After a content schema change, run `pnpm content:schemas` and
`pnpm content:docs` and commit what they write. Save-schema changes need a versioned migration and a
round-trip test.

### End-to-end specs

- Give each new spec a measured weight in `e2e/shards.json` (`pnpm e2e:shards:regenerate`), so CI
  shards stay balanced.
- Run locally on a port other than 4173, 5173 or 5180 (`E2E_PORT=<port>`), which other sessions use.
- CI renders with software GL at about 1 fps and one `evaluate` can take 4 to 5 s. Pace a spec by
  published sim state with polls of roughly 30 s, not wall-clock sleeps. Do not add retry loops that hide
  failures.
- Do not add props to the shared testbed scene. Give a demo its own scene, or an off-by-default flag that
  is safe at `?scene=does-not-exist`.

### Assets

Consistency comes from the bibles: [`docs/art/style-bible.md`](docs/art/style-bible.md),
[`docs/audio/audio-bible.md`](docs/audio/audio-bible.md) and the canon in
[`docs/narrative/story-bible.md`](docs/narrative/story-bible.md). Every asset prompt starts from the
bible's preamble. The owner approves every asset (flat image, 3D turntable, music take, SFX batch) and CI
refuses final assets without an approval record. API keys come only from environment variables; never
commit or log them. The full workflow is [contract §6](docs/backlog-contract.md#6-asset-beads-art-music-sfx).

## Architecture decision records

A significant, hard-to-reverse choice gets an ADR in [`docs/adr/`](docs/adr/README.md): copy
`template.md` to the next free `NNNN-kebab-title.md`, lead with the decision, record the options and
evidence, add it to the index and link it from the bead in the same PR. Status is `Proposed` while the PR
is open and `Accepted` when the owner merges it. Never rewrite an accepted decision; write a new ADR that
supersedes it and update the contract row that states it. The process is in
[`docs/adr/README.md`](docs/adr/README.md).

## Checks on this guide

`scripts/docs-links.test.ts` fails the unit tests, and therefore the `coverage-gate` job on every PR, if
`CONTRIBUTING.md`, `README.md`, `AGENTS.md` or the ADR index has a relative link to a file that does not
exist. Add a doc to `CHECKED_DOCS` in `scripts/docs-links.ts` to cover it too.
