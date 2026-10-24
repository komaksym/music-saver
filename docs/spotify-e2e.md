# Spotify browser E2E checks

The canonical runner is `scripts/spotify-e2e.mjs`. It uses agent-browser 0.38.2.
It loads the built content script and background worker as a real Chromium extension.
No test calls `WatchLoop.tick()` or inserts the bundle into the page.

## Coverage

`node scripts/spotify-e2e.mjs fixture` runs 16 controlled browser scenarios on Linux
with Xvfb. The matrix crosses initial liked state, ratio reached, and minimum sounded
time reached.
Only a song that meets both limits can produce a save or an already-liked skip.
Additional scenarios cover pause, seek, advertisements, ad interruption, disabled settings,
Undo, one save per song, and failed saves entering the retry queue.
Every case checks the player state and the background activity log. Negative cases
also assert that the Like control received no clicks. Screenshots and `results.json`
record each result. The result includes the tested bundle's SHA-256.
The fixture also models host CSS that hides unrecognized body children. Undo must
remain visible and clickable under that rule.

The fixture is not Spotify. The test manifest adds localhost permission and a temporary
extension key. The content script, background worker, and libraries remain unchanged.
The fixture advances its progress against real elapsed time. It does not mock the
extension clock or replace eligibility logic.

`node scripts/spotify-e2e.mjs live` runs the real extension against a Spotify song. It
crosses liked
and unliked states with reached and unreached settings. It verifies real progress,
Liked Songs state, the background log, and an empty retry queue. A separate fifth case
clicks the real Undo toast immediately after a save. It checks removal and both log entries.
It does not open Spotify's playlist menu before clicking Undo.
The runner matches the playing title and artist against the requested track page.
The player and options use separate tabs in one browser profile. Settings changes
reset the real tracker while playback is paused. Each case starts playback explicitly
and verifies that options access preserves the same player document. The reached case uses
a six-second floor and a one-percent ratio to bound CI time. It does not verify the
default 60-second floor through live playback. The fixture covers independent ratio
and floor limits. Existing eligibility unit tests cover the default settings.

The live runner restores the original liked state and extension settings on exit.
It reloads the song to verify the liked state and reads the settings back after restoration.
A restored-state screenshot records successful cleanup. Failure results include safe
phase and player diagnostics. Cookie values and general page content stay suppressed.
A cleanup failure fails the check. A terminated runner cannot guarantee cleanup.
Use a dedicated test account and a disposable song, never a personal account.
Live tests cannot force Spotify to serve an advertisement. Ad cases use explicit
visible fixture markers, including a stale song widget during an ad. Unknown future
Spotify ad markup is not covered. The browser suite is not an exhaustive Spotify UI model.

## Verified browser evidence

Run [40120502206](https://github.com/komaksym/music-saver/actions/runs/40120502206)
tested bundle `033dff77608f083f430230c4f47dd3cb219276718b0a0b69b445f484ba14a164`.
Its fixture job passed all 16 cases. Live attempt 1 failed before playback began;
attempt 2 passed all five cases and restored the original liked state and settings.
The runner preserves failed attempts instead of masking playback failures with retries.

The [live Undo screenshot](evidence/spotify-undo.png) shows the real toast before
the click. Account content outside the designated song widget and toast is hidden.

## Authentication

An existing dedicated profile is available in the original workstation checkout at
`tests/e2e-profile`. This location is ignored by Git. The new runner does not inspect,
copy, export, or overwrite a personal Brave profile. Set `SPOTIFY_E2E_PROFILE` to a
dedicated profile on a Linux workstation or runner. Keep browser session names and
profile locations outside repository configuration.

GitHub-hosted runners cannot reuse workstation profile encryption. They restore
Spotify cookies into one dedicated persistent profile for the job. The existing
`SPOTIFY_E2E_COOKIES_B64` repository secret supplies the cookies. Cookies must contain
`sp_dc` and must belong to Spotify domains. Expired sessions, missing secrets, an
unavailable song, unsupported playback, and changed selectors all fail the live check.
There is no successful authentication skip.

Only trusted repository contributors may run account-backed code with this secret.
The workflow never uses `pull_request_target`. Fork pull requests do not receive the
secret and cannot pass the live check without a trusted, reviewed branch run. Do not
copy fork code into a privileged workflow. Refresh authentication through the existing
dedicated account workflow when Spotify expires the session. Never commit cookie data.

The runner imports `SPOTIFY_E2E_COOKIE_FILE` only when you set it. Omit that variable to
reuse a logged-in persistent profile. `SPOTIFY_E2E_TRACK_ID` selects a 22-character
Spotify song ID. The GitHub repository variable can override the workflow's seed song.
Do not run the suite while another browser owns the same profile.

## GitHub checks

`.github/workflows/spotify-e2e.yml` runs the fixture job on pushes, pull requests,
and manual dispatches, plus a nightly schedule. Its stable job names are
`spotify-e2e-fixture` and `spotify-e2e-live`. The live job runs only on the
nightly schedule and on an explicit dispatch, so unreviewed code never uses the
dedicated account. It also uses repository-wide concurrency for that account and
never cancels an active run to start another one.

Require both job names through the default branch ruleset. Retain the existing checks.
Check the workflow at the pull request head before a merge. A passing fixture job is
not evidence that live authentication or playback worked.

Artifacts contain results and screenshots only. Live screenshots hide everything
except the song widget and extension toast. Cookie files, browser profiles, snapshots,
network captures, and raw browser error output are not uploaded. The live job removes
its ephemeral profile and cookie file even after a failure.

## Run on Linux

Install the pinned harness and browser, then run the fixture suite.

```sh
npm install --global agent-browser@0.38.2
agent-browser install --with-deps
npm run verify
xvfb-run --auto-servernum node scripts/spotify-e2e.mjs fixture
```

For live playback, supply `SPOTIFY_E2E_PROFILE` and `SPOTIFY_E2E_TRACK_ID` through your
environment. Supply `SPOTIFY_E2E_COOKIE_FILE` only when you need to seed a new profile.
Run `xvfb-run --auto-servernum node scripts/spotify-e2e.mjs live`. The browser runs
inside the virtual display. It does not take the operator's foreground window.

Older uncommitted `e2e-matrix.sh` and `e2e-nightly.yml` files are not this implementation.
They validate placeholder records rather than execute the scenarios described here.
