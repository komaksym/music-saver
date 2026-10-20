# music-saver plans

## Summary

Spotify-first Chromium extension that auto-saves tracks the user listens through while working. Round 1 design is locked: Liked Songs destination, Spotify Web API saves, sounded-time 90 percent plus 60s floor once per track ID, auto-save with Undo toast and local log, check-then-skip already-saved tracks. Round 2 (Q6-Q11) is open and marked TBD below; milestones depending on it start only after answers land.

## Milestones

### M0 Repo and docs (done)

- Private repo created with scaffold, glossary, and ADR-0001.
- Commits  and  pushed to .

### M1 Spotify app and OAuth (TBD: Q6, Q11)

- Dedicated developer app, PKCE flow, local token storage with refresh.
- Scopes: , , plus  only if detection polls the API.
- Prerequisite: owning account holds active Premium (Q11). Prove with a real token against the account.

### M2 Now-playing detection (TBD: Q6, Q9)

- Scope  in Chromium including Brave (Q9).
- Either API polling or content-script watcher; decision rides with Q6/Q9 answers.
- Output is a track identity (Spotify track ID) stream for M3.

### M3 Eligibility engine (rule locked)

- Sounded-time 90 percent plus 60s floor, pauses excluded, seeks do not inflate credit, once per track ID.
- Unit-testable in isolation; E2E through the real player in M7.

### M4 Save, check, undo (TBD: Q7)

- Generic endpoints only: save , remove , generic contains-check, all with Spotify URIs. Deprecated per-type routes are out.
- Retry queue with backoff plus manual retry per Q7 answer.

### M5 Settings page (TBD: Q8)

- Threshold default 90, floor default 60s, enable/disable. Nothing more unless Q8 says so.

### M6 Toast and activity log (interaction locked)

- Auto-save plus Undo toast plus local log of saves, skips, undos, failures.
- Verified visually in a real Brave session, never by DOM-only checks.

### M7 Real-browser E2E and sync (TBD: Q9, Q10)

- End-to-end pass on  in Brave with logged-in session: listen, eligibility fires, Liked Songs gains the track, Undo removes it.
- Push milestones, open PR, keep repo private until tested (Q10).

## Open questions

- Q6 auth shape, Q7 retry, Q8 settings, Q9 tab scope, Q10 visibility, Q11 Premium. See thread for wording.
