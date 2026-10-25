# music-saver

[![PR checks](https://github.com/komaksym/music-saver/actions/workflows/pr.yml/badge.svg)](https://github.com/komaksym/music-saver/actions/workflows/pr.yml)
![GitHub issues](https://img.shields.io/github/issues/komaksym/music-saver)
![GitHub pull requests](https://img.shields.io/github/issues-pr/komaksym/music-saver)

Chromium extension that auto-saves Spotify tracks you listen through while you work. Spotify-only MVP: no Premium, Spotify web player only.

## How it works

- Watches the Spotify web player (`open.spotify.com`) through a content script and reuses the existing login. No app setup, no OAuth, no tokens.
- A listen counts when sounded time reaches 90% of the track with at least 60 seconds sounded, once per track ID. Pauses and ad segments never add credit; seeks are limited to elapsed wall time.
- On the eligible transition the extension reads Like state first and skips tracks already in Liked Songs. Otherwise it saves through the player Like control.
- Every save shows an Undo toast and is recorded in a local activity log (saves, skips, undos, failures). Failed actions retry with backoff and can be retried manually from the options page.
- Settings: enable/disable, threshold percent (default 90), minimum seconds (default 60).

## Install (unpacked)

1. Open `chrome://extensions` and enable Developer mode.
2. Load unpacked and select the `extension/` directory.
3. Open `open.spotify.com`, play music, and confirm saves land in Liked Songs. Undo reverses the latest save.

## Develop

- `npm test` runs the unit and integration suites.
- `npm run build` regenerates `extension/content.bundle.js` (do not edit by hand).
- `npm run verify` runs tests, build, and syntax checks.

## Browser E2E

The browser tests use agent-browser and load the unpacked extension on Linux with
Xvfb. `node scripts/spotify-e2e.mjs fixture` tests a controlled player matrix.
`node scripts/spotify-e2e.mjs live` tests actual Spotify playback with a
dedicated authenticated profile. Fixture results do not prove live Spotify
playback.

See [Spotify E2E checks](docs/spotify-e2e.md) for coverage, authentication,
artifacts, and the GitHub check names. Missing or expired authentication fails
the live suite. Never use a personal Spotify account for these tests.

The generic Spotify Web API client in `extension/lib/spotify.js` stays parked for a post-Premium future (see `docs/adr/0003-dom-first-no-premium.md`).
