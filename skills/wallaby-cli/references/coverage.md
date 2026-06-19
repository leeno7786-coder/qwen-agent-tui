# Coverage report

The report starts with a fixed top-level heading:

```md
# Coverage
```

In project mode, the file uses this shape:

```md
Top 5 files by change risk:
- <source-file-path> (Change Risk: <number>, Coverage: <percent>%, Cyclomatic Complexity: <number>)
- ...

Metric guide:
- Coverage: percentage of coverable code ranges covered by tests.
- Cyclomatic Complexity: sum of per-function cyclomatic complexity values in the file, counting each function once.
- Change Risk: CR = C^2 * (1 - P / 100)^3 + C, rounded to one decimal, where C is Cyclomatic Complexity and P is file Coverage percentage. Higher values indicate riskier files to change.

## <source-file-path>

- Coverage: <percent>%
- Cyclomatic Complexity: <number>
- Change Risk: <number>
- Covered by:
  - <test-file-path>
  - ...
```

In exclusive mode, the file starts with this note before the file sections:

```md
Top 5 files by change risk:
- <source-file-path> (Change Risk: <number>, Coverage: <percent>%, Cyclomatic Complexity: <number>)
- ...

Metric guide:
- Coverage: percentage of coverable code ranges covered by tests.
- Cyclomatic Complexity: sum of per-function cyclomatic complexity values in the file, counting each function once.
- Change Risk: CR = C^2 * (1 - P / 100)^3 + C, rounded to one decimal, where C is Cyclomatic Complexity and P is file Coverage percentage. Higher values indicate riskier files to change.

Note: not all files are included in this report because Wallaby is running tests only from specific test locations:
- <test-location>
- ...
```

Format details:

- The top change-risk list is optional. It appears only when at least one covered file has change-risk data.
- The top change-risk list is plain text under `# Coverage`, not a heading.
- The top change-risk list shows up to 5 files, sorted by change risk descending. Ties are sorted by cyclomatic complexity descending, then coverage ascending, then file path.
- Each top change-risk entry includes the source file path, change risk, coverage percentage, and cyclomatic complexity when Wallaby has complexity data for that file.
- `Metric guide:` is a plain text label, not a heading.
- The exclusive-mode note is optional. It is a plain text line, not a heading.
- Each listed test location is a bullet under that note.
- `## <source-file-path>` starts one covered source-file entry.
- Source-file entries are sorted from lowest coverage to highest coverage. Ties are sorted by file path.
- `- Coverage:` is always present, uses the source-file coverage percentage.
- `- Cyclomatic Complexity:` is present when Wallaby has function complexity data for the source file.
- `- Change Risk:` is present when Wallaby has enough data to calculate it from Cyclomatic Complexity and Coverage.
- `- Covered by:` is always present, followed by an indented bullet list of test file paths.
- The formatter preserves the collected order of the `Covered by` test file list. It does not alphabetize it.

Do not treat exclusive-mode coverage as whole-project coverage.
