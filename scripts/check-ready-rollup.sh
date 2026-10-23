#!/usr/bin/env bash
# Roll up required workflow check contexts for a PR head into the ready verdict.
# The required set mirrors the "main requires verified CI" ruleset (ten
# contexts). Ready must not invent the set, so every ruleset context is listed
# here, including ready itself.
# Passes when every listed context is green. skipped, neutral, and stale count
# as failures, never as pending: a context that did not really pass must block
# instead of waiting out the timeout.
# The self context (ready) counts only completed runs: the running job is its
# own pending run and must not deadlock itself. A completed non-success still
# blocks. A failed context waits until the timeout so a rerun can still turn
# it green.
# Usage: check-ready-rollup.sh HEAD_SHA [REPO] [TIMEOUT_SECONDS]
set -euo pipefail

HEAD_SHA="${1:?usage: check-ready-rollup.sh HEAD_SHA [REPO] [TIMEOUT_SECONDS]}"
REPO="${2:-komaksym/music-saver}"
TIMEOUT="${3:-720}"
REQUIRED=(
  ci
  pr-title
  ready
  pr-hygiene
  commit-lint
  cubic-gate
  actionlint
  trufflehog
  zizmor
  "cubic · AI code reviewer"
)

deadline=$((SECONDS + TIMEOUT))
while true; do
  # One page of check runs for this commit; names match in jq so Unicode
  # contexts stay exact with no URL encoding and no shell-side decoding.
  runs=$(GH_HEAD="$HEAD_SHA" gh api "repos/$REPO/commits/$HEAD_SHA/check-runs?per_page=100" --jq '[.check_runs[] | select(.head_sha == $ENV.GH_HEAD)]')
  pending=()
  failed=()
  for ctx in "${REQUIRED[@]}"; do
    # Newest run for this head wins, even when it is still running: an older
    # success must not mask a rerun that has not finished.
    run=$(printf '%s' "$runs" | GH_CTX="$ctx" jq -r 'map(select(.name == $ENV.GH_CTX)) | sort_by(.id) | last | if . == null then "none" elif .status != "completed" then "pending" else (.conclusion // "none") end')
    if [ "$run" = "success" ]; then
      continue
    fi
    if [ "$ctx" = "ready" ]; then
      # Self verdict: this running job is the pending run, so only a
      # completed non-success blocks. No completed runs yet means this job
      # is the verdict.
      if [ "$run" = "pending" ] || [ "$run" = "none" ]; then
        continue
      fi
      failed+=("$ctx")
      continue
    fi
    st=$(GH_CTX="$ctx" gh api "repos/$REPO/commits/$HEAD_SHA/status" --jq '[.statuses[] | select(.context == $ENV.GH_CTX)] | last | (.state // "none")')
    if [ "$run" = "none" ] && [ "$st" = "success" ]; then
      continue
    fi
    case "$run/$st" in
      failure/*|*/failure|*/error|cancelled/*|timed_out/*|action_required/*|skipped/*|*/skipped|neutral/*|*/neutral|stale/*|*/stale)
        failed+=("$ctx")
        ;;
      *)
        pending+=("$ctx")
        ;;
    esac
  done
  if [ "${#failed[@]}" -eq 0 ] && [ "${#pending[@]}" -eq 0 ]; then
    echo "ready: all listed workflow contexts green (${REQUIRED[*]})"
    exit 0
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    [ "${#failed[@]}" -gt 0 ] && echo "ready: FAILED contexts: ${failed[*]}" >&2
    [ "${#pending[@]}" -gt 0 ] && echo "ready: PENDING contexts at timeout: ${pending[*]}" >&2
    exit 1
  fi
  sleep 20
done
