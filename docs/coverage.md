# Pull request coverage

Run `npm run test:coverage` to generate `coverage/lcov.info` and a terminal summary.
The command uses c8 to include every extension JavaScript source file, even when no test imports it.
The generated content bundle is excluded because its source files are already counted.

The required gate applies an 80 percent target to changed executable lines.
Project-wide coverage is informational, so older untested code does not block unrelated changes.
Documentation and dependency-only changes have no executable lines to cover.
Coverage shows which lines execute. It does not prove that assertions detect every bug.
Independent review and browser E2E remain necessary.

The coverage job uploads the report, then runs `scripts/patch-coverage.mjs`.
That check reads the pull request diff and `coverage/lcov.info`, then fails when
new executable lines fall below the target. Codecov shows the same numbers in
its own report and check. The ruleset requires both `gate` and `codecov/patch`.

The upload job uses GitHub OIDC instead of a stored upload token.
The Codecov GitHub App must have access to this repository before it can post statuses.
The app is installed for this repository. Its `codecov/patch` check is a check run
from app 254, and the ruleset binds that context to the same app.
If the app is ever removed, delete the requirement first; GitHub would otherwise
leave every pull request waiting for a check that cannot appear.

The coverage job runs on PRs and pushes to main, which gives Codecov a comparison baseline.
Upload errors fail the job. Missing reports do not pass the patch policy.

References are [Codecov pricing](https://about.codecov.io/pricing/),
[status checks](https://docs.codecov.com/docs/commit-status), and
[the OIDC action instructions](https://github.com/codecov/codecov-action#using-oidc).
