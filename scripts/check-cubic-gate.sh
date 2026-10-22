#!/usr/bin/env bash
#
# cubic-gate: block merge while open Cubic P0/P1 threads exist on this head.
#
# Usage:
#   check-cubic-gate.sh HEAD_SHA PR_NUMBER [REPO] [TIMEOUT_SECONDS]
#
# Inputs (environment):
#   GH_TOKEN          token used by `gh` (the default github.token in Actions).
#   BLOCK_PRIORITIES  whitespace-separated blocking priorities, e.g. "P0 P1".
#                     This is the ONLY gate threshold; cubic.yaml tunes review
#                     behavior and never the gate. Default: "P0 P1".
#   RUN_STARTED_AT    ISO-8601 timestamp of the triggering event
#                     (pull_request.updated_at). Only Cubic signals at or
#                     after this count as a fresh response, so a same-SHA
#                     `edited` re-run cannot read a stale pre-edit CLEAR.
#                     Blockers ignore it: every current unresolved thread
#                     is evaluated. Empty (local runs, or events without
#                     the timestamp) disables the freshness guard.
#
# Model (see synthesis.md):
#   GateVerdict = CLEAR | BLOCKED(blockers) | PENDING(reason) | TIMEOUT(lastError).
#   The poll loop derives the verdict fresh every tick; no latched state.
#   A thread blocks iff: author is exactly cubic-dev-ai (GraphQL strips
#   the [bot] suffix) or cubic-dev-ai[bot] (REST), unresolved, NOT
#   outdated (forge-computed freshness on the head diff, never a
#   hand-rolled SHA comparison), and priority is in BLOCK_PRIORITIES or
#   missing (unprioritized findings block, mirroring
#   allow_open_issues:none without duplicating the threshold into cubic.yaml).
#   CLEAR additionally requires a fresh Cubic signal (a thread or review
#   at or after RUN_STARTED_AT); without one the verdict stays PENDING.
#   Threads and reviews are each fully paginated before deriving the verdict.
#   Replies never clear: only isResolved (button or fix-commit auto-resolve).
#
# Exit codes (fail-closed):
#   0  CLEAR: Cubic spoke on this head and no blocking threads remain.
#   1  BLOCKED at timeout, no Cubic signal at timeout (silent), or the
#      GitHub API never yielded a verdict (auth/scope loss, GraphQL errors).
#
set -euo pipefail

HEAD_SHA="${1:?usage: check-cubic-gate.sh HEAD_SHA PR_NUMBER [REPO] [TIMEOUT_SECONDS]}"
PR_NUMBER="${2:?usage: check-cubic-gate.sh HEAD_SHA PR_NUMBER [REPO] [TIMEOUT_SECONDS]}"
REPO="${3:-komaksym/music-saver}"
TIMEOUT_SECONDS="${4:-720}"

BLOCK_PRIORITIES="${BLOCK_PRIORITIES:-P0 P1}"
RUN_STARTED_AT="${RUN_STARTED_AT:-}"
POLL_INTERVAL_SECONDS=20

case "${TIMEOUT_SECONDS}" in
  '' | *[!0-9]*)
    echo "cubic-gate: ERROR: TIMEOUT_SECONDS must be a non-negative integer, got '${TIMEOUT_SECONDS}'" >&2
    exit 1
    ;;
esac

command -v gh >/dev/null 2>&1 || { echo "cubic-gate: ERROR: gh CLI is required" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "cubic-gate: ERROR: jq is required" >&2; exit 1; }

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
ERR_FILE="$WORK_DIR/gh.err"
PAGE_FILE="$WORK_DIR/page.json"
THREADS_FILE="$WORK_DIR/threads.json"
REVIEWS_FILE="$WORK_DIR/reviews.json"

log() { printf 'cubic-gate: %s\n' "$*"; }

THREADS_QUERY='query CubicGateThreads($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line
          comments(first: 1) { nodes { author { login } body createdAt } }
        }
      }
    }
  }
}'

REVIEWS_QUERY='query CubicGateReviews($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviews(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { author { login } state submittedAt }
      }
    }
  }
}'

# Fetch one page of $1 (GraphQL query). $2 = cursor (empty for first page).
gh_page() {
  local query="$1" cursor="$2"
  local owner="${REPO%%/*}" name="${REPO#*/}"
  if [ -n "$cursor" ]; then
    gh api graphql -F owner="$owner" -F name="$name" -F number="$PR_NUMBER" \
      -F cursor="$cursor" -f query="$query" 2>"$ERR_FILE"
  else
    gh api graphql -F owner="$owner" -F name="$name" -F number="$PR_NUMBER" \
      -f query="$query" 2>"$ERR_FILE"
  fi
}

# Derive the GateVerdict from $THREADS_FILE / $REVIEWS_FILE; prints verdict JSON.
derive_verdict() {
  jq -n \
    --arg block "$BLOCK_PRIORITIES" \
    --arg run_started "$RUN_STARTED_AT" \
    --slurpfile threads "$THREADS_FILE" \
    --slurpfile reviews "$REVIEWS_FILE" \
    '
    ($block | split(" ") | map(select(length > 0))) as $prios
    | (if ($run_started | length) > 0 then $run_started else null end) as $rs
    | def is_cubic_author: (.login // "") == "cubic-dev-ai"
        or ((.login // "") == "cubic-dev-ai[bot]");
    (($threads[0] // []) | map(
        .comments.nodes[0] as $c
        | select($c != null)
        | select(($c.author // {}) | is_cubic_author)
        | { id: .id, path: (.path // "?"), line: (.line // "?"),
            priority: (([(($c.body // "") | scan("P[0-3]"))][0]) // "none"),
            resolved: (.isResolved // false), outdated: (.isOutdated // false),
            created: ($c.createdAt // "") }
      )) as $cubic
    | ((($reviews[0] // []) | map(select((.author // {}) | is_cubic_author))) | map(.submittedAt // "")) as $review_times
    | (([$cubic[] | .created] + $review_times)
        | map(select($rs == null or . >= $rs))
        | length) as $fresh_count
    | (($cubic | map(
        select(.resolved == false and .outdated == false
               and (.priority as $p | $p == "none" or (($prios | index($p)) != null)))
      ))) as $blockers
    | { status: (if ($blockers | length) > 0 then "BLOCKED"
                 elif $fresh_count > 0 then "CLEAR"
                 else "PENDING" end),
        cubic_threads: ($cubic | length),
        cubic_reviews: ((($reviews[0] // []) | map(select((.author // {}) | is_cubic_author))) | length),
        blockers: $blockers }
    '
}

blocker_summary() {
  printf '%s' "$VERDICT_JSON" | jq -r '[.blockers[] | "\(.id) (\(.priority), \(.path):\(.line))"] | join("; ")'
}

# Fetch every page of one PR connection into $3 as a JSON array. $1 = query,
# $2 = connection field name. On failure sets LAST_ERROR and returns 1.
fetch_connection() {
  local query="$1" connection="$2" out_file="$3"
  local cursor="" page pr_json has_next
  if ! printf '[]\n' >"$out_file"; then
    LAST_ERROR="failed to initialize connection file"
    return 1
  fi
  while :; do
    : >"$ERR_FILE"
    if ! page="$(gh_page "$query" "$cursor")"; then
      LAST_ERROR="$(cat "$ERR_FILE" 2>/dev/null || echo 'gh exited non-zero')"
      return 1
    fi
    if ! pr_json="$(printf '%s' "$page" | jq '.data.repository.pullRequest')"; then
      LAST_ERROR="unparseable GraphQL response"
      return 1
    fi
    if [ "$pr_json" = "null" ]; then
      LAST_ERROR="$(printf '%s' "$page" | jq -c '.errors // "pull request not found in response"')"
      return 1
    fi
    if ! printf '%s' "$pr_json" | jq --arg c "$connection" '.[$c].nodes // []' >"$PAGE_FILE"; then
      LAST_ERROR="unparseable GraphQL response"
      return 1
    fi
    if ! jq -s 'add' "$out_file" "$PAGE_FILE" >"$WORK_DIR/merged.json" ||
      ! mv "$WORK_DIR/merged.json" "$out_file"; then
      LAST_ERROR="failed to merge connection pages"
      return 1
    fi
    if ! has_next="$(printf '%s' "$pr_json" | jq -r --arg c "$connection" '.[$c].pageInfo.hasNextPage // false')"; then
      LAST_ERROR="unparseable GraphQL response"
      return 1
    fi
    if [ "$has_next" != "true" ]; then
      break
    fi
    if ! cursor="$(printf '%s' "$pr_json" | jq -r --arg c "$connection" '.[$c].pageInfo.endCursor // empty')"; then
      LAST_ERROR="unparseable GraphQL response"
      return 1
    fi
    if [ -z "$cursor" ]; then
      LAST_ERROR="hasNextPage without endCursor"
      return 1
    fi
  done
  return 0
}

# One poll round. Sets STATUS, VERDICT_JSON, LAST_ERROR. Always returns 0.
poll_once() {
  if ! fetch_connection "$THREADS_QUERY" reviewThreads "$THREADS_FILE" ||
    ! fetch_connection "$REVIEWS_QUERY" reviews "$REVIEWS_FILE"; then
    STATUS="PENDING"
    return 0
  fi
  if ! VERDICT_JSON="$(derive_verdict)"; then
    LAST_ERROR="verdict computation failed"
    STATUS="PENDING"
    return 0
  fi
  STATUS="$(printf '%s' "$VERDICT_JSON" | jq -r '.status')"
  return 0
}

START=$SECONDS
DEADLINE=$((START + TIMEOUT_SECONDS))
STATUS="PENDING"
VERDICT_JSON=""
LAST_ERROR=""

poll_once
while [ "$STATUS" != "CLEAR" ] && [ "$SECONDS" -lt "$DEADLINE" ]; do
  ELAPSED=$((SECONDS - START))
  if [ "$STATUS" = "BLOCKED" ]; then
    BLOCKER_COUNT="$(printf '%s' "$VERDICT_JSON" | jq -r '.blockers | length')"
    log "BLOCKED by ${BLOCKER_COUNT} thread(s) on ${HEAD_SHA}: $(blocker_summary) - still polling (${ELAPSED}s elapsed)."
  elif [ -n "$LAST_ERROR" ]; then
    log "PENDING - last API error: ${LAST_ERROR} - retrying (${ELAPSED}s elapsed)."
  else
    log "PENDING - no Cubic signal yet for head ${HEAD_SHA} - retrying (${ELAPSED}s elapsed)."
  fi
  REMAINING=$((DEADLINE - SECONDS))
  if [ "$REMAINING" -gt "$POLL_INTERVAL_SECONDS" ]; then
    sleep "$POLL_INTERVAL_SECONDS"
  else
    sleep "$REMAINING"
  fi
  poll_once
done

ELAPSED=$((SECONDS - START))
if [ "$STATUS" = "CLEAR" ]; then
  CUBIC_THREADS="$(printf '%s' "$VERDICT_JSON" | jq -r '.cubic_threads')"
  CUBIC_REVIEWS="$(printf '%s' "$VERDICT_JSON" | jq -r '.cubic_reviews')"
  log "CLEAR - no unresolved Cubic (${BLOCK_PRIORITIES}) threads on ${HEAD_SHA} (${CUBIC_THREADS} cubic thread(s), ${CUBIC_REVIEWS} cubic review(s) seen)."
  exit 0
fi
if [ "$STATUS" = "BLOCKED" ]; then
  BLOCKER_COUNT="$(printf '%s' "$VERDICT_JSON" | jq -r '.blockers | length')"
  log "FAIL - ${BLOCKER_COUNT} blocking thread(s) still open on ${HEAD_SHA} after ${ELAPSED}s: $(blocker_summary)"
  exit 1
fi
if [ -n "$LAST_ERROR" ]; then
  log "FAIL - GitHub API never yielded a verdict for ${HEAD_SHA} after ${ELAPSED}s; last error: ${LAST_ERROR}"
else
  log "FAIL - no cubic signal for head ${HEAD_SHA} after ${ELAPSED}s (fail-closed)."
fi
exit 1
