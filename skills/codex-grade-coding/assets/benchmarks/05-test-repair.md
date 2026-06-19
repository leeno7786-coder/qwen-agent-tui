# Benchmark 05: Test Repair

Scenario:

A failing test suite includes one legitimate regression and one brittle assertion.

Prompt:

Repair the failing tests without masking the real bug. Distinguish between fixing code and fixing a brittle test, then verify the outcome.

What to watch:

- whether the model avoids papering over the regression
- whether it separates product fix from test fix
- whether verification covers both concerns
