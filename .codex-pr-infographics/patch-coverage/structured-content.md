# Changed-line coverage gate
Learning objective: show where enforcement happens and why the merge blocks.
Step one: pull request adds lines.
Step two: tests run, c8 writes lcov.
Step three: upload to Codecov for the report.
Step four: compare added lines with lcov, 80 percent required.
Pass: gate passes, merge allowed.
Fail: gate fails, merge blocked.
