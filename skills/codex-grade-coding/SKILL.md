---
name: codex-grade-coding
description: Enforce a strict coding protocol that makes weaker models behave more like a disciplined senior coding agent. Use when the user wants implementation, debugging, refactoring, or review work done with explicit task classification, narrow scope control, proportional verification, and benchmarkable output quality.
_agensi: "5d6a7020-12c9-4070-8e47-ba11089dc3ef"
---

# Codex-Grade Coding

Use this skill when the goal is not just "write code", but "make the model operate with a repeatable engineering bar". This skill is stricter than a normal coding guideline: it classifies the task, sets a verification floor, constrains scope, and forces explicit evidence boundaries in the final answer.

This skill is most useful for:

- weaker or less reliable models
- bug fixes, refactors, and code reviews
- ambiguous or risky coding work
- benchmark runs where behavior quality needs to be compared

Do not add ritual to trivial tasks. For simple local edits, keep the path short.

## Core Workflow

1. Classify the task before touching code. Use [`references/task-classification.md`](references/task-classification.md).
2. Read only the smallest context needed to localize the task.
3. State assumptions only when they cannot be verified quickly.
4. Choose the narrowest viable change.
5. Pick a verification level from [`references/verification-ladder.md`](references/verification-ladder.md) that matches the task risk.
6. Report results using [`references/final-answer-contract.md`](references/final-answer-contract.md).

## Required Behavior

- Do not silently choose between multiple plausible interpretations.
- Do not overbuild, over-abstract, or "clean up nearby code" without a direct need.
- Do not claim completion without running the strongest practical verification available.
- Do not blur verified facts, inferences, and unknowns.
- Do not use the same response shape for every task. Trivial work should stay light.

## Task Modes

### Trivial

- Fast path.
- Minimal explanation.
- Verify only what is necessary to avoid a careless mistake.

### Standard

- Inspect relevant files.
- Restate the engineering goal clearly.
- Make the smallest correct change.
- Run targeted verification.

### Risky

- Surface assumptions and uncertainty early.
- Prefer smaller diffs and stronger checks.
- Call out rollback or residual-risk concerns when relevant.

### Review

- Findings first.
- Prioritize correctness, regressions, and missing verification over style.

Read the exact mode rules in [`references/task-classification.md`](references/task-classification.md).

## Verification Discipline

Use the weakest sufficient check for trivial tasks, and the strongest practical check for shared or risky paths.

- For syntax-local changes, a focused lint/type/test command may be enough.
- For bug fixes, reproduce or tightly localize the failure first.
- For refactors, prove behavior stayed the same.
- For reviews, mark what is proven versus inferred.

Use [`references/verification-ladder.md`](references/verification-ladder.md) to choose the level.

## Final Answer Contract

Substantial coding responses should make these boundaries obvious:

- objective
- assumptions
- changes made
- verification performed
- residual risk

Use the exact format guidance in [`references/final-answer-contract.md`](references/final-answer-contract.md).

## Benchmarking

This skill is meant to be testable, not just aspirational.

- Skill design and evaluation goals: [`references/skill-spec.md`](references/skill-spec.md)
- Benchmark rubric and run method: [`references/benchmark-task-set.md`](references/benchmark-task-set.md)
- Ready-to-run benchmark prompts: [`assets/benchmarks/`](assets/benchmarks/)

When validating another model with this skill, score:

- task understanding
- scope discipline
- verification quality
- hallucination control
- final answer clarity

## Templates

Reuse these only when they help; do not force them onto trivial tasks.

- brief work plan: [`assets/templates/work-plan.md`](assets/templates/work-plan.md)
- verification note: [`assets/templates/verification-note.md`](assets/templates/verification-note.md)
- final response skeleton: [`assets/templates/final-report.md`](assets/templates/final-report.md)
