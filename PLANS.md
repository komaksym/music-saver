# music-saver plans

## Summary

Spotify-first Chromium extension that auto-saves tracks the user listens through while working. Round 1 design is locked: Liked Songs destination, Spotify Web API saves, sounded-time 90 percent plus 60s floor once per track ID, auto-save with Undo toast and local log, check-then-skip already-saved tracks. Round 2 is locked except Q11 (Premium): auth is PKCE login with no token copying, retry queue with backoff plus manual retry, settings carry threshold 90 plus floor 60s plus enable-disable, scope is Spotify web only, repo is public.

## Milestones

### M0 Repo and docs (done)

- Public repo with scaffold, glossary, ADR-0001, ADR-0002, and API inventory.
- History: , , , , , plus auth docs commit.

### M1 Spotify app and OAuth (open: Q11 only)

- Dedicated developer app, Authorization code with PKCE via .
- Scopes: , , plus  only if detection polls the API.
- Prerequisite: owning account holds active Premium (Q11). Prove with a real login plus token against the account.

### M2 Now-playing detection (locked: Spotify web)

- Scope  in Chromium including Brave.
- Either API polling or content-script watcher; decision rides with the M1 redirect findings.
- Output is a track identity (Spotify track ID) stream for M3.

### M3 Eligibility engine (done: rule plus tests)

- Sounded-time 90 percent plus 60s floor, pauses excluded, seeks do not inflate credit, once per track ID.
- Implemented in , 8 tests green in .

### M4 Save, check, undo (locked: retry queue)

- Generic endpoints only: save , remove , generic contains-check, all with Spotify URIs. Deprecated per-type routes are out.
- Failed saves queue locally with backoff, surface in the log, manual retry included.

### M5 Settings page (locked)

- Threshold default 90, floor default 60s, enable plus disable. Nothing more.

### M6 Toast and activity log (interaction locked)

- Auto-save plus Undo toast plus local log of saves, skips, undos, failures.
- Verified visually in a real Brave session, never by DOM-only checks.

### M7 Real-browser E2E and sync (locked: public repo)

- End-to-end pass on  in Brave with logged-in session: listen, eligibility fires, Liked Songs gains the track, Undo removes it.
- Push milestones, open PR under branch rulesets now available on the public repo.

## Open questions

- Q11 Premium. All other questions Q1-Q10 are answered; see thread.
