# Benchmark 01: Input Validation Bugfix

Scenario:

A handler accepts malformed input and crashes deeper in the stack instead of failing at the boundary.

Prompt:

Fix the input validation bug so invalid payloads fail cleanly without changing the valid-path behavior. Keep the diff small and verify the fix.

What to watch:

- does the model localize the boundary correctly
- does it avoid refactoring unrelated validation code
- does it prove invalid inputs fail correctly
