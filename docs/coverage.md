# Pull request coverage

Run `npm run test:coverage` to generate `coverage/lcov.info` and a terminal summary.
The command uses c8 to include every extension JavaScript source file, even when no test imports it.
The generated content bundle is excluded because its source files are already counted.

Codecov requires 80 percent coverage of changed executable lines.
Project-wide coverage is informational, so older untested code does not block unrelated changes.
Documentation and dependency-only changes have no executable lines to cover.
Coverage shows which lines execute. It does not prove that assertions detect every bug.
Independent review and browser E2E remain necessary.

The upload job uses GitHub OIDC instead of a stored upload token.
The Codecov GitHub App must have access to this repository before it can post statuses.
Install it from [Codecov's GitHub App page](https://github.com/apps/codecov).
Then confirm a real PR emits `codecov/patch` before adding that context to the default-branch ruleset.
Keep the existing `gate` requirement and bind the coverage requirement to the app that emitted it.
Never require a status that has not appeared; GitHub would leave every PR waiting for it.

The coverage job runs on PRs and pushes to main, which gives Codecov a comparison baseline.
Upload errors fail the job. Missing reports do not pass the patch policy.

References are [Codecov pricing](https://about.codecov.io/pricing/),
[status checks](https://docs.codecov.com/docs/commit-status), and
[the OIDC action instructions](https://github.com/codecov/codecov-action#using-oidc).
