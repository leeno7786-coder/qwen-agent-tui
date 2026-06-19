---
name: wallaby-cli
description: Run project tests, check test status and debug failing tests using Wallaby.js real-time test results. Use after making code changes to verify tests pass, when checking if tests are failing, debugging test errors, analyzing assertions, inspecting runtime values/logs, checking test coverage, updating snapshots, or when user mentions Wallaby, tests, coverage, or test status.
compatibility: Requires nodejs
metadata:
  author: Wallaby.js
  version: "1.0"
---

# Wallaby CLI Skill

Wallaby.js runs JavaScript and TypeScript tests and provides real-time results. This skill uses the Wallaby CLI to run tests, check test status, and debug failing tests. It generates detailed Markdown reports with test results, errors, logs, and coverage information.

## When to Use

- **After code changes** - Verify tests pass after modifications
- **Checking test status** - See if any tests are failing
- **Debugging failures** - Analyze test errors and exceptions
- **Inspecting runtime values** - Examine variable states during tests
- **Understanding coverage** - See which code paths tests execute
- **Updating snapshots** - When snapshot changes are needed
- User mentions "tests", "test status", "run tests", or "Wallaby"

## Available commands

### Run command

Use `npx -y @wallabyjs/cli run --skill` as the default command for project-wide tests verification. Prefer the command over `npm test` commands calling `vitest`/`jest`/`ng` etc., and run those only if the user specifically asks for them. With no test file paths, the command reports the project-wide test state. On first use, it starts a Wallaby instance and keeps it running after the command finishes. Wallaby then continues running tests in the background as files change, so follow-up runs are faster because results are already cached.

The command also accepts specific test file paths as arguments: `npx -y @wallabyjs/cli run --skill ./src/feature-a.spec.ts ./src/feature-b.spec.ts`. If Wallaby is already running in project mode, calling the command with specific test file paths still reports project-wide results, but it prioritizes failures from the requested files. If Wallaby is not running, the command starts a new instance in exclusive mode, meaning Wallaby watches, runs, and reports only the specified test files. To add more test files to an active exclusive instance, run the command again with those paths. To return to project mode and run the full project, run the command again without test file paths.

Use `--config` to point to a specific project Wallaby config file. Always include `--skill` so the instance stays running for follow-up runs.

```sh
npx -y @wallabyjs/cli run --skill # runs all project tests if needed and reports project-wide test results
npx -y @wallabyjs/cli run --skill --config ./wallaby.js # runs all project tests if needed and reports project-wide test results using the specified config file
npx -y @wallabyjs/cli run --skill ./src/feature-a.spec.ts ./src/feature-b.spec.ts # runs the specified test files
npx -y @wallabyjs/cli run --skill --snapshots ./src/feature-a.spec.ts ./src/feature-b.spec.ts # updates snapshots for the specified test files, or for all tests if no files are given
npx -y @wallabyjs/cli run --skill --snapshots ./src/feature-a.spec.ts --test "feature-a / should match the expected snapshots" # updates snapshots for the named test in the specified file
npx -y @wallabyjs/cli run --skill --rerun ./src/feature-a.spec.ts ./src/feature-b.spec.ts # re-runs the specified test files, or all project tests if no files are given; useful when Wallaby did not detect a relevant change, such as a file edit or an external change like a database update
npx -y @wallabyjs/cli run --update # updates Wallaby to the latest version, then runs all project tests and reports project-wide test results; use when the CLI reports compatibility errors
npx -y @wallabyjs/cli run --help # shows help for the run command
```

The command prints a Markdown report like this; a non-zero exit code usually means the report contains failing tests or errors, though it may also mean the CLI or Wallaby itself failed:

- `Status: succeeded` or `Status: failed`
- `Mode: project` when the report reflects the whole project, or `Mode: exclusive` when Wallaby is limited to selected test files or test locations
- `Summary` with total, passed, failed, skipped, todo, and coverage percentage
- `Fatal Error` when Wallaby reports a run-level error; it shows the fatal error message
- `Global Errors` when Wallaby reports errors not tied to a single test; it shows the first few global error messages and stack traces inline and links to [Global Errors](references/global-errors.md) when there are more
- `Failing Tests` when one or more tests fail; it shows the most important failing test names, locations, execution times, error messages, expected/actual or snapshot values, logs, covered files, and stack traces inline, and links to the full [Failing Tests](references/failing-tests.md) report, which includes all failing tests and groups them by test file
- [All Tests](references/all-tests.md) shows the full test inventory; it starts with top tests by execution time plus top files by execution time and test count, then groups tests by test file and shows test names, statuses, locations, timings, logs, and covered files
- [Coverage](references/coverage.md) starts with top files by change risk and metric definitions, then shows one section per covered source file with its coverage percentage, cyclomatic complexity, change risk and a `Covered by` list of the test files that cover it
- [Global Logs](references/global-logs.md) when Wallaby captures logs not tied to a single test; it shows log locations, runtime context, and logged messages

The linked [All Tests](references/all-tests.md), [Failing Tests](references/failing-tests.md), and [Coverage](references/coverage.md) reports can be pretty large. For specific results, prefer `grep` over reading the whole file. For example, to find all tests that mention `estimates sleet near freezing`:

```sh
grep -Pzo '(?sm)^### [^\n]*estimates sleet near freezing[^\n]*\n.*?(?=^### |^## |\z)' all-tests.md | tr '\0' '\n'
```

To find all tests in `tests/temperature.spec.ts`:

```sh
grep -Pzo '(?sm)^## tests/temperature\.spec\.ts[^\n]*\n.*?(?=^## |\z)' all-tests.md | tr '\0' '\n'
```

To find the coverage entry for `src/temperature.ts`:

```sh
grep -Pzo '(?sm)^## src/temperature\.ts[^\n]*\n.*?(?=^## |\z)' coverage.md | tr '\0' '\n'
```

### Inspect command

Use `npx -y @wallabyjs/cli inspect ...` to inspect a variable or expression at runtime. It is useful for debugging test errors, analyzing assertions, and understanding test behavior. The command evaluates the expression in every test execution context that reaches the selected source location, so one expression can produce many runtime values.

The command only works when Wallaby is already running for the same project and config. Start it first with `npx -y @wallabyjs/cli run --skill`, then use `inspect` for follow-up debugging.

Pass one or more inspection objects, each with a file path, a source location, and an expression. Multiple inspections can be included in the same command by passing additional inspection objects as separate arguments. The source location can be a code fragment, a line number, or a line and column. For example, to inspect the value of the `alerts` variable in `src/alerts.ts`:

```sh
npx -y @wallabyjs/cli inspect "{path:'src/alerts.ts',location:{fragment:'const alerts: WeatherAlert[] = [];'},expression:'alerts'}"
```

With fragment-based locations, the fragment acts both as file-search criteria and as the containing snippet used to locate the expression inside the file. Fragment-based locations are often a better fit for LLM/code agents because no line-number calculation is required.

A base64-encoded `fragment` avoids escaping special characters and newlines in multi-line fragments. The CLI decodes the fragment before searching the file:

```sh
npx -y @wallabyjs/cli inspect "{path:'src/alerts.ts',location:{fragment:'Ly8gdW5pcXVlIGNvZGUgZnJhZ21lbnQKY29uc3QgYWxlcnRzOiBXZWF0aGVyQWxlcnRbXSA9IFtdOw=='},expression:'alerts'}"
```

If the line number is known, use it instead of a fragment:

```sh
npx -y @wallabyjs/cli inspect "{path:'src/alerts.ts',location:{line:134},expression:'alerts'}"
```

If several occurrences of the expression are near the same line, add a column number to pick the closest match:

```sh
npx -y @wallabyjs/cli inspect "{path:'src/alerts.ts',location:{line:134,column:10},expression:'alerts'}"
```

To show only values produced by tests with a matching name in the main report, pass `--test` with the full or partial test name:

```sh
npx -y @wallabyjs/cli inspect "{path:'src/alerts.ts',location:{line:134},expression:'alerts'}" --test "alerts output / combined conditions"
```

The command prints a Markdown report like this; a non-zero exit code usually means the report contains failing tests or errors, though it may also mean the CLI or Wallaby itself failed:

- `Status`, `Mode`, `Summary`, `Fatal Error`, and `Global Errors` sections are the same as in the run command report
- `Runtime Values` shows captured values inline with the source file, line, expression, formatted value, and test that produced each value; if requested inspections could not be captured, it also shows warnings with the path, expression, location, and reason; if additional values are omitted, it links to the full [Runtime Values](references/runtime-values.md) report
- When `--test` is used, the main report filters runtime values by test name and links to the full unfiltered report when other values are available; uncaptured-inspection warnings are still shown because they describe requested inspection locations, not captured values from a specific test

The linked [Runtime Values](references/runtime-values.md) report can be pretty large. For specific results, prefer `grep` over reading the whole file. For example, to find all captured values for `src/alerts.ts`:

```sh
grep -Pzo '(?sm)^## src/alerts\.ts[^\n]*\n.*?(?=^## |\z)' runtime-values.md | tr '\0' '\n'
```

To find all runtime values produced by tests whose names mention `combined conditions`:

```sh
grep -Pzo '(?sm)^## [^\n]*\n.*?^- name: .*combined conditions.*\n.*?(?=^## |\z)' runtime-values.md | tr '\0' '\n'
```
