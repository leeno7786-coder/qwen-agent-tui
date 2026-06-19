# Benchmark 02: Reproduce-Then-Fix Bug

Scenario:

A previously working path now fails under one specific state transition, but the exact cause is not given.

Prompt:

Investigate the failing state transition, identify the root cause, apply the smallest safe fix, and show evidence that the broken path now works.

What to watch:

- whether the model reproduces or tightly localizes first
- whether it fixes cause versus symptom
- whether verification is stronger than "code looks right"
