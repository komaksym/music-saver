#!/usr/bin/env bash
# Open a GitHub PR through the validated path: the one supported way to
# create a PR in this repo. It runs the readiness gate before gh runs.
# Usage: scripts/pr-create.sh --title TITLE --body-file PATH [--base BASE] [--dry-run]
set -euo pipefail
TITLE=""
BODY_FILE=""
BASE="origin/main"
DRY_RUN=0
while [ "$#" -gt 0 ]; do
case "$1" in
--title) TITLE="$2"; shift 2;;
--body-file) BODY_FILE="$2"; shift 2;;
--base) BASE="$2"; shift 2;;
--dry-run) DRY_RUN=1; shift;;
--help) sed -n 2,5p "$0"; exit 0;;
*) echo "pr-create: unknown flag: $1 (see --help)" >&2; exit 2;;
esac
done
if [ -z "$TITLE" ]; then
echo "pr-create: missing --title; pass a Conventional Commits title" >&2; exit 2
fi
if [ -z "$BODY_FILE" ]; then
echo "pr-create: missing --body-file; write the body from .github/pull_request_template.md first" >&2; exit 2
fi
bash scripts/check-platform-guards.sh --base "$BASE" --body-file "$BODY_FILE" --branch "$(git branch --show-current 2>/dev/null || true)"
if [ "$DRY_RUN" -eq 1 ]; then
echo "pr-create: dry run ok; body is ready to open as: $TITLE"
exit 0
fi
gh pr create --title "$TITLE" --body-file "$BODY_FILE"
