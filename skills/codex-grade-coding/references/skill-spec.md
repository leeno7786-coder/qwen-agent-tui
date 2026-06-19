# Codex-Grade Coding Skill Spec

## Goal

Make a weaker model behave more like a disciplined senior coding agent by enforcing:

- better task framing
- narrower diffs
- stronger verification
- lower hallucination rate
- clearer evidence boundaries in the final answer

## Non-Goals

- This does not make a model inherently smarter.
- This does not replace missing domain knowledge.
- This does not justify slow, ritual-heavy handling of trivial work.

## Behavior Targets

The model should:

1. classify the task before acting
2. avoid silent assumption jumps
3. prefer the smallest correct change
4. verify in proportion to risk
5. distinguish verified facts from inferences and unknowns

## Anti-Patterns To Suppress

- overbuilding or speculative abstraction
- "drive-by" refactors outside the request
- claiming success from inspection alone
- treating all tasks as equally risky
- verbose final answers that hide what was actually proven

## Scope Boundary

This skill should sit above ordinary coding behavior and below domain-specific skills.

- Use this skill to tighten execution discipline.
- Use domain skills for framework-specific implementation details.

## Success Criteria

Compared with an unspecialized model run on the same tasks, this skill should produce:

- fewer unnecessary edits
- fewer unverified completion claims
- better bug-fix verification
- more useful review findings
- more reliable residual-risk reporting

## Evaluation Method

Use the benchmark set in [`benchmark-task-set.md`](benchmark-task-set.md) and the prompt files in [`../assets/benchmarks/`](../assets/benchmarks/).

Judge runs on:

- correctness
- scope discipline
- verification depth
- assumption handling
- reporting quality
