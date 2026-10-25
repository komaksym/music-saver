#!/usr/bin/env bash
# Shared launch policy for the manual agent-browser harness. The canonical
# fixture and live suites launch through scripts/spotify-e2e.mjs instead.
# scripts/e2e-agent-browser.sh reaches the browser only through ab and ab_ext.
# This file is the one place that spells the launch flags, so login state never
# lands in a browser started with a different session, profile, or extension
# set.
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

# ab runs every browser command with identical launch flags.
ab() {
  # Resolve the session once, in this shell, on first browser use. A command
  # substitution would discard the assignment, leaving cleanup without a
  # session to close. Resolving lazily still lets a script fail closed on a
  # missing profile or binary before the browser starts.
  if [ -z "$SESSION" ]; then
    local resolved
    if ! resolved="$(agent-browser session id --scope worktree --prefix ms-e2e)"; then
      printf '%s\n' "could not resolve an agent-browser session" >&2
      return 2
    fi
    if [ -z "$resolved" ]; then
      printf '%s\n' "agent-browser returned an empty session id" >&2
      return 2
    fi
    SESSION="$resolved"
  fi
  agent-browser --session "$SESSION" --profile "$PROFILE" "$@"
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
