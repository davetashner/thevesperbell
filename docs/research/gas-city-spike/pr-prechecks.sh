#!/usr/bin/env bash
# Mechanical "CI misses" gate for a Vesper worker branch (exec check, exit 0 = pass).
# Convention: the worker's worktree lives at <rig>/.claude/worktrees/gc/<name>, branch gc/<name>.
set -u
RIG="${VESPER_RIG:-$(cd "$(dirname "$0")/../../../rig" && pwd)}"  # check scripts get a scrubbed env: derive, do not require
PRETTIER="${VESPER_PRETTIER:-/Users/dave/Development/thevesperbell/node_modules/.bin/prettier}"
WT=$(ls -dt "$RIG"/.claude/worktrees/gc/*/ 2>/dev/null | head -1)
[ -n "$WT" ] || { echo "no worker worktree under $RIG/.claude/worktrees/gc/" >&2; exit 1; }
cd "$WT" || exit 1
git fetch -q origin main || exit 75   # infra outcome: not a verdict
fail=0
base=$(git merge-base HEAD origin/main)
n=$(git rev-list --count "$base"..HEAD)
[ "$n" -ge 1 ] || { echo "FAIL: no commits ahead of origin/main"; exit 1; }
for c in $(git rev-list "$base"..HEAD); do
  git show -s --format=%B "$c" | grep -q '^Signed-off-by: ' || { echo "FAIL: commit $c lacks Signed-off-by (use git commit -s)"; fail=1; }
done
files=$(git diff --name-only "$base"..HEAD)
echo "$files" | grep -q '^\.beads/' && { echo "FAIL: workers must not touch .beads/"; fail=1; }
if echo "$files" | grep -Eq '^(src/(game|ui|render|audio|sim|content)/|src/main\.ts|index\.html|site/)'; then
  echo "$files" | grep -q '^CHANGELOG.md$' || { echo "FAIL: player-facing paths changed but CHANGELOG.md has no Unreleased line (or PR needs no-changelog label)"; fail=1; }
fi
md=$(echo "$files" | grep -E '\.(md|ts|json|ya?ml)$' || true)
if [ -n "$md" ] && [ -x "$PRETTIER" ]; then
  # shellcheck disable=SC2086
  "$PRETTIER" --check $md >/dev/null 2>&1 || { echo "FAIL: prettier --check failed; run prettier --write on:"; echo "$md"; fail=1; }
fi
[ "$fail" -eq 0 ] && echo "prechecks passed ($n commit(s), $(echo "$files" | wc -l | tr -d ' ') file(s))"
exit $fail
