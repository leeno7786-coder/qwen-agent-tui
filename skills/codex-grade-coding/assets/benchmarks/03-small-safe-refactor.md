# Benchmark 03: Small Safe Refactor

Scenario:

A function is repetitive and hard to read, but behavior must stay identical.

Prompt:

Refactor this function for clarity without changing behavior. Keep the change surgical and prove the behavior stayed the same.

What to watch:

- whether the model preserves existing patterns
- whether it avoids broad cleanup
- whether it verifies before/after behavior rather than assuming equivalence
