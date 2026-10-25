Pull requests add lines. Coverage shows which of those lines the test suite executed.
The coverage job uploads the report to Codecov, then runs scripts/patch-coverage.mjs.
The script compares added lines from the pull request diff with coverage/lcov.info.
It fails when fewer than 80 percent of changed executable lines are covered.
The required gate job fails with it, so the ruleset blocks the merge.
Codecov posts the same numbers as a report. Its commit status needs the GitHub App.
