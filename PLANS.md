# music-saver plans

## Summary

Spotify-first Chromium extension that auto-saves tracks the user listens through while working. Design is fully locked: Liked Songs destination, sounded-time 90 percent plus 60s floor once per track ID, auto-save with Undo toast and local log, check-then-skip already-saved tracks, retry queue with backoff plus manual retry, settings with threshold 90 plus floor 60s plus enable-disable, Spotify web scope, public repo. Q11 answered NO Premium, so v1 drives the web player through a content script (ADR-0003) and the tested API client stays parked for a post-Premium future.

## Trusted global PR gates

### Summary

Validate every pull request with PR8's gates, then block merges on the default branch.
After this branch reaches `main`, ruleset 25511836 gains the required contexts `smoke` and `trusted-pr-policy`.
Never select `~ALL`, because required checks there also block ordinary feature-branch pushes.
Do not require the nightly-only `live` job. Do not copy deletion or non-fast-forward protections.
Do not merge or activate until an independent reviewer approves the exact deployment head.
Document the fork limit, the manual re-run command, and the two-PR flow for a pinned file or a script change.
Port PR8's five-section pull request template, so a PR opened from the template already passes the heading check.

### Milestones

1. Inspect PR8 and PR18, then test rejected metadata and weaker workflow provenance before implementation.
2. Add a metadata-only verifier and deployment workflow. Never execute PR code with its write token.
   Document that Actions-owned check names cannot provide an independent trust anchor.
   Require a dedicated App verdict or organization-required workflows before claiming tamper-proof global enforcement.
   Port PR8's secretless PR smoke job and the scripts it runs. Require `smoke` in the manifest and the ready rollup.
   Read pull-request runs only, so a newer push run cannot satisfy or reject the rollup.
   Re-run the verdict when `cubic-gate` or `pr-ready` completes, so an early failure clears without a PR edit.
3. Verify locally and open a deployment PR against `main`. Preserve the remote ruleset snapshot.
4. After merge, edit ruleset 25511836 to add `smoke` and `trusted-pr-policy`, confirm it targets the default branch only, and read back the API state.

The throughput checkpoint is a tested deployment PR. Remote activation stays a separate step after that PR reaches `main`.

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

## Open questions

- None. All questions Q1-Q11 answered; any new fork gets a new ADR.
