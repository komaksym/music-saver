#!/usr/bin/env bash
# Single implementation of the five-heading PR body check (ground truth: PR #8).
# Reads the PR body from $BODY when set, otherwise from stdin.
# Exits 0 when all five house headings are present, 1 otherwise.
set -euo pipefail

if [ -n "${BODY:-}" ]; then
  input=$(printf '%s' "$BODY")
else
  input=$(cat)
fi

echo Checking PR body for required headings...
# Strip fenced code blocks. A fence opened with N backticks or tildes
# closes only on a run of at least N of the same character, so a
# four-backtick fence does not swallow the headings that follow it
# and tilde-fenced blocks do not leak fake headings.
text=$(printf '%s' "$input" | awk '
  {
    line = $0
    sub(/^[[:space:]]+/, "", line)
    n = 0
    c = substr(line, 1, 1)
    if (c == "`" || c == "~") {
      while (substr(line, n + 1, 1) == c) n++
    }
    if (open == 0) {
      if (n >= 3) { open = n; fence = c; next }
      print
      next
    }
    if (c == fence && n >= open && substr(line, n + 1) ~ /^[[:space:]]*$/) open = 0
  }
')
missing=0
for h in '## Summary' '## Validation' '## Risks / Notes' '## Breaking changes' '## Visual summary'; do
  if ! printf '%s' "$text" | grep -Fqx -- "$h"; then
    echo "::error::Missing required heading: $h"
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "PR body must contain the five house headings."
  exit 1
fi
echo All required headings present.

