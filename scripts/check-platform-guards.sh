#!/usr/bin/env bash
# Shared platform-guard entry point: one source of truth for local and remote.
# Local pre-push/PR creation calls it for fail-fast feedback; CI calls the
# same file for enforcement. Silent on pass with --quiet (hook mode).
# Usage: check-platform-guards.sh [--base BASE] [--body-file PATH] [--branch NAME] [--skip-merge-check] [--quiet]
set -euo pipefail

BASE="origin/main"
BODY_FILE=""
BRANCH=""
SKIP_MERGE=0
QUIET=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2;;
    --body-file) BODY_FILE="$2"; shift 2;;
    --branch) BRANCH="$2"; shift 2;;
    --skip-merge-check) SKIP_MERGE=1; shift;;
    --quiet) QUIET=1; shift;;
    *) echo "platform-guards: unknown flag: $1" >&2; exit 2;;
  esac
done

if [ -z "$BRANCH" ]; then
  BRANCH="$(git branch --show-current 2>/dev/null || true)"
fi

if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "platform-guards: refusing direct work on '$BRANCH'; use a feature branch and open a PR" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARGS=(--base "$BASE")
if [ "$SKIP_MERGE" -eq 1 ]; then
  ARGS+=(--skip-merge-check)
fi
if [ -n "$BODY_FILE" ]; then
  ARGS+=(--body-file "$BODY_FILE")
fi

if [ "$QUIET" -eq 1 ]; then
  if ! OUT="$(bash "$SCRIPT_DIR/check-pr-ready.sh" "${ARGS[@]}" 2>&1)"; then
    echo "$OUT" >&2
    exit 1
  fi
  exit 0
fi

bash "$SCRIPT_DIR/check-pr-ready.sh" "${ARGS[@]}"
