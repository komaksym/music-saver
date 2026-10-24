#!/usr/bin/env bash
# Shared launch policy for every agent-browser run in this repo. Sourced by
# scripts/e2e-agent-browser.sh and scripts/e2e-matrix.sh, which reach the
# browser only through ab and ab_ext. This file is the one place that spells
# the agent-browser launch flags, so login state never lands in a browser
# started with a different session, profile, or extension set.
# shellcheck shell=bash

ROOT="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
EXT="$ROOT/extension"
PROFILE="${SPOTIFY_E2E_PROFILE:-$ROOT/tests/e2e-profile}"
SECRETS="${SPOTIFY_E2E_SECRETS:-$ROOT/tests/e2e-auth-state}"
# shellcheck disable=SC2034 # consumed by the sourcing scripts
COOKIES_FILE="$SECRETS/cookies.json"
# shellcheck disable=SC2034 # consumed by the sourcing scripts
ART="${E2E_ARTIFACTS:-$ROOT/e2e-artifacts}"
SESSION="${E2E_SESSION:-}"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 2; }
}

# Resolve the session once, on first browser use. Resolving eagerly would
# spawn agent-browser before a script can fail closed on a missing profile.
harness_session() {
  if [ -z "$SESSION" ]; then
    SESSION="$(agent-browser session id --scope worktree --prefix ms-e2e)"
  fi
  printf '%s' "$SESSION"
}

# ab runs every browser command with identical launch flags.
ab() {
  agent-browser --session "$(harness_session)" --profile "$PROFILE" "$@"
}

# ab_ext adds the unpacked extension for scenarios that assert its behavior.
ab_ext() {
  ab --extension "$EXT" "$@"
}

close_quiet() {
  if [ -n "$SESSION" ]; then
    ab close >/dev/null 2>&1 || true
    sleep 1
  fi
}

wall_present() {
  grep -q 'button "Log in"' "$1"
}
