# music-saver plans

## Coverage gate

### Summary

Generate LCOV from the existing Node tests, including untested extension files.
Upload coverage with GitHub OIDC and require 80 percent coverage on changed executable lines.
Keep project-wide coverage informational while the older code gains tests.

### Milestones

1. Add the coverage command, Codecov policy, and upload job.
2. Verify the report locally and run the PR checks and browser fixture matrix.
3. Verify Codecov emits its patch status, merge the integration, then require that exact status in the ruleset.
4. If GitHub App installation is missing, retain the implementation PR and report the external setup blocker.

## Summary

Spotify-first Chromium extension that auto-saves tracks the user listens through while working. Design is fully locked: Liked Songs destination, sounded-time 90 percent plus 60s floor once per track ID, auto-save with Undo toast and local log, check-then-skip already-saved tracks, retry queue with backoff plus manual retry, settings with threshold 90 plus floor 60s plus enable-disable, Spotify web scope, public repo. Q11 answered NO Premium, so v1 drives the web player through a content script (ADR-0003) and the tested API client stays parked for a post-Premium future.

## Shared PR gate

### Summary

One reusable workflow in `komaksym/pr-gate` owns the required pull request checks.
`music-saver` keeps a thin `.github/workflows/pr.yml` with `checks`, `e2e`, and a `gate` job.
The default branch ruleset will require only `gate`.
Unresolved review threads still block a merge without a required reviewer bot.

### Milestones

1. Build the shared repository with the reusable checks workflow and the ruleset script.
2. Migrate `music-saver` to the shared workflow and delete the superseded local gate workflows.
3. Verify `gate` passes on a good pull request and fails on a broken one, using real runs.
4. Apply the new ruleset, disable ruleset 25511836, and merge this pull request.

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

## PR #10 reconciliation

### Summary

Merge current `main` (`b0cbc20`) into the ad-tolerance branch without rebasing.
Keep main's shared PR gate, live E2E workflow and fixtures, Cubic advisory config,
Dependabot, security tests, and manifest tests. Retire the branch's superseded local
gate workflows, scripts, and tests. Preserve ad detection, stable track identity,
sampler reset for ads and unreadable samples, and the branch regression coverage.

### Milestones

1. Merge `origin/main` and resolve source, test, docs, and workflow conflicts by intent.
2. Keep main's `pr.yml`, `spotify-e2e.yml`, Dependabot, and E2E fixtures; remove the
   branch-only gate automation that main replaced.
3. Adapt conflict tests to the merged sample shape and add behavior-level coverage only
   where the merge exposes a gap.
4. Run `npm ci`, lint, `verify`, `actionlint`, and `zizmor`; review the final diff with
   deslop and no-comments.
5. Commit the merge and report the local SHA, diff versus main, preserved behavior, and
   proof log paths. Leave remote changes to the parent.

## E2E session pickup

### Summary

Continue PR #20's existing browser suite. Keep controlled-player coverage separate
from authenticated Spotify playback. Missing live proof remains UNVERIFIED.

### Milestones

1. Recover the prior session and confirm the current PR head. Completed at a0672ca.
2. Run the fixture and live jobs explicitly on that head. The live job exposed an
   unsupported cookie import command before playback began.
3. Add a failing cookie-import regression test, reuse the existing CLI argument
   builder, and confirm the documented run commands.
4. Run lint, tests, build, and the isolated Linux browser jobs on the final head.
   Inspect screenshots and preserve results. Report authentication or playback
   failures without treating fixture results as live proof.
5. Keep four plain-save state combinations and one separate live Undo case.
   Verify save and undo log entries, read restored settings back, and capture
   the restored song state.
6. Keep Spotify and extension options in separate tabs. Test the failed reload
   premise with a persistent document marker, actual advancing playback, and
   the same five live assertions. Use the production settings listener to reset
   the tracker while playback is paused.
7. Reproduce Spotify hiding the injected toast with a body-child CSS rule.
   The browser regression at 080fc24 passes thirteen cases before failing on Undo.
   Fix the toast's owned display style, regenerate the bundle, and verify the
   controlled regression plus the live Undo flow. Track the defect in issue #27.

Verification: run 40120502206 passed all 16 fixture cases and all five live cases.
The live job passed on attempt 2 after attempt 1 failed before playback started.
Cleanup restored the initial liked state and settings. The exact bundle SHA is
recorded in both result files and in the E2E guide.

### Throughput checkpoint

- Blocking first steps. Recover the PR head and reproduce the live failure before edits.
- Independent workstreams. A worker owns the runner, regression test, and E2E guide.
  The parent owns this plan and hosted browser verification.
- Shared mutable state. Each writer has its own worktree. Live runs serialize on
  the workflow's dedicated-account concurrency group.
- Smallest safe decomposition. One worker owns the coupled cookie-import fix.
  Additional writers would split one small change without useful independence.

## PR 8 reconciliation

Merge main at b0cbc20 without rewriting branch history. Keep main's CI, security, ad detection, and canonical E2E modules. Preserve sounded-time budgeting and the forward-seek regression test. Review obsolete branch infrastructure against main, triage review threads locally, then run dependency installation, lint, verify, actionlint, and zizmor before the local merge commit. The parent owns all remote changes.
