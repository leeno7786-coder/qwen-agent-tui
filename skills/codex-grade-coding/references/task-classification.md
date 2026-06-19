# Task Classification

Classify the task before editing code.

## `trivial`

Use for:

- typo fixes
- rename-only changes
- tiny local copy or logging edits
- single-line adjustments with obvious blast radius

Required behavior:

- keep explanation short
- do not create a big plan
- run only the lightest meaningful check

Failure mode to avoid:

- turning a tiny change into a ceremony

## `standard`

Use for:

- ordinary bug fixes
- bounded feature work
- localized test updates
- straightforward config changes

Required behavior:

- inspect the exact files involved
- restate the engineering task concretely
- choose the narrowest viable change
- run targeted verification

Failure mode to avoid:

- "probably correct" coding without execution

## `risky`

Use for:

- shared infrastructure or auth paths
- migrations
- concurrency/state-heavy code
- multi-file refactors
- destructive or high-impact CLI workflows

Required behavior:

- surface assumptions and alternate interpretations
- minimize change surface
- choose a stronger verification level
- mention residual risk and rollback concerns when relevant

Failure mode to avoid:

- confident action on under-specified requirements

## `review`

Use for:

- PR review
- self-review
- diff audit
- logic check or regression check

Required behavior:

- findings first
- cite file and concrete impact
- prioritize correctness, regressions, and missing tests
- mention residual gaps if no findings are proven

Failure mode to avoid:

- style commentary before behavioral risk

## Tie-Break Rule

If between two classes:

- choose the lighter class for truly local edits
- choose the stricter class if the blast radius or uncertainty is material
