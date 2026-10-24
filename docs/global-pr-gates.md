# PR gate

Every pull request and every push to `main` runs `.github/workflows/pr.yml`.
The ruleset requires one check, `gate`.

## Jobs

The `checks` job calls the shared workflow in `komaksym/pr-gate`.
It runs `npm ci` and `npm run lint && npm run verify`.
It then runs `git diff --exit-code`, which proves the bundle is fresh.
It also runs actionlint, zizmor, trufflehog, and a Conventional Commits title check.

The `e2e` job runs the fixture browser matrix on Linux with Xvfb.
It uploads the screenshots and results.
It proves the extension saves a track in a real browser.

The `gate` job needs `checks` and `e2e`.
It fails when either job fails or is cancelled.
It passes only when both jobs pass.

## Required check

The ruleset requires `gate` from the GitHub Actions app, id 15368.
Strict status checks stay off, so a stacked pull request does not need a rebase after every merge.
Squash is the only allowed merge method.
An unresolved review thread blocks the merge.

Reviewer bots are never required checks.
A bot can be absent, renamed, or slow, and a required bot check would then block every merge.
Unresolved review threads already stop a bad change.

## Cutover

1. Merge PR #20.
2. Run `komaksym/pr-gate apply-ruleset.sh komaksym/music-saver`.
3. Disable ruleset 25511836.
4. Merge this pull request.
