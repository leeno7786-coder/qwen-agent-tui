# Judge Guide

Use this guide when scoring `codex-grade-coding` benchmark runs. The aim is to reduce rater drift and keep scores tied to observable behavior.

## Core Rule

Score what the run actually showed, not what you think the model "probably meant".

Prefer:

- commands run
- files changed
- concrete claims in the final answer
- explicit uncertainty handling

Avoid:

- giving credit for intent without evidence
- rewarding verbosity
- conflating "sounds smart" with "proved the result"

## General Scoring Rule

When unsure between two scores, choose the lower score unless the higher one is clearly supported by evidence.

## Dimension Guide

### Correctness

Ask:

- Did the change or review conclusion actually solve the stated problem?
- Did it avoid introducing a visible regression?

Score `2` only if the result is clearly correct from execution or strong evidence.

### Task Understanding

Ask:

- Did the model localize the real task?
- Did it handle ambiguity explicitly instead of silently guessing?

Do not give `2` if the model solved a nearby problem instead of the actual one.

### Scope Discipline

Ask:

- Did the diff stay close to the request?
- Did the model avoid unrelated cleanup, abstraction, or refactor work?

Penalize:

- touching shared helpers without need
- drive-by edits
- broad rewrites for local fixes

### Verification Quality

Ask:

- Was the verification strong enough for the task risk?
- Did the checks prove the claim, or only partially support it?

Do not give `2` for "it compiles" if the task required behavioral proof.

### Hallucination Control

Ask:

- Did the model clearly separate verified facts from inference?
- Did it avoid unsupported claims about tests, behavior, or root cause?

Penalize:

- claiming a path is fixed without proof
- implying unrun checks passed
- presenting guesses as conclusions

### Final Answer Quality

Ask:

- Can a reader quickly tell what changed, what was verified, and what remains risky?
- Is the answer decision-useful, not just plausible-sounding?

Do not give `2` if the answer hides uncertainty or buries the important result.

## Anti-Bias Rules

### Do not reward length

Longer answers do not deserve higher scores unless they improve evidence or clarity.

### Do not reward confidence

Confident phrasing is not proof.

### Do not reward familiar style

A run should not score higher just because it "sounds like" a stronger model.

### Do not punish concise good runs

If a trivial task is handled briefly but correctly and safely, that is a good result.

## Tie-Break Questions

If two runs feel close, compare:

1. Which one changed less unrelated code?
2. Which one proved more of its claims?
3. Which one made uncertainty clearer?
4. Which one would you trust more before merging?

Use the answers to break ties.
