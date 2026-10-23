#!/usr/bin/env bash
# Scenario matrix runner on the agent-browser harness. The first record is a
# real save scenario. The other records are retained as unproven cases.
set -euo pipefail
ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
MATRIX="$ROOT/scripts/e2e-matrix.json"
EXT="$ROOT/extension"
PROFILE="${SPOTIFY_E2E_PROFILE:-$ROOT/tests/e2e-profile}"
ART="${E2E_ARTIFACTS:-$ROOT/e2e-artifacts}"
SESSION="${E2E_SESSION:-}"

close_quiet() {
  if [ -n "$SESSION" ]; then
    agent-browser --session "$SESSION" close >/dev/null 2>&1 || true
    sleep 1
  fi
}
trap close_quiet EXIT

if [ ! -d "$PROFILE/Default" ]; then
  if [ "${E2E_REQUIRE_AUTH:-0}" = "1" ]; then
    echo "auth required but no login profile at $PROFILE" >&2
    exit 3
  fi
  echo "SKIP: no login profile at $PROFILE; run 'scripts/e2e-agent-browser.sh auth' once first"
  exit 0
fi
if [ ! -f "$MATRIX" ]; then
  echo "missing matrix $MATRIX" >&2
  exit 2
fi
SESSION="${SESSION:-$(agent-browser session id --scope worktree --prefix ms-e2e)}"

mkdir -p "$ART"
COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$MATRIX','utf8')).length)")
echo "matrix: $COUNT scenarios from $MATRIX"
node -e "const m=JSON.parse(require('fs').readFileSync('$MATRIX','utf8')); for (const s of m) { for (const k of ['track','startLiked','listenPlan','expectedDelta','cleanup','automation']) if (!(k in s)) { console.error('bad record: '+JSON.stringify(s)); process.exit(1); } } const runnable=m.find((s)=>s.automation==='scenario'); if (!runnable || !String(runnable.spotifyUri||'').startsWith('spotify:track:')) { console.error('matrix needs one automated track scenario'); process.exit(1); }"
echo "matrix records valid: one scenario is executable; the rest are marked unproven"

SCENARIO_NAME=$(node -e "const m=JSON.parse(require('fs').readFileSync('$MATRIX','utf8')); console.log(m.find((s)=>s.automation==='scenario').track)")
SCENARIO_URI=$(node -e "const m=JSON.parse(require('fs').readFileSync('$MATRIX','utf8')); console.log(m.find((s)=>s.automation==='scenario').spotifyUri)")
TRACK_URL="https://open.spotify.com/track/${SCENARIO_URI##*:}"

ab_ext() {
  agent-browser --session "$SESSION" --profile "$PROFILE" --extension "$EXT" "$@"
}

# Read Chrome's extension registry so the options page can set test settings.
EXT_ID=$(node - "$PROFILE" "$EXT" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [profile, extension] = process.argv.slice(2);
const target = fs.realpathSync(extension);
const files = [
  path.join(profile, "Default", "Secure Preferences"),
  path.join(profile, "Default", "Preferences"),
];

(async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    for (const file of files) {
      try {
        const prefs = JSON.parse(fs.readFileSync(file, "utf8"));
        for (const [id, value] of Object.entries(prefs.extensions?.settings || {})) {
          if (value.path && path.resolve(value.path) === target) {
            process.stdout.write(id);
            return;
          }
        }
      } catch (error) {
        // Chrome may be replacing the registry while it starts.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  process.exit(2);
})();
NODE
) || true
if [ -z "$EXT_ID" ]; then
  echo "could not find the loaded music-saver extension in $PROFILE" >&2
  exit 5
fi
OPTIONS="chrome-extension://$EXT_ID/options.html"

ab_ext open "https://open.spotify.com/"
ab_ext wait --text "Spotify"
ab_ext snapshot -i > "$ART/matrix-gate.txt"
if grep -q 'button "Log in"' "$ART/matrix-gate.txt"; then
  echo "login wall present; login expired, re-run 'scripts/e2e-agent-browser.sh auth'" >&2
  exit 4
fi
echo "matrix gate: logged in"

ab_ext open "$OPTIONS"
ab_ext wait --text "music-saver"
SETTINGS_RESULT=$(ab_ext eval --stdin <<'JS'
chrome.storage.local
  .set({ settings: { enabled: true, thresholdRatio: 0.01, minSoundedMs: 0 } })
  .then(() => chrome.storage.local.get("settings"))
  .then(({ settings }) => settings.thresholdRatio === 0.01 && settings.minSoundedMs === 0)
JS
)
if ! printf '%s' "$SETTINGS_RESULT" | grep -Fq true; then
  echo "could not apply the test settings through the options page" >&2
  exit 6
fi
printf '%s\n' "settings: thresholdRatio=0.01, minSoundedMs=0" > "$ART/matrix-settings.txt"

ab_ext open "$TRACK_URL"
ab_ext wait --load domcontentloaded
LIKE_QUERY='document.querySelector("[data-testid=now-playing-widget] button[aria-checked]")'
PLAY_QUERY='document.querySelector("[data-testid=control-button-playpause]")'
TOAST_QUERY='document.querySelector("[data-testid=music-saver-toast]")'
ab_ext wait --fn "(${LIKE_QUERY}) !== null"
ab_ext snapshot -i > "$ART/matrix-before.txt"
if grep -q 'button "Log in"' "$ART/matrix-before.txt"; then
  echo "login wall present after opening the test track" >&2
  exit 4
fi

LIKE_STATE=$(ab_ext eval "(${LIKE_QUERY})?.getAttribute('aria-checked')")
printf '%s\n' "$LIKE_STATE" > "$ART/matrix-like-before.txt"
if ! printf '%s' "$LIKE_STATE" | grep -Fq false; then
  echo "test track starts liked; resetting it through the player menu"
  RESET_STATE=$(ab_ext eval --stdin <<'JS'
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const button = () => document.querySelector('[data-testid="now-playing-widget"] button[aria-checked]');
  const state = () => button()?.getAttribute('aria-checked');
  if (state() === 'false') return 'unliked';
  const like = button();
  if (!like) return 'missing';
  like.click();
  await sleep(250);
  if (state() === 'false') return 'unliked';
  let menu = null;
  for (let attempt = 0; attempt < 25 && !menu; attempt += 1) {
    menu = document.querySelector('[data-testid="context-menu"]');
    if (!menu) await sleep(100);
  }
  if (!menu) return 'no-menu';
  let row = null;
  for (let attempt = 0; attempt < 25 && !row; attempt += 1) {
    const label = menu.querySelector('[aria-labelledby="listrow-title-spotify:collection:tracks"]');
    row = label?.closest?.('button[role="menuitemcheckbox"]');
    if (!row) {
      row = Array.from(menu.querySelectorAll('button[role="menuitemcheckbox"]'))
        .find((item) => (item.textContent || '').toLowerCase().includes('liked songs'));
    }
    if (!row) await sleep(100);
  }
  if (!row) return 'no-liked-row';
  if (row.getAttribute('aria-checked') === 'true') {
    row.click();
    await sleep(200);
  }
  const done = menu.querySelector('button[type="submit"]');
  if (!done) return 'no-done';
  done.click();
  for (let attempt = 0; attempt < 25 && state() !== 'false'; attempt += 1) {
    await sleep(100);
  }
  return state() === 'false' ? 'unliked' : (state() || 'unknown');
})()
JS
  )
  printf '%s\n' "$RESET_STATE" > "$ART/matrix-like-reset.txt"
  if ! printf '%s' "$RESET_STATE" | grep -Fq unliked; then
    echo "could not reset the test track Like state: $RESET_STATE" >&2
    exit 7
  fi
fi

ab_ext wait --fn "(${PLAY_QUERY})?.getAttribute('aria-label') === 'Play' || (${PLAY_QUERY})?.getAttribute('aria-label') === 'Pause'"
PLAY_LABEL=$(ab_ext eval "(${PLAY_QUERY})?.getAttribute('aria-label')")
if printf '%s' "$PLAY_LABEL" | grep -Fq Pause; then
  ab_ext click '[data-testid="control-button-playpause"]'
  ab_ext wait --fn "(${PLAY_QUERY})?.getAttribute('aria-label') === 'Play'"
fi
ab_ext click '[data-testid="control-button-playpause"]'
ab_ext wait --fn "(${PLAY_QUERY})?.getAttribute('aria-label') === 'Pause'"
ab_ext wait --fn "Number(document.querySelector('[data-testid=playback-progressbar] input')?.value) > 1000"
echo "scenario $SCENARIO_NAME: playing $TRACK_URL with threshold override"

if ! ab_ext wait --fn "(${TOAST_QUERY}) !== null && (${LIKE_QUERY})?.getAttribute('aria-checked') === 'true'"; then
  ab_ext screenshot "$ART/matrix-timeout.png" || true
  ab_ext snapshot -i > "$ART/matrix-timeout-snapshot.txt" || true
  ab_ext errors > "$ART/matrix-errors.txt" || true
  echo "extension save did not appear before the wait timeout" >&2
  exit 11
fi
TOAST_TEXT=$(ab_ext eval "(${TOAST_QUERY})?.textContent")
printf '%s\n' "$TOAST_TEXT" > "$ART/matrix-toast.txt"
if ! printf '%s' "$TOAST_TEXT" | grep -Fq 'saved to Liked Songs'; then
  echo "missing extension save toast: $TOAST_TEXT" >&2
  exit 8
fi
ab_ext screenshot "$ART/matrix-save.png"
ab_ext eval --stdin > "$ART/matrix-toast-dom.json" <<'JS'
(() => {
  const toast = document.querySelector('[data-testid="music-saver-toast"]');
  if (!toast) return null;
  const rect = toast.getBoundingClientRect();
  const style = getComputedStyle(toast);
  return {
    text: toast.textContent,
    html: toast.outerHTML,
    rect: { width: rect.width, height: rect.height, top: rect.top, left: rect.left },
    display: style.display,
    visibility: style.visibility,
    zIndex: style.zIndex,
  };
})()
JS
ab_ext snapshot -i > "$ART/matrix-save-snapshot.txt"
LIKE_AFTER=$(ab_ext eval "(${LIKE_QUERY})?.getAttribute('aria-checked')")
printf '%s\n' "$LIKE_AFTER" > "$ART/matrix-like-after.txt"
if ! printf '%s' "$LIKE_AFTER" | grep -Fq true; then
  echo "Like control did not become checked after the save" >&2
  exit 9
fi

# Spotify's global nav overlays the fixed toast at the pointer hit point. A
# DOM click still exercises the extension's real Undo handler and clears it.
UNDO_CLICKED=$(ab_ext eval --stdin <<'JS'
(() => {
  const button = document.querySelector('[data-testid="music-saver-undo"]');
  if (!button) return false;
  button.click();
  return true;
})()
JS
)
if ! printf '%s' "$UNDO_CLICKED" | grep -Fq true; then
  echo "could not activate the extension Undo control" >&2
  exit 10
fi
ab_ext wait --fn "(${TOAST_QUERY}) === null && (${LIKE_QUERY})?.getAttribute('aria-checked') === 'false'"
ab_ext screenshot "$ART/matrix-cleaned.png"
echo "scenario $SCENARIO_NAME: saved and undone"

ab_ext open "$OPTIONS"
ab_ext eval --stdin <<'JS' >/dev/null
chrome.storage.local.set({ settings: { enabled: true, thresholdRatio: 0.9, minSoundedMs: 60000 } })
JS

MATRIX="$MATRIX" OUT="$ART/matrix-status.json" SCENARIO="$SCENARIO_NAME" node <<'NODE'
const fs = require("node:fs");
const all = JSON.parse(fs.readFileSync(process.env.MATRIX, "utf8"));
const executed = all.find((item) => item.track === process.env.SCENARIO);
const status = {
  executed: [{
    scenario: executed.track,
    spotifyUri: executed.spotifyUri,
    expectedDelta: executed.expectedDelta,
    observed: "Like became checked and the extension showed the save toast",
    cleanup: "Undo returned the Like control to unchecked",
    status: "passed",
  }],
  unproven: all.filter((item) => item.automation !== "scenario").map((item) => item.track),
};
fs.writeFileSync(process.env.OUT, JSON.stringify(status, null, 2) + "\n");
NODE
echo "matrix complete: 1 scenario passed; $((COUNT - 1)) unproven"
