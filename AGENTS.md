# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd prime` for full workflow context.

The full contributor workflow (worktrees, sign-off, PR rules, gates, ADRs) is in [`CONTRIBUTING.md`](CONTRIBUTING.md).

> **Architecture in one line:** Issues live in a local Dolt database
> (`.beads/dolt/`); cross-machine sync uses `bd dolt push/pull` (a
> git-compatible protocol), stored under `refs/dolt/data` on your git
> remote — separate from `refs/heads/*` where your code lives.
> `.beads/issues.jsonl` is a passive export, not the wire protocol.
>
> See [sync-concepts](https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md)
> for the one-screen overview and anti-patterns (don't treat JSONL as the
> source of truth; don't `bd import` during normal operation; don't
> reach for third-party Dolt hosting before trying the default).

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
bd dolt push          # Push beads data to remote
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:46cd31e7 -->
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
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
