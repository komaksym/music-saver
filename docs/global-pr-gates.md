# Global PR gates

## Scope and enforcement target

Every pull request runs PR8's validation gates. This change adds one verdict, `trusted-pr-policy`.
Merge blocking stays on the default branch, and ruleset `25511836` is the enforcement target.
After this change reaches `main`, ruleset `25511836` gains the required contexts `smoke` and `trusted-pr-policy`.
This change edits no remote ruleset. That edit is a separate step after the merge.

A `~ALL` ruleset is rejected. Required checks on `~ALL` also block ordinary feature-branch pushes.
Removing deletion and non-fast-forward rules does not make required checks merge-only.
`do_not_enforce_on_create` exempts creation, not later pushes.
The nightly-only `live` job stays out of every required set.

The policy ports PR8's gate workflows and direct CI dependencies from commit `0bca59ec0d030ab3c1e33167ea857c98c8f03c82`.
It does not port PR8's player change. PR18 stays a separate proposal, and its reusable workflow changes need later approval.
The manifest pins the approved file hashes, and `tests/trusted-pr-policy-manifest.test.js` compares each hash with the tree.

`.github/workflows/e2e-smoke.yml` ports PR8's secretless pull-request `smoke` job.
PR8's nightly `live` job, its matrix executor, and its cookie restore path are not ported.
The ported workflow drops PR8's `paths` filter and runs on every pull request.
A required status check must exist on every pull-request head. GitHub keeps the checks of a skipped workflow pending,
so a path-filtered workflow cannot become a required check
([trigger a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)).
PR8 does not require `smoke` today. The plan adds it to `25511836`.

## What the policy validates

The metadata verifier reads GitHub API data. It never checks out, installs, or executes PR code.
The target workflow checks out only `komaksym/music-saver` branch `main`, without persisted credentials.
Its write permission publishes only the `trusted-pr-policy` commit status.

The verifier checks these rules:

- The PR is open, not draft, and has a Conventional Commit title.
- The five PR8 headings appear outside fenced code. Empty or duplicate sections are not new failures.
- Nonmerge commits have Conventional Commit subjects and nonempty bodies.
- Required workflow files and five supporting scripts match the manifest.
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

## Re-evaluation

The policy requires `cubic-gate` and the `cubic · AI code reviewer` check, and either one can report after the policy does.
The policy therefore re-runs when `cubic-gate` or `pr-ready` completes, so an early failure clears without a PR edit.
GitHub starts a `workflow_run` workflow only when its file exists on the default branch, so this re-run starts after the merge
([workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)).

To re-evaluate by hand:

    gh workflow run trusted-pr-policy.yml -f pr_number=19

The policy workflow and its scripts are not pinned. A file cannot verify the copy that runs it.
Manual dispatch runs the workflow file from the selected ref, so a writer can run a modified copy and post this status.
Treat the verdict as a signal, not as proof against a hostile writer.

## Limits

A required status check binds a context to an App, not to a workflow implementation.
The policy detects accidentally weaker branch validators and rejects wrong supporting workflow provenance.
A hostile workflow can still imitate the policy's own status under the shared Actions App identity.
It is not tamper-proof enforcement. The manifest does not prove test adequacy or freeze all transitive validator inputs.
It checks head files, not the tested merge tree.

GitHub commit statuses belong to SHAs, not individual PRs. PRs with the same head SHA share status state.
Body edits do not change that SHA. Event delays, cancellation, and concurrent metadata edits can leave a stale verdict.
The final metadata reread and the completion re-run narrow this window but cannot remove these platform limits.

A fork pull request cannot pass `ready` or `trusted-pr-policy`.
Both read the workflow run's `pull_requests` list, and GitHub fills that list only for head branches in the base repository.
A fork-origin run therefore has no pull request number. The policy logs that case and posts no status,
so the required context stays missing. The `ready` rollup finds no eligible run for the same reason and waits until its deadline.

The policy reads the manifest and scripts from `main`. A PR that edits a pinned file, or adds or removes a `package.json` script,
fails until the manifest allows the new content. Land a manifest-only PR first, because the manifest itself is not pinned.
Keep the old hash in the array during the transition so other open PRs still pass, then land the PR that edits the pinned file.
A third PR removes the old hash.

The ported smoke job is a browser reachability check. It opens a public page headless and saves a snapshot.
It does not run the player or the scenario matrix, so it does not prove that the extension saves a track.
Those stages stay on PR8 and on the nightly path.

A required smoke run costs one hosted runner per pull request. The browser install took 4 minutes
35 seconds on the ported workflow's first run (`40040397889`). PR8's install step took 17 seconds
on `39988078459`, so the cost depends on whether the runner image already carries the browser.

Personal repositories cannot use organization-required workflows.
A dedicated App can provide an independent verdict identity, but creating one is outside this change.

## Deployment gates

1. Review the exact deployment head independently. Run all required checks without bypass.
2. Merge only after the exact-head checks and review pass.
3. After the merge, add the required contexts `smoke` and `trusted-pr-policy` to ruleset `25511836`.
   Do not select `~ALL`.
4. Exercise main-target, stacked-target, metadata-edit, and same-head PR canaries after deployment.
   A fork PR is an expected-fail case for `ready` and `trusted-pr-policy`.
   Include a documentation-only PR, which must still receive `smoke` on its head.
5. Confirm workflow source selection from actual run evidence, not only event documentation.
6. Test wrong workflow names, newer push runs, pending PR reruns, weak scripts, and stale verdict rejection.
7. Force a failed verdict, then let `cubic-gate` complete, and confirm the completion re-run replaces it.
8. Preserve a fresh ruleset snapshot and verify API readback after any authorized remote change.

Current GitHub documentation describes `pull_request_target` as default-branch context.
That statement is not live proof of stacked-PR coverage for this repository.
The target workflow has two narrowly documented `dangerous-triggers` lint exceptions, one per privileged trigger,
because it reads PR data without executing it.

## References

- [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [Available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [Organization rulesets and required workflows](https://docs.github.com/en/organizations/managing-organization-settings/creating-rulesets-for-repositories-in-your-organization)
- [Workflow event contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target)
- [workflow_run event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
- [Trigger a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
