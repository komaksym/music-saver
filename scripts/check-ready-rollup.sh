#!/usr/bin/env bash
# Roll up required workflow check contexts for a PR head into the ready verdict.
# CodeRabbit is a ruleset-enforced commit status and stays out of this rollup because
# its review can land after the job budget. Passes when every listed context is green.
# A failed context waits until the timeout so a rerun can still turn it green.
# Each context reads only pull-request runs for this PR on this head, newest run and
# attempt first, then that attempt's named check. A newer push run on the same head
# therefore neither satisfies nor rejects the pull-request result.
# Usage: check-ready-rollup.sh HEAD_SHA [REPO] [TIMEOUT_SECONDS] [PR_NUMBER]
set -euo pipefail

HEAD_SHA="${1:?usage: check-ready-rollup.sh HEAD_SHA [REPO] [TIMEOUT_SECONDS] [PR_NUMBER]}"
REPO="${2:-komaksym/music-saver}"
TIMEOUT="${3:-720}"
PR="${4:-${PR_NUMBER:-}}"
if ! printf '%s' "$PR" | grep -Eq '^[1-9][0-9]*$'; then
  echo "usage: PR_NUMBER must be a positive pull request number, as the fourth argument or in the environment" >&2
  exit 2
fi
# context:workflow path, matching the candidate manifest check set.
REQUIRED="ci:.github/workflows/ci.yml pr-title:.github/workflows/pr-title.yml pr-hygiene:.github/workflows/pr-hygiene.yml commit-lint:.github/workflows/commit-lint.yml smoke:.github/workflows/e2e-smoke.yml"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
runs="$work/runs.json"
checks="$work/checks.json"
statuses="$work/statuses.json"

deadline=$((SECONDS + TIMEOUT))
while true; do
  gh api --paginate --slurp "repos/$REPO/actions/runs?head_sha=$HEAD_SHA&per_page=100" > "$runs"
  gh api --paginate --slurp "repos/$REPO/commits/$HEAD_SHA/check-runs?per_page=100" > "$checks"
  gh api --paginate --slurp "repos/$REPO/commits/$HEAD_SHA/statuses?per_page=100" > "$statuses"
  pending=()
  failed=()
  for entry in $REQUIRED; do
    ctx="${entry%%:*}"
    path="${entry#*:}"
    run=$(jq -rs --arg ctx "$ctx" --arg path "$path" --arg sha "$HEAD_SHA" --arg repo "$REPO" --argjson pr "$PR" '
      ([.[0][] | .workflow_runs[]?
        | select(.path == $path and .head_sha == $sha and .repository.full_name == $repo)
        | select(.event == "pull_request" or .event == "pull_request_review")
        | select([.pull_requests[]?.number] | index($pr))
      ] | sort_by([.id, (.run_attempt // 1)]) | last) as $run
      | if $run == null then "none"
        elif $run.status != "completed" then "pending"
        elif $run.conclusion != "success" then ($run.conclusion // "none")
        else
          ([.[1][] | .check_runs[]?
            | select(.name == $ctx and .head_sha == $sha and .check_suite.id == $run.check_suite_id)
          ] | sort_by(.id) | last) as $check
          | if $check == null or $check.status != "completed" then "pending"
            else ($check.conclusion // "none") end
        end
    ' "$runs" "$checks")
    if [ "$run" = "success" ]; then
      continue
    fi
    st=$(jq -rs --arg ctx "$ctx" '[.[0][][] | select(.context == $ctx)] | sort_by(.id) | last | (.state // "none")' "$statuses")
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
    echo "ready: all listed workflow contexts green ($REQUIRED)"
    exit 0
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    [ "${#failed[@]}" -gt 0 ] && echo "ready: FAILED contexts: ${failed[*]}" >&2
    [ "${#pending[@]}" -gt 0 ] && echo "ready: PENDING contexts at timeout: ${pending[*]}" >&2
    exit 1
  fi
  sleep 20
done
