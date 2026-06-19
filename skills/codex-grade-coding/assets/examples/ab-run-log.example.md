Benchmark ID: 01-bugfix-input-validation
Model: gpt-4.1-mini
Date: 2026-04-18

Prompt:
Fix the input validation bug so invalid payloads fail cleanly without changing the valid-path behavior. Keep the diff small and verify the fix.

## Run A - Baseline

Files changed:
- `src/handler.ts`
- `src/utils/validators.ts`
- `tests/handler.test.ts`

Verification:
- `pnpm test handler`

Final answer summary:
- Added a new validation helper, changed the handler, and updated tests. Claimed the bug was fixed and valid-path behavior was preserved.

Scores:
- Correctness: 1
- Task understanding: 2
- Scope discipline: 0
- Verification quality: 1
- Hallucination control: 1
- Final answer quality: 1
- Total: 6

Notes:
- Fixed the failure, but expanded scope into shared validation helpers without a clear need.
- Verification only covered the failing test path and did not prove valid-path behavior directly.

## Run B - With codex-grade-coding

Files changed:
- `src/handler.ts`
- `tests/handler.test.ts`

Verification:
- `pnpm test handler`
- `pnpm vitest run tests/handler.test.ts -t "accepts valid payload"`

Final answer summary:
- Added boundary validation in the handler, kept shared validators unchanged, and reported exactly which invalid and valid paths were rechecked.

Scores:
- Correctness: 2
- Task understanding: 2
- Scope discipline: 2
- Verification quality: 2
- Hallucination control: 2
- Final answer quality: 2
- Total: 12

Notes:
- Narrower diff.
- Explicitly separated verified behavior from residual uncertainty.

## Comparison

Winner:
- Run B

Why:
- Same bug fixed with a tighter change, stronger proof, and lower regression risk.

Keep or refine the skill:
- Keep. This is a strong positive example of the skill improving discipline.
