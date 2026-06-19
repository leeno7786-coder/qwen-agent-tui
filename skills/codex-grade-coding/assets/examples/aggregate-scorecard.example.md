Model: gpt-4.1-mini
Date: 2026-04-18
Skill state: A/B comparison for `codex-grade-coding`

## Per-Benchmark Totals

| Benchmark | A total | B total | Delta | Winner | Notes |
| --- | --- | --- | --- | --- | --- |
| 01 | 6 | 12 | +6 | B | Much tighter bug-fix scope |
| 02 | 7 | 10 | +3 | B | Better root-cause discipline |
| 03 | 8 | 9 | +1 | B | Small refactor improved slightly |
| 04 | 6 | 10 | +4 | B | Findings-first review was stronger |
| 05 | 7 | 9 | +2 | B | Better separation of product fix vs brittle test |
| 06 | 8 | 9 | +1 | B | Slightly stronger structural validation |
| 07 | 5 | 10 | +5 | B | Clearer CLI risk handling |
| 08 | 4 | 9 | +5 | B | Better ambiguity handling |

## Aggregate Dimension Averages

| Dimension | A average | B average | Delta |
| --- | --- | --- | --- |
| Correctness | 1.25 | 1.75 | +0.50 |
| Task understanding | 1.38 | 1.88 | +0.50 |
| Scope discipline | 0.88 | 1.75 | +0.87 |
| Verification quality | 0.88 | 1.63 | +0.75 |
| Hallucination control | 1.00 | 1.75 | +0.75 |
| Final answer quality | 1.00 | 1.63 | +0.63 |

## Qualitative Summary

Biggest improvement:
- Scope discipline and verification quality improved the most.

Biggest remaining weakness:
- The skill still needs watching on very small refactors, where the gain was marginal.

Did the skill add harmful ceremony:
- Not materially in this run, but trivial tasks should still be monitored.

Would you keep, refine, or drop the skill:
- Keep, then refine to reduce overhead on near-trivial tasks.
