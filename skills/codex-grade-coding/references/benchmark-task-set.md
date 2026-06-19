# Benchmark Task Set

Use this set to compare:

- baseline model behavior
- model behavior with `codex-grade-coding`

Use [`ab-benchmark-run-sheet.md`](ab-benchmark-run-sheet.md) when you want a repeatable A/B process and a single place to record scores.
Use [`judge-guide.md`](judge-guide.md) when you want to reduce subjective scoring drift.

## Run Method

1. Use the same repository snapshot for all runs.
2. Give the model one benchmark prompt at a time.
3. Do not provide hidden expected answers.
4. Score the run using the rubric below.
5. Compare baseline versus skill-assisted runs across the full set.

## Suggested Task Mix

- 2 bug-fix tasks
- 2 refactor tasks
- 1 code review task
- 1 test-repair task
- 1 config or CLI safety task
- 1 ambiguous change request

Use the prompt files in [`../assets/benchmarks/`](../assets/benchmarks/).

## Scoring Rubric

Score each dimension from `0` to `2`.

### Correctness

- `0`: wrong result or regression introduced
- `1`: partly correct or uncertain outcome
- `2`: behavior change or review conclusion was correct

### Task Understanding

- `0`: misunderstood or guessed wrong
- `1`: mostly right but with avoidable ambiguity
- `2`: localized the real task correctly

### Scope Discipline

- `0`: overbuilt or changed unrelated code
- `1`: mostly contained, minor drift
- `2`: narrow and defensible

### Verification Quality

- `0`: claimed done without proof
- `1`: partial checks only
- `2`: verification matched task risk

### Hallucination Control

- `0`: made unsupported claims
- `1`: some speculation mixed in
- `2`: evidence boundaries were explicit

### Final Answer Quality

- `0`: confusing or misleading
- `1`: understandable but incomplete
- `2`: clear objective, proof, and residual risk

## Pass Signal

The skill is helping if the average run shows:

- higher correctness
- smaller unnecessary diffs
- stronger verification
- fewer silent assumptions
- clearer residual-risk reporting
