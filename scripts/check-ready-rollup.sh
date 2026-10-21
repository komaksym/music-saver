#!/usr/bin/env bash
# Roll up required check contexts for a PR head into the ready verdict.
# Passes only when every required context is green; polls while they run.
# A failed context waits until the timeout so a rerun can still turn it green.
# Usage: check-ready-rollup.sh HEAD_SHA [REPO] [TIMEOUT_SECONDS]
set -euo pipefail

HEAD_SHA="${1:?usage: check-ready-rollup.sh HEAD_SHA [REPO] [TIMEOUT_SECONDS]}"
REPO="${2:-komaksym/music-saver}"
TIMEOUT="${3:-720}"
REQUIRED="ci pr-title pr-hygiene commit-lint CodeRabbit"

deadline=$((SECONDS + TIMEOUT))
while true; do
  pending=()
  failed=()
  for ctx in $REQUIRED; do
    run=$(GH_HEAD="$HEAD_SHA" gh api "repos/$REPO/commits/$HEAD_SHA/check-runs?check_name=$ctx&per_page=50" --jq '[.check_runs[] | select(.head_sha == $ENV.GH_HEAD and .status == "completed")] | sort_by(.completed_at) | last | (.conclusion // "none")')
    if [ "$run" = "success" ]; then
      continue
    fi
    st=$(GH_CTX="$ctx" gh api "repos/$REPO/commits/$HEAD_SHA/status" --jq '[.statuses[] | select(.context == $ENV.GH_CTX)] | last | (.state // "none")')
    if [ "$run" = "none" ] && [ "$st" = "success" ]; then
      continue
    fi
    case "$run/$st" in
      failure/*|*/failure|*/error|cancelled/*|timed_out/*|action_required/*)
        failed+=("$ctx")
        ;;
      *)
        pending+=("$ctx")
        ;;
    esac
  done
  if [ "${#failed[@]}" -eq 0 ] && [ "${#pending[@]}" -eq 0 ]; then
    echo "ready: all required contexts green ($REQUIRED)"
    exit 0
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    [ "${#failed[@]}" -gt 0 ] && echo "ready: FAILED contexts: ${failed[*]}" >&2
    [ "${#pending[@]}" -gt 0 ] && echo "ready: PENDING contexts at timeout: ${pending[*]}" >&2
    exit 1
  fi
  sleep 20
done
