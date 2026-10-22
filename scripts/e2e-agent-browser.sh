#!/usr/bin/env bash
# Agent-browser E2E for music-saver. This is the one supported browser harness.
# Never add Playwright, Puppeteer, Selenium, or Cypress; the guard
# scripts/check-browser-stack.sh fails the build when they appear.
set -euo pipefail
ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
EXT="$ROOT/extension"
PROFILE="${SPOTIFY_E2E_PROFILE:-$ROOT/tests/e2e-profile}"
SECRETS="${SPOTIFY_E2E_SECRETS:-$ROOT/tests/e2e-auth-state}"
COOKIES_FILE="$SECRETS/cookies.json"
ART="${E2E_ARTIFACTS:-$ROOT/e2e-artifacts}"
SESSION="${E2E_SESSION:-$(agent-browser session id --scope worktree --prefix ms-e2e)}"
RAW_OPEN=""
RAW_ACCOUNTS=""
need() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 2; }
}
# ab runs every browser command with identical launch flags, so login state
# is never stranded in a differently launched browser. No direct
# agent-browser calls outside this wrapper.
ab() {
  agent-browser --session "$SESSION" --profile "$PROFILE" "$@"
}
ab_ext() {
  ab --extension "$EXT" "$@"
}
close_quiet() {
  ab close >/dev/null 2>&1 || true
}
cleanup() {
  [ -z "$RAW_OPEN" ] || rm -f "$RAW_OPEN"
  [ -z "$RAW_ACCOUNTS" ] || rm -f "$RAW_ACCOUNTS"
  close_quiet
}
trap cleanup EXIT
wall_present() {
  grep -q 'button "Log in"' "$1"
}
cmd_auth() {
  need agent-browser
  need node
  mkdir -p "$SECRETS" "$PROFILE" "$ART"
  ab_ext --headed open "https://open.spotify.com/"
  printf '%s\n' "A Chrome-for-Testing window opened. Log in there as the dedicated agent Spotify account, then press Enter here."
  read -r _
  ab_ext wait --text "Spotify"
  ab_ext snapshot -i > "$ART/auth-snapshot.txt"
  if wall_present "$ART/auth-snapshot.txt"; then
    printf '%s\n' "login wall still present; login did not complete" >&2
    exit 4
  fi
  cmd_cookies_export
  printf '%s\n' "login saved in $PROFILE; cookies exported to $COOKIES_FILE; base64 it into the SPOTIFY_E2E_COOKIES_B64 secret."
}
cmd_cookies_export() {
  need agent-browser
  need node
  mkdir -p "$SECRETS" "$PROFILE"
  RAW_OPEN="$(mktemp "$SECRETS/cookies-open.XXXXXX")"
  RAW_ACCOUNTS="$(mktemp "$SECRETS/cookies-accounts.XXXXXX")"
  ab open "https://open.spotify.com/"
  ab wait --text "Spotify"
  ab --json cookies > "$RAW_OPEN"
  ab open "https://accounts.spotify.com/"
  ab wait --load domcontentloaded
  ab --json cookies > "$RAW_ACCOUNTS"
  node "$ROOT/scripts/e2e-cookies.mjs" merge "$RAW_OPEN" "$RAW_ACCOUNTS" "$COOKIES_FILE"
  rm -f "$RAW_OPEN" "$RAW_ACCOUNTS"
  RAW_OPEN=""
  RAW_ACCOUNTS=""
  printf '%s\n' "exported $COOKIES_FILE"
}
cmd_cookies_restore() {
  need agent-browser
  need node
  if [ ! -f "$COOKIES_FILE" ]; then
    printf '%s\n' "no cookies at $COOKIES_FILE; run auth once first" >&2
    exit 3
  fi
  mkdir -p "$PROFILE"
  SESSION="$SESSION" PROFILE="$PROFILE" node "$ROOT/scripts/e2e-cookies.mjs" restore "$COOKIES_FILE"
}
cmd_smoke() {
  need agent-browser
  mkdir -p "$ART"
  ab open "https://example.com"
  ab wait --text "documentation"
  ab snapshot -i | tee "$ART/smoke-snapshot.txt"
  ab screenshot "$ART/smoke.png"
  printf '%s\n' "smoke artifacts in $ART"
}
cmd_player() {
  need agent-browser
  mkdir -p "$ART" "$PROFILE"
  if [ ! -d "$PROFILE/Default" ]; then
    printf '%s\n' "no login profile at $PROFILE; run auth once first" >&2
    exit 3
  fi
  ab_ext open "https://open.spotify.com/"
  ab_ext wait --text "Spotify"
  ab_ext snapshot -i | tee "$ART/player-snapshot.txt"
  if wall_present "$ART/player-snapshot.txt"; then
    printf '%s\n' "login wall present; login expired, re-run auth" >&2
    exit 4
  fi
  ab_ext screenshot "$ART/player.png"
  printf '%s\n' "player artifacts in $ART"
}
case "${1:-smoke}" in
  auth) cmd_auth ;;
  cookies-export) cmd_cookies_export ;;
  cookies-restore) cmd_cookies_restore ;;
  smoke) cmd_smoke ;;
  player) cmd_player ;;
  *) printf '%s\n' "usage: auth, cookies-export, cookies-restore, smoke, or player" >&2; exit 2 ;;
esac
