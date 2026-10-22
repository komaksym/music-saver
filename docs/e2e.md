# E2E rule: agent-browser only

The one supported browser harness is `scripts/e2e-agent-browser.sh`
(auth, cookies-export, cookies-restore, smoke, player). It drives the
unpacked `extension/` through agent-browser with one stable session and
one persistent Chrome profile. Every browser call goes through the same
wrapper with identical flags, so login state is never stranded in a
differently launched browser.

Never add Playwright, Puppeteer, Selenium, Cypress, or WebDriver.
`scripts/check-browser-stack.sh` fails the build when they appear, and
`tests/browser-stack.test.js` locks that in.
State files are forbidden too. Saved JSON state cannot combine with
extensions, so the guard fails on it. The profile directory is the only
login store.

Spotify login uses a dedicated Free agent account, never a personal one.
Run `auth` once on your own machine. It opens one Chrome for Testing
window. Log in there, then press Enter. The window closes itself. Export
the cookies file it writes with base64 into the
`SPOTIFY_E2E_COOKIES_B64` secret for CI. Never commit secrets. Never run
`cookies clear` on the shared profile. It signs the agent out everywhere.

Cookie export opens `open.spotify.com` and then `accounts.spotify.com` in
the same persistent profile. It merges both sets and keeps only
`spotify.com` domains. Restore sets `__Host-` cookies from the
`accounts.spotify.com` URL and other cookies by domain.

Extension runs always open one visible window. Chrome forces headed mode
when an extension loads. The harness reuses one session and always closes
the browser on exit. `auth`, `player`, and the matrix load the extension. CI
installs Xvfb and runs the player and matrix steps with `xvfb-run`. The
smoke check stays headless. Do not run the player or matrix locally,
because the headed window can take focus from you.

CI sets `E2E_REQUIRE_AUTH=1`. In this mode, a missing login profile is
exit 3, not a skip. A local run without a profile still skips with exit 0.

The matrix executes one save scenario with the public test track
`spotify:track:7LoBfKLpz4BGrxCuOzAKRz`. It opens the extension options
page and sets the test-only threshold to 1% and the floor to 0 seconds.
Then it opens the track, starts playback, checks that the Like control
becomes checked, and checks for the extension save toast. It clicks Undo
and restores the default 90% and 60-second settings. The other four matrix
records stay marked `automation: "unproven"`.

Local verification is limited to these commands:

```sh
bash scripts/check-browser-stack.sh
node --test tests/browser-stack.test.js
bash scripts/e2e-agent-browser.sh smoke
npm run verify
```
