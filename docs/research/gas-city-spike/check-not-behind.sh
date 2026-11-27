#!/usr/bin/env bash
# exit 0 only when the PR is not BEHIND/DIRTY. VESPER_PR set by the formula runner.
s=$(gh pr view "${VESPER_PR:?}" --json mergeStateStatus -q .mergeStateStatus) || exit 75
[ "$s" != BEHIND ] && [ "$s" != DIRTY ] || { echo "mergeStateStatus=$s"; exit 1; }
