# music-saver plans

## Summary

Spotify-first Chromium extension that auto-saves tracks the user listens through while working. Design is fully locked: Liked Songs destination, sounded-time 90 percent plus 60s floor once per track ID, auto-save with Undo toast and local log, check-then-skip already-saved tracks, retry queue with backoff plus manual retry, settings with threshold 90 plus floor 60s plus enable-disable, Spotify web scope, public repo. Q11 answered NO Premium, so v1 drives the web player through a content script (ADR-0003) and the tested API client stays parked for a post-Premium future.

## Milestones

### M0 Repo and docs (done)

- Public repo with scaffold, glossary, ADR-0001 (superseded), ADR-0002 (parked), ADR-0003, and API inventory.

### M1 Player DOM mapping (needs the user present)

- Against the live logged-in `open.spotify.com` in Brave: locate the track identity, the Like state readout, and the Like toggle control.
- Login-walled, so it runs in a coordinated session with the user present. Output is a written control map, not code.
- Proves the DOM path exists before M2 code starts.

### M2 Content-script watcher

- Watches the mapped controls on `open.spotify.com`, emits track identity plus Like state, feeds sounded time into the eligibility engine.
- No API scopes, no tokens, existing Brave login only.

### M3 Eligibility engine (done: rule plus tests)

- Sounded-time 90 percent plus 60s floor, pauses excluded, seeks do not inflate credit, once per track ID.
- Implemented in `src/eligibility.js`, 8 tests green in `tests/eligibility.test.js`.

### M4 Save, check, undo through the player (locked: retry queue)

- Like-state read before acting (skip when already Liked), Like click to save, toggle again to undo.
- Failed actions queue locally with backoff, surface in the log, manual retry included.
- `src/spotify.js` (8 tests green) stays parked for post-Premium API use.

### M5 Settings page (locked)

- Threshold default 90, floor default 60s, enable plus disable. Nothing more.

### M6 Toast and activity log (interaction locked)

- Auto-save plus Undo toast plus local log of saves, skips, undos, failures.
- Verified visually in a real Brave session, never by DOM-only checks.

### M7 Real-browser E2E and sync (locked: public repo)

- End-to-end pass on `open.spotify.com` in Brave with logged-in session: listen, eligibility fires, Liked Songs gains the track, Undo reverses it.
- Push milestones, open PR under branch rulesets on the public repo.

## Spotify browser E2E milestone

Summary: execute a scenario table against the unpacked extension. Keep deterministic
player fixtures separate from live Spotify account evidence. Authentication failures
must fail the live job, never produce a green skip.

1. Add regression tests for advertisement rejection before changing the DOM boundary.
2. Add an agent-browser runner, controlled player fixture, persistent-profile live mode,
   cleanup, screenshots, and machine-readable results.
3. Run both browser jobs on GitHub Linux. Require their exact job names in the main
   ruleset only after confirming they execute. Keep credentials out of artifacts.
4. Verify the committed artifact, inspect browser screenshots, and document limitations.

## Open questions

- None. All questions Q1-Q11 answered; any new fork gets a new ADR.
