# Reusable PR gates

## Decision

Host the gates as in-repo reusable workflows with `on: workflow_call`.
Reject a central `.github` repository for now.

Reason: in-repo `workflow_call` is the smallest model that lets another
repository call the exact same checks. A caller pins
`komaksym/music-saver/.github/workflows/<gate>.yml@<sha>` with inputs
and runs identical code. No new repository, permissions, or governance
overhead applies. Versioning follows the code.

## One body standard

PR #8 is the ground truth. Every PR body carries these five exact headings:

- `## Summary`
- `## Validation`
- `## Risks / Notes`
- `## Breaking changes`
- `## Visual summary`

The single implementation is `scripts/check-pr-body.sh`. Workflows never
duplicate the heading check.

## One gate set

The repository ruleset "main requires verified CI" requires exactly ten
contexts. A reusable gate must make every caller emit all ten.
The ready rollup must not invent the set; the ruleset is the source
of truth. Skipped, neutral, and stale count as failures. The rollup
counts only completed runs for its own `ready` context so the running
job never deadlocks on itself.

- `ci`, `pr-title`, `ready`, `pr-hygiene`, `commit-lint`,
  `cubic-gate`, `actionlint`, `trufflehog`, `zizmor`,
  `cubic · AI code reviewer`

`strict_required_status_checks_policy=true`: after PR #8 merges, every
open PR must rebase onto the strict pr-hygiene.

## Caller example

Caller pins the gate workflow and passes PR inputs:

    jobs:
      pr-hygiene:
        uses: komaksym/music-saver/.github/workflows/pr-hygiene.yml@<sha>
        with:
          pr_body: <pull request body>
          repo: <owner/repo>
          head_sha: <pull request head sha>

Remaining gates take the same `repo` / `head_sha` inputs with event
fallbacks, so `pull_request` behavior stays unchanged.

## Body edits required after #8 merges

- PR #10: body is already strict-clean. Rebase only.
- PR #11: rename `## What changes` to `## Summary`,
  `## How to verify` to `## Validation`, `## Risk` to
  `## Risks / Notes`; add `## Breaking changes` and
  `## Visual summary`; rebase.
- PR #16: same heading mapping as PR #11; rebase.
- Bodies are not rewritten here; owners apply the edits.

## Recorded conflict (not adopted)

PR #7 carries a competing six-section standard (Problem, Evidence,
Changes, Validation, Visual, Risks) with `pr-gates.yml`
(ready + scope-watch) and deletes pr-hygiene. It is recorded as
a conflict and is not adopted.

