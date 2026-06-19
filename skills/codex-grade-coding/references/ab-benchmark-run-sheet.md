# A/B Benchmark Run Sheet

Use this sheet to compare a baseline run against a `codex-grade-coding` run on the same task.

## Goal

Measure whether the skill improves execution discipline, not whether the model writes more words.

The comparison should answer:

- did the task framing improve
- did the diff get narrower
- did verification get stronger
- did unsupported claims decrease
- did the final answer become safer to act on

## Test Setup Rules

Keep these constant across A and B:

- same repository snapshot
- same model
- same benchmark prompt
- same environment and available tools
- same temperature and runtime settings if configurable

Only change:

- `A`: no skill
- `B`: with `codex-grade-coding`

## Recommended Run Order

For each benchmark prompt:

1. Run `A` first: plain model, no skill.
2. Reset the repo or workspace to the same starting state.
3. Run `B`: same prompt with `codex-grade-coding`.
4. Score both runs before moving to the next prompt.

## Per-Run Capture

Record these for both `A` and `B`:

- benchmark id
- model name
- prompt used
- files changed
- verification commands run
- final answer summary
- notable failures or uncertainty

Use [`../assets/templates/ab-run-log.md`](../assets/templates/ab-run-log.md) as the fill-in template.
Use [`../assets/templates/aggregate-scorecard.md`](../assets/templates/aggregate-scorecard.md) to summarize the full 8-task run.
Use [`judge-guide.md`](judge-guide.md) while scoring to reduce rater drift.
See filled examples in:

- [`../assets/examples/ab-run-log.example.md`](../assets/examples/ab-run-log.example.md)
- [`../assets/examples/aggregate-scorecard.example.md`](../assets/examples/aggregate-scorecard.example.md)

## Scoring

Score each dimension `0` to `2`.

- correctness
- task understanding
- scope discipline
- verification quality
- hallucination control
- final answer quality

Maximum per run: `12`

## Decision Rules

Interpret the result per prompt like this:

- `B > A by 2+`: meaningful improvement
- `B > A by 1`: slight improvement
- `B = A`: neutral
- `B < A`: the skill added friction or degraded performance

## Extra Qualitative Checks

These matter even if the numeric score is close:

- Did `B` ask better clarifying questions?
- Did `B` avoid unnecessary refactors?
- Did `B` avoid saying "done" without proof?
- Did `B` report residual risk more honestly?
- Did `B` become too slow or ritual-heavy for the task?

## Exit Criteria

The skill is worth keeping if, across the set, `B` usually shows:

- higher or equal correctness
- tighter diffs
- stronger verification
- fewer unsupported claims

The skill needs refinement if `B` often shows:

- over-ceremony on trivial tasks
- slower execution without quality gain
- repeated generic final answers
- better wording but weak verification
