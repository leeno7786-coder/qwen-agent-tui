# Verification Ladder

Pick the lowest level that still gives defensible evidence.

## Level 0: Inspection Only

Use only when:

- the task is analysis or review-only
- the environment cannot execute the relevant checks

Output requirement:

- say explicitly that the conclusion is inspection-based

## Level 1: Structural Check

Examples:

- syntax validation
- parse/build check
- schema validation
- focused static analysis

Use for:

- trivial edits
- structure-only changes

## Level 2: Targeted Execution

Examples:

- a focused unit test
- a single command path
- a minimal repro step

Use for:

- ordinary bug fixes
- localized features
- small refactors

## Level 3: Behavioral Proof

Examples:

- before/after comparison on the affected path
- targeted integration test
- focused manual or scripted smoke test

Use for:

- regressions
- shared-path fixes
- user-visible behavior changes

## Level 4: High-Risk Validation

Examples:

- multiple checks across affected layers
- rollback-aware migration verification
- destructive-command safety verification

Use for:

- risky refactors
- migrations
- auth/payment/prod-sensitive paths

## Selection Rule

- `trivial` usually stops at Level 1
- `standard` usually needs Level 2
- `risky` usually needs Level 3 or 4
- `review` should state whether any claim is below execution proof
