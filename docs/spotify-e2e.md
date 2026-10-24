# Spotify browser E2E checks

The canonical runner is `scripts/spotify-e2e.mjs`. It uses agent-browser 0.38.2.
It loads the built content script and background worker as a real Chromium extension.
No test calls `WatchLoop.tick()` or inserts the bundle into the page.

## Coverage

`npm run e2e:fixture` runs one settings check and 18 controlled browser scenarios on
Linux with Xvfb. The matrix crosses initial liked state, ratio reached, and minimum
sounded time reached. Only a song that meets both limits can produce a save or an
already-liked skip. Additional scenarios cover pause, seek, advertisements, ad
interruption, disabled settings, Undo, one save per song, a failed save entering the
retry queue, retry recovery, and a track change.

The scenario table in `tests/e2e/scenarios.mjs` is data. Each record names its
`settings`, its ordered `steps`, the expected activity-log events, the expected
track IDs, the Like-control counters (`opens`, `saves`), and the retry-queue length.
The runner interprets the steps and writes one assertion record per check. Negative
cases assert that the Like control received no click at all. `retry-recovery` fails
one save, then proves the next scheduled retry saves the same track, offers Undo,
records the save after the durable log accepts it, and clears the queue. `track-change` saves two different tracks, so it proves each track has its own
sounded-time budget, liked state, and identity. Screenshots and `results.json` record every result. The result includes the
tested bundle's SHA-256 and the pinned harness version.

The settings check drives the real options page. It sets the three controls through
browser input, reads the stored settings, and asserts that the activity log and retry
queue render.

The fixture is not Spotify. The test manifest adds localhost permission and a temporary
extension key. The content script, background worker, and libraries remain unchanged.
The fixture advances its progress against real elapsed time. It does not mock the
extension clock or replace eligibility logic.

`npm run e2e:live` runs the real extension against a Spotify song. It crosses the full
liked and unliked by ratio-reached by floor-reached matrix, eight cases, and it checks
that settings survive a write and a reload. Every case listens for 15 seconds and
measures the real progress delta. The runner reads the song duration from the progress
control and proves the ratio gates separate inside that window: a one-percent ratio must
sit under six seconds, and a 95 percent ratio must sit above 22 seconds. A seed song
outside 24s to 600s fails loudly instead of claiming a ratio gate it cannot show. Each
case asserts the ratio gate, the floor gate, and the combined threshold against the
measured progress. It does not verify the default 60-second floor through live
playback. The fixture covers independent ratio and floor limits with its own matrix.
Existing eligibility unit tests cover the default settings.

A live failure records a sanitized blocker: `authentication`, `playback-unsupported`,
`playback-not-started`, `selector-mismatch`, or `browser-state-unreadable`. The record
holds booleans about the page, never page text or session data. Do not relax the
progress or song-identity assertions to make a constrained runner pass. A Free account
or a DRM-blocked Linux browser is a real blocker, not a pass.

The live runner restores the original liked state and extension settings on exit, and it
does so after a failure too. A cleanup failure fails the check. A terminated runner cannot guarantee cleanup.
Use a dedicated test account and a disposable song, never a personal account.
Live tests cannot force Spotify to serve an advertisement. Ad cases use explicit
visible fixture markers, including a stale song widget during an ad. Unknown future
Spotify ad markup is not covered. The browser suite is not an exhaustive Spotify UI model.

## Authentication

An existing dedicated profile is available in the original workstation checkout at
`tests/e2e-profile`. This location is ignored by Git. The new runner does not inspect,
copy, export, or overwrite a personal Brave profile. Set `SPOTIFY_E2E_PROFILE` to a
dedicated profile on a Linux workstation or runner. Keep browser session names and
profile locations outside repository configuration.

GitHub-hosted runners cannot reuse workstation profile encryption. They restore
Spotify cookies into one dedicated persistent profile for the job. The existing
`SPOTIFY_E2E_COOKIES_B64` repository secret supplies the cookies. The secret decodes to
a JSON array of cookie objects. Cookies must contain `sp_dc` and must belong to Spotify
domains. The runner adds `sameSite` and `expires` defaults before it hands the file to
agent-browser, because the browser rejects a cookie record without them. Expired
sessions, missing secrets, an unavailable song, unsupported playback, and changed
selectors all fail the live check. There is no successful authentication skip.

Only trusted repository contributors may run account-backed code with this secret. The
live job has no `pull_request` trigger, so it runs only for pushes to branches in this
repository, manual dispatches, and the schedule. A pull request from a fork never
starts it. Write access to this repository is the trust boundary, because a writer can
change the workflow that receives the secret. The account behind the secret must stay a
dedicated test account with no personal library data. The workflow never uses
`pull_request_target` and never checks out fork code into a privileged run. Do not copy
fork code into a privileged workflow. Refresh authentication through the existing
dedicated account workflow when Spotify expires the session. Never commit cookie data.

The runner imports `SPOTIFY_E2E_COOKIE_FILE` only when you set it. Omit that variable to
reuse a logged-in persistent profile. `SPOTIFY_E2E_TRACK_ID` selects a 22-character
Spotify song ID. The GitHub repository variable can override the workflow's seed song.
Do not run the suite while another browser owns the same profile.

## GitHub checks

`.github/workflows/spotify-e2e.yml` runs on pushes, manual dispatches, and a nightly
schedule. It omits the pull-request trigger on purpose. A pull request from a branch in
this repository already has check runs on its head commit from the push that created
it, so `pull_request` would emit the same two check names twice and the live job's
concurrency group can cancel one of the pending runs. Its stable job names are
`spotify-e2e-fixture` and `spotify-e2e-live`. Both jobs run on `ubuntu-24.04` because
the browser dependency install targets that image. The live job uses repository-wide
concurrency for its dedicated account. It never cancels an active run to start another
one.

Each job ends with a proof step that reads `results.json` and fails when any scenario
is missing, any assertion is false, or cleanup failed. Upload failures are loud:
`if-no-files-found: error` on both jobs. A green job without a scenario artifact is not
proof.

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
xvfb-run --auto-servernum npm run e2e:fixture
```

For live playback, supply `SPOTIFY_E2E_PROFILE` and `SPOTIFY_E2E_TRACK_ID` through your
environment. Supply `SPOTIFY_E2E_COOKIE_FILE` only when you need to seed a new profile.
Run `xvfb-run --auto-servernum npm run e2e:live`. The browser runs inside the virtual
display. It does not take the operator's foreground window.

Older uncommitted `e2e-matrix.sh` and `e2e-nightly.yml` files are not this implementation.
They validate placeholder records rather than execute the scenarios described here.
