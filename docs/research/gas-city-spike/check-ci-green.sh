#!/usr/bin/env bash
# 0 = all green, 75 = still pending (free retry), 1 = a check failed.
out=$(gh pr checks "${VESPER_PR:?}" --json bucket -q '.[].bucket') || exit 75
echo "$out" | grep -q fail && { echo "a check failed"; exit 1; }
echo "$out" | grep -Eq 'pending' && exit 75
exit 0
