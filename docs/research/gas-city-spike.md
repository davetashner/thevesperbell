# Gas City spike (mw-e41.28)

Date: 2026-11-27. Gas City 1.5.1 (Homebrew bottle), bd 1.3.4, Claude Code 2.1.332. Run on the owner's laptop in day mode, one coding agent at a time.

Verdict: **partial, and not yet.** Gas City ran one real bead to an open PR (#519) with no merge, no push to main and no live-DB writes. It does not touch the real bottleneck (serial update-branch plus a full CI run per PR), it cost roughly 5x a single subagent worker for a docs bead, and it needed three config fixes. Revisit only if we want unattended overnight dispatch.

## What was run

- A scratch city outside the repo, with its own Dolt bead store (prefix `gc`), and a rig that is a sparse clone of the repo **without** `.beads/`, so Gas City never saw the live Dolt DB. Nothing was pointed at `.beads/`, `refs/dolt/data` or `bd sync`.
- Formula `vesper-worker` (v2): `prepare` (worktree) -> `implement` (with an exec `check` gate) -> `open-pr` -> `report`. Source in `docs/research/gas-city-spike/`.
- Target bead: **mw-e18.9** (treasure design guide, docs only). Result: **PR #519**, one DCO-signed commit, `no-changelog` label, `Closes mw-e18.9` on its own line, 104-line `docs/design/treasure.md`. Not merged; the bead is not closed. (The worker wrote the footer as a bare URL; I corrected it to the markdown link. It also added `no-changelog`, which a docs/design change does not strictly need.)
- Slung with: `gc sling vesper/claude vesper-worker --formula --var backlog_id=mw-e18.9 --var branch=treasure-guide --var owned_paths=docs/design/treasure.md --var task="$(cat task.txt)"`.
- Non-laptop runtimes were not tried (see below).

## Setup effort

- Install: `brew install gascity` took 6.6 s (bottle; `bd`, `dolt`, `tmux`, `jq` were already present, only `flock` was added).
- `gc init --template minimal --no-start` plus `gc rig add` took about 15 s.
- Total wall-clock from clone of the docs to a working first formula run: about 45 minutes, of which 20 were reading docs and 25 were tuning. The tuning was the real cost:
  1. `gc init` plus `gc start` **installs a launchd service** even when you run `gc supervisor run` yourself. Removed with `gc supervisor uninstall`.
  2. The default packs (`bd`, `core`) wake **Claude "dog" maintenance sessions** within seconds (`--dangerously-skip-permissions --effort max`) for Dolt health orders. I killed two, then skipped 12 orders and suspended `bd.dog`. Without this, "one coding agent at a time" is false.
  3. Exec check scripts run with a scrubbed environment. My script needed an env var and failed attempt 1 instantly, which cost a whole extra implement session. Gas City recorded the reason well (`gc.attempt_log`).
- `gc doctor` also wants `git config --global beads.role maintainer`. I did not change global git config.

## Cost per bead

Measured from Claude transcripts under `~/.claude/projects/*gc-rig` (5 sessions: prepare, implement x2, open-pr, report; `wake_mode = "fresh"` means each step is a cold session):

| | input | output | cache read | cache create |
|---|---|---|---|---|
| Worker sessions total | 234 | 99,420 | 9.97M | 330k |
| Stray dog sessions (killed) | 14 | 3,466 | 0.30M | 52k |

At Sonnet list prices that is on the order of $5-6 for one docs bead (my arithmetic; prices assumed, not billed). The cache-read volume is the cost driver: about 2M tokens per session, because every session re-reads the repo's CLAUDE.md, AGENTS.md and the Gas City skills and prompt. Gas City defaults to `--effort max`; I could not override it from `option_defaults`, so output is inflated versus our subagent workers.

Comparison: I have no measured number for a normal subagent worker on this bead. Our workers are one continuous session that does prepare, implement, PR and report in one context, so the same work would be one cold start instead of five, and one implement pass instead of two. Estimate: 3-5x cheaper per bead. Treat that as an estimate, not a measurement.

Wall-clock: sling to PR open was about 20 minutes, to formula close about 23 minutes, for a 104-line doc.

## Rule mapping

| CLAUDE.md rule | Gas City feature | Result |
|---|---|---|
| Pick ready bead, write brief | `gc sling <rig>/<agent> <formula> --var ...`; `task` var carries the bead text | Mapped, but the bead text must be copied in; the bd provider reads Gas City's own store, not ours |
| Worker uses a worktree | `prepare` step | Mapped (agent runs `git worktree add`) |
| Worker brief names owned files | formula var `owned_paths` | Mapped, advisory only (prompt, not enforced) |
| One worker at a time / day-mode cap | `[[patches.agent]] max_active_sessions = 1` | Mapped, after suspending the dog agents. No day/night switch; would need two city.toml variants |
| DCO sign-off, bead id in message, CHANGELOG-or-label, prettier, no `.beads/` edits | exec `check` step (`pr-prechecks.sh`), `max_attempts = 3` | **Mapped well.** This is the best feature: a deterministic gate that re-runs the agent with the failure text. Infra errors can exit 75 for a free retry |
| Open PR, `Closes` line, label, footer | `open-pr` step prose | Mapped as prose only; the worker got the footer wrong. Could be a check script |
| Workers never merge or close beads | prompt text only | **Not enforceable.** The agent runs with `--dangerously-skip-permissions` and the real `gh` token; nothing blocks `gh pr merge` or `git push origin main` except the prompt. Needs a wrapper or a restricted token |
| Review the diff before merge | review step run by another agent | Mapped in `vesper-lead-merge.toml` (design only), but it is agent judgement; nobody checks the reviewer |
| BEHIND check, update-branch | exec `check` on `mergeStateStatus` | Designed, not run. Check scripts cannot receive formula vars, so PR number would have to go via a file or env |
| Wait for CI, don't poll | exec `check` exiting 75 while pending (timeout up to 45m) | Designed, not run. Plausible, but it parks the control dispatcher, not an agent, which is good |
| Conflict resolution in shards.json, CHANGELOG, etc. | agent step with the rule in prose | Not tested |
| Squash merge, `bd close --reason`, beads export, handoff bead | none | **Not expressed on purpose** (owner/lead authority). `merge-and-close` is a human-gate step |
| New bead ids need a fresh export in the PR (pr-lint) | none | Not expressible: needs the live DB, which Gas City must not touch |
| HANDOFF bead and lead identity | none | Gas City has its own mail/mayor model; no equivalent of our single-lead rule |

## What still needed a lead or the owner

- Choosing the bead, copying its text into the formula call, and the real bead store (Gas City cannot read our Dolt DB safely).
- All merging, `bd close`, export, handoff updates.
- PR body polish (footer) and judging whether a label is right.
- Enforcing "never merge" (currently trust, not control).
- Day/night mode and laptop load: Gas City has no load awareness.

## Effect on CI and merge throughput

None positive. The bottleneck is serial merges: update-branch plus a 25-40 min CI run per PR. Gas City runs more work in parallel only at the worker end, which we already do. Its `check`/exit-75 gate could automate waiting for CI and re-running update-branch, which removes the lead's attention but not the wall-clock. PR #519 was already `BEHIND` main five minutes after opening, which is exactly the queue behaviour we have today. The real levers are in E41 (skip heavy jobs for docs-only PRs, mw-e41.4; a merge queue; fewer full-suite reruns), not an orchestrator.

## Non-laptop runtime

Not tried. Gas City supports `k8s`, `ssh:user@host` and `exec:<script>` runtimes (`[session] provider`). Needed from the owner: a remote host or cluster, an image or host with Node 24, pnpm, `gh`, `claude` and `bd` logged in, and a way to supply a scoped GitHub token and Anthropic credentials without writing them to config. The only kube context present is `kind-actuator-east` (a local kind cluster, not a non-laptop runtime, and not mine to use). I signed up for nothing.

## Risks found

- Default packs spawn LLM maintenance sessions and install a launchd service without asking.
- Agents run with permissions skipped and our real credentials.
- Max effort by default; five cold sessions per bead.
- Pre-1.x churn: the docs and the shipped pack disagree (`contract = "graph.v2"` vs `[requires]`, and `bead_id` is reserved).

## Recommendation: partial (defer)

Do not adopt as the orchestrator now. Keep the lead loop. Take two ideas that are cheap:

1. The **exec check gate** as a local `scripts/pr-prechecks.sh` (DCO, CHANGELOG-or-label, prettier, no `.beads/` edits, Closes line, footer), run by workers before they open a PR and by the lead in review. Delivers most of the "fix CI misses" value with no new runtime.
2. A CI or script version of the **lead gate** (not BEHIND, checks green) using `gh pr checks --watch`, which we already do.

Reconsider Gas City if (a) we want unattended overnight batches, (b) it gains per-step session reuse, an effort override and a permission allowlist, and (c) the merge queue problem is solved first.

## Next steps

1. Add `scripts/pr-prechecks.sh` (adapted from `gas-city-spike/pr-prechecks.sh`) and reference it from worker briefs. Bead to file.
2. Work E41 throughput: mw-e41.4 and a merge-queue or batch-merge design.
3. If revisiting Gas City: re-run with `wake_mode = "resume"`, one session for the whole formula, an effort override and a restricted `gh` token; compare cost with a measured subagent run on the same kind of bead.
4. Close the loop on PR #519 as a normal PR (the lead merges it after CI, or closes it).

## Reproduce

`brew install gascity`; `GC_HOME=<scratch> gc init <scratch>/city --template minimal --no-start`; copy `docs/research/gas-city-spike/` formulas into `city/formulas/` and scripts into `city/assets/scripts/`; merge `city.toml` blocks; clone the repo sparse (`!/.beads/`) and `gc rig add` it; `gc supervisor run`; `gc start`; sling as above. Stop with `gc stop`, `gc supervisor stop`, `gc supervisor uninstall`.
