#!/usr/bin/env bash
# Fail a PR that would conflict on merge or ships a thin body.
# Usage: check-pr-ready.sh --base origin/main [--body-file PATH] [--skip-merge-check]
set -euo pipefail

BASE="origin/main"
BODY_FILE=""
SKIP_MERGE=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2;;
    --body-file) BODY_FILE="$2"; shift 2;;
    --skip-merge-check) SKIP_MERGE=1; shift;;
    *) echo "unknown flag: $1" >&2; exit 2;;
  esac
done

FAIL=0

if [ "$SKIP_MERGE" -eq 0 ]; then
  MB=$(git merge-base HEAD "$BASE")
  if git merge-tree "$MB" HEAD "$BASE" | grep -q '^+<<<<<<< '; then
    echo "pr-ready: CONFLICT with $BASE; rebase or merge it first" >&2
    FAIL=1
  else
    echo "pr-ready: merge against $BASE is clean"
  fi
fi

if [ -n "$BODY_FILE" ]; then
  if ! python3 - "$BODY_FILE" <<'PYEOF'
import re
import sys

path = sys.argv[1]
raw = open(path, encoding="utf-8").read()
errs = []
FIX_TMPL = "use .github/pull_request_template.md or run scripts/pr-create.sh --help"

if len(raw) < 300:
    errs.append(
        f"pr-ready: body too short ({len(raw)} chars, need 300); "
        f"expand every template section ({FIX_TMPL})"
    )

HEADS = ["## Summary", "## Validation", "## Risks / Notes", "## Breaking changes", "## Visual summary"]
pos = {}
for h in HEADS:
    m = re.search(r"(?m)^" + re.escape(h) + r"[ \t]*$", raw)
    if not m:
        errs.append(f"pr-ready: body misses section: {h} ({FIX_TMPL})")
    else:
        pos[h] = m.end()

if len(pos) == len(HEADS):
    order = [pos[h] for h in HEADS]
    if order != sorted(order):
        errs.append(
            "pr-ready: sections out of order; keep template order "
            "Summary, Validation, Risks / Notes, Breaking changes, Visual summary "
            f"({FIX_TMPL})"
        )
    spans = {}
    starts = sorted(pos.values())
    for h in HEADS:
        s = pos[h]
        later = [x for x in starts if x > s]
        e = min(later) if later else len(raw)
        spans[h] = raw[s:e]

    def substance(sec: str) -> str:
        sec = re.sub(r"<!--[\s\S]*?-->", " ", sec)
        return re.sub(r"\s+", " ", sec).strip()

    MINIMA = {
        "## Summary": 40,
        "## Validation": 40,
        "## Risks / Notes": 4,
        "## Breaking changes": 4,
        "## Visual summary": 4,
    }
    for h, need in MINIMA.items():
        got = len(substance(spans[h]))
        if got < need:
            errs.append(
                f"pr-ready: section '{h}' too thin ({got} chars, need {need}); "
                f"write at least one full sentence ({FIX_TMPL})"
            )

    imgs = re.findall(r"!\[[^\]]*\]\(([^)]*)\)", spans["## Visual summary"])
    PLACEHOLDERS = ("paste-image-url-here", "example.test", "placeholder")
    real = [u for u in imgs if u.strip() and not any(p in u for p in PLACEHOLDERS)]
    html_pages = [u for u in real
                  if "github.com/" in u and "/blob/" in u and "raw=true" not in u]
    if html_pages:
        errs.append(
            "pr-ready: Visual summary image URL serves an HTML page, not image bytes; "
            "use a raw.githubusercontent.com URL or append ?raw=true "
            f"({FIX_TMPL})"
        )
    if not real:
        errs.append(
            "pr-ready: Visual summary section has no real infographic image; "
            "generate one with the baoyu-infographic skill, commit it under "
            ".codex-pr-infographics/, and link it in the Visual summary section"
        )

if errs:
    for e in errs:
        print(e, file=sys.stderr)
    sys.exit(1)
print(f"pr-ready: body ok ({len(raw)} chars, 5/5 sections, infographic present)")
PYEOF
  then
    FAIL=1
  fi
fi

exit "$FAIL"
