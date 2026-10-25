# Architecture

## Summary

`music-saver` is a Manifest V3 Chromium extension that saves the Spotify
track you listen through. It runs only on `https://open.spotify.com/*` and
reuses the existing web-player session. The save path uses no OAuth app, no
token, and no Spotify Web API call (ADR-0003).

## Layers

| Layer | Files | Owns |
|---|---|---|
| Edge | `extension/content.js` | Reads the player DOM, tracks sounded time, runs the check-then-act Like transaction, shows the Undo toast |
| DOM boundary | `extension/lib/player-dom.js` | The only module that reads or clicks the Spotify player; exposes track identity, playback samples, and Like state |
| Background worker | `extension/background.js` | Durable facts: settings, activity log, retry queue; validates and dedupes reported events; never touches the DOM |
| Pure modules | `extension/lib/eligibility.js`, `settings.js`, `log.js`, `queue.js` | Sounded-time rule, settings defaults, capped activity log, retry backoff; no timers, DOM, or I/O |
| Options page | `extension/options.js`, `extension/options.html` | Reads and writes settings through the settings module |
| Parked client | `extension/lib/spotify.js` | Web API client kept for a post-Premium future; unused on the save path |

## Save flow

1. The content script polls playback about once per second and feeds only
   sounded deltas into `EligibilityTracker`. Pauses, ads, and seeks add no
   credit.
2. A track becomes eligible once per track ID when sounded time reaches
   `max(durationMs * thresholdRatio, minSoundedMs)` (defaults: 90 percent and
   60 seconds).
3. On the eligible transition the edge reads Like state first. A track already
   in Liked Songs is reported as a skip. Otherwise the edge clicks Like and
   shows an Undo toast.
4. Every save, skip, undo, and failure is reported to the background worker,
   which appends it to the local activity log. Failed actions enter the retry
   queue with exponential backoff and can be retried from the options page.

## Build and test

- `node scripts/bundle-content.mjs` concatenates the content script and its
  dependency-free `lib/` modules into `extension/content.bundle.js` because
  MV3 content scripts cannot load ES modules. The bundle is committed, and CI
  fails when it is stale.
- `npm run verify` runs the unit and integration suites, rebuilds the bundle,
  checks the syntax of every extension script, and validates the E2E matrix.
- Browser E2E runs `node scripts/spotify-e2e.mjs fixture` under Xvfb with
  agent-browser. Live runs need a dedicated authenticated profile.

## Constraints

- Spotify selectors are read from the live web player. A redesign can break
  `player-dom.js`, and only `player-dom.js`.
- MV3 service workers can stop at any time, so durable state lives in
  `chrome.storage.local` and is reloaded on wake.
- Extension output stays plain DOM and chrome APIs. No build step ships to the
  user beyond the committed bundle.
