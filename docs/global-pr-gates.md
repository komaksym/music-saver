# Global PR policy checkpoint

## Scope and current state

This change is a draft deployment candidate, not active global enforcement.
Ruleset `25511836` remains unchanged and targets only the default branch.
No remote ruleset has been created or edited. No PR has been merged.
The nightly-only `live` job is not a required check.

The candidate ports PR8's secretless pull-request `smoke` job as
`.github/workflows/e2e-smoke.yml`. PR8's nightly `live` job, its matrix executor,
and its cookie restore path are not ported. `live` stays out of every required set.
The ported smoke workflow drops PR8's `paths` filter and runs on every pull request.
A required status check must exist on every pull-request head. GitHub keeps the checks
of a skipped workflow pending, so a path-filtered workflow cannot become a required
check ([workflow trigger docs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)).
PR8 does not require `smoke` today. This candidate proposes it as an additional context.

The deployment ports PR8 gate workflows and direct CI dependencies from commit
`0bca59ec0d030ab3c1e33167ea857c98c8f03c82`. It does not port PR8's player change.
PR18 remains a separate proposal. Its reusable workflow changes require a later policy approval.
The candidate manifest pins the approved file hashes. These hashes still require independent review before deployment.

## What the candidate validates

The metadata verifier reads GitHub API data. It never checks out, installs, or executes PR code.
The target workflow checks out only `komaksym/music-saver` branch `main`, without persisted credentials.
Its write permission publishes only the `trusted-pr-policy` commit status.

The verifier checks these rules:

- The PR is open, not draft, and has a Conventional Commit title.
- The five PR8 headings appear outside fenced code. Empty or duplicate sections are not new failures.
- Nonmerge commits have Conventional Commit subjects and nonempty bodies.
- Required workflow files and five supporting scripts match the candidate manifest.
- Package script commands match PR8.
- Checks have the required App identity and current head SHA.
- Actions results belong to the expected repository, workflow path, PR, and permitted event.
- The newest eligible PR workflow run and attempt must succeed. A newer push run on the
  same head cannot hide it and cannot reject it.
- The `ready` rollup reads `ci`, `pr-title`, `pr-hygiene`, `commit-lint`, and `smoke`.
  It reads the newest pull-request run and attempt first, then that attempt's named check.
  It never waits on its own context.
- The ported smoke job runs headless and secretless. It needs no login and no repository secret.
- Lists are paginated. Unreadable responses, incomplete commit lists, and metadata changes during evaluation fail closed.

The body headings are `Summary`, `Validation`, `Risks / Notes`, `Breaking changes`, and `Visual summary`.
The eleven supporting contexts are `ci`, `pr-title`, `ready`, `pr-hygiene`, `commit-lint`,
`cubic-gate`, `actionlint`, `trufflehog`, `zizmor`, `smoke`, and `cubic · AI code reviewer`.

## Limits that block remote activation

A required status check binds a context to an App, not to a workflow implementation.
The candidate detects accidentally weaker branch validators and rejects wrong supporting workflow provenance.
A hostile workflow can still imitate the candidate's own status under the shared Actions App identity.
It is not tamper-proof enforcement. The manifest does not prove test adequacy or freeze all transitive validator inputs.
It checks head files, not the tested merge tree.

GitHub commit statuses belong to SHAs, not individual PRs. PRs with the same head SHA share status state.
Body edits do not change that SHA. Event delays, cancellation, and concurrent metadata edits can leave a stale verdict.
The final metadata reread reduces one race but cannot remove these platform limits.

The ported smoke job is a browser reachability check. It opens a public page headless and saves a snapshot.
It does not run the player or the scenario matrix, so it does not prove that the extension saves a track.
Those stages stay on PR8 and on the nightly path.

A required smoke run costs one hosted runner per pull request. The browser install took 4 minutes
35 seconds on the ported workflow's first run (`40040397889`). PR8's install step took 17 seconds
on `39988078459`, so the cost depends on whether the runner image already carries the browser.
Account for this cost before the user chooses the enforcement target.

Personal repositories cannot use organization-required workflows.
A dedicated App can provide an independent verdict identity, but creating one is outside this checkpoint.

A `~ALL` branch ruleset with required checks applies to ordinary feature-branch updates too.
Removing deletion and non-fast-forward rules does not make required checks merge-only.
`do_not_enforce_on_create` exempts creation, not subsequent pushes.
Requiring PRs on all branches would also prohibit normal direct feature-branch updates.
No such ruleset is safe to activate without a user-approved branch-update policy.

The supported conservative choice is all-PR validation feedback plus required checks on selected integration targets.
That choice does not block merges into every possible feature branch.
Keep the current main protections unchanged while the user selects the intended policy.

## Deployment gates

1. Obtain the user's integration-target and feature-update policy choice.
2. Review the exact deployment head independently. Run all required checks without bypass.
3. Merge only after the exact-head checks and review pass. This draft is not merge-ready.
4. Exercise main-target, stacked-target, fork, metadata-edit, and same-head PR canaries after deployment.
   Include a documentation-only PR, which must still receive `smoke` on its head.
5. Confirm workflow source selection from actual run evidence, not only event documentation.
6. Test wrong workflow names, newer push runs, pending PR reruns, weak scripts, and stale verdict rejection.
7. Only then consider a separate check-only ruleset for approved integration targets.
8. Preserve a fresh ruleset snapshot and verify API readback after any authorized remote change.

Current GitHub documentation describes `pull_request_target` as default-branch context.
That statement is not live proof of stacked-PR coverage for this repository.
The target workflow has a narrowly documented `dangerous-triggers` lint exception because it reads PR data without executing it.

## References

- [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [Available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [Organization rulesets and required workflows](https://docs.github.com/en/organizations/managing-organization-settings/creating-rulesets-for-repositories-in-your-organization)
- [Workflow event contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target)
- [Trigger a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
