# Metrics Specification v1

Authoritative definitions for all metrics computed by the Codebase Analyzer.
Breaking changes to metric semantics require a version bump (metrics-v2.md).

---

## 1. Sizing Metrics

### Total Files
- **Definition**: Count of all tracked, non-binary files in the repository after applying file-policy filters.
- **Source**: `RepositoryIndex`
- **Binary detection**: A file is considered binary if the first 8,192 bytes contain a null byte (`0x00`).
- **Excludes**: Files matched by `.gitignore`, default excludes (node_modules, .git, vendor, etc.), and binary files.

### Total Lines
- **Definition**: Sum of all lines across all tracked files, including blank lines and comment lines.
- **Source**: `scc` output (`Lines` column) or raw line count fallback.
- **Counting rule**: A line is any sequence of characters terminated by `\n`, `\r\n`, or `\r`. A final line without a terminator still counts as one line.

### Code Lines
- **Definition**: Lines of code excluding blank lines and comment-only lines.
- **Source**: `scc` output (`Code` column).
- **Note**: Inline comments on code lines are counted as code, not comments.

### Comment Lines
- **Definition**: Lines that contain only comments (single-line or part of a block comment with no code on the same line).
- **Source**: `scc` output (`Comments` column).

### Blank Lines
- **Definition**: Lines containing only whitespace characters.
- **Source**: `scc` output (`Blanks` column).

### Comment Ratio
- **Definition**: `commentLines / (codeLines + commentLines)`
- **Range**: 0.0 to 1.0

### Language Breakdown
- **Definition**: Per-language statistics derived from file extensions.
- **Fields per language**:
  - `language`: Canonical language name (e.g., "TypeScript", "Python")
  - `fileCount`: Number of files for this language
  - `codeLines`: Lines of code for this language
  - `percentage`: `codeLines / totalCodeLines * 100`, rounded to one decimal place
- **Source**: `scc` output grouped by language.
- **Ordering**: Descending by `codeLines`.

### God Files
- **Definition**: Files exceeding the god file threshold in lines of code.
- **Threshold**: 500 LOC (code lines, not total lines).
- **Fields per god file**:
  - `path`: Relative path from repo root
  - `codeLines`: Number of code lines
  - `language`: Detected language
- **Ordering**: Descending by `codeLines`.

---

## 2. Test Metrics

### Test Files
- **Definition**: Count of files matching test file patterns.
- **Patterns** (case-insensitive):
  - `*.test.*` (e.g., `foo.test.ts`, `bar.test.py`)
  - `*.spec.*` (e.g., `foo.spec.js`)
  - `*_test.*` (e.g., `foo_test.go`, `bar_test.py`)
  - `*_spec.*` (e.g., `foo_spec.rb`)
  - Files inside `__tests__/` directories
  - Files inside `test/` or `tests/` directories matching source extensions
- **Excludes**: Test fixtures, test helpers, and test configuration files (e.g., `jest.config.ts`, `vitest.config.ts`, `conftest.py`).

### Test Lines
- **Definition**: Total lines (all lines, including blank/comment) in test files.

### Test Code Lines
- **Definition**: Code lines only in test files.

### Test/Code Ratio
- **Definition**: `testCodeLines / (totalCodeLines - testCodeLines) * 100`
- **Unit**: Percentage (e.g., 25.0 means test code is 25% of production code).
- **Edge case**: If `totalCodeLines - testCodeLines == 0`, ratio is `0`.

### Test Frameworks
- **Definition**: List of detected test frameworks.
- **Detection methods**:
  - **npm ecosystem**: Check `devDependencies` and `dependencies` in `package.json` for: `vitest`, `jest`, `mocha`, `ava`, `tap`, `jasmine`, `cypress`, `playwright`, `@testing-library/*`
  - **Python**: Check for `pytest` in `requirements*.txt`, `setup.py`, `pyproject.toml`; presence of `unittest` imports
  - **Go**: Presence of `*_test.go` files implies `go test`
  - **Rust**: Presence of `#[cfg(test)]` or `#[test]` annotations
  - **Java/Kotlin**: Check for JUnit, TestNG in `build.gradle`, `pom.xml`
  - **Import scanning**: Scan first 50 lines of test files for framework imports as fallback

### Coverage Config
- **Definition**: Boolean indicating whether coverage configuration is present.
- **Detection**: Presence of any of:
  - `jest.config.*` with `coverageThreshold` or `collectCoverage`
  - `vitest.config.*` with `coverage` section
  - `.nycrc`, `.nycrc.json`, `.nycrc.yml`
  - `.coveragerc`, `setup.cfg` with `[coverage:run]`
  - `coverage` section in `pyproject.toml`
  - `.codecov.yml`, `codecov.yml`
  - `Makefile` with `coverage` target (heuristic)

---

## 3. Complexity Metrics (McCabe Cyclomatic Complexity)

### Definition
McCabe cyclomatic complexity measures the number of linearly independent paths through a function's control flow graph.

### Calculation

Start at **1** for each function/method. Increment for each of the following:

| Construct | Increment | Notes |
|-----------|-----------|-------|
| `if` | +1 | Includes `else if` (because it contains an `if`) |
| `else` | **0** | Does NOT increment complexity |
| `else if` | +1 | Counted as the `if` inside the `else if` |
| `for` | +1 | All variants: C-style, range-based |
| `for...of` | +1 | |
| `for...in` | +1 | |
| `while` | +1 | |
| `do...while` | +1 | |
| `case` (in switch) | +1 | Each `case` label. `default` does NOT increment. The `switch` itself does NOT increment. |
| `catch` | +1 | |
| Ternary `? :` | +1 | Each ternary operator |
| Logical AND `&&` | +1 | Short-circuit operator |
| Logical OR `\|\|` | +1 | Short-circuit operator |
| Nullish coalescing `??` | +1 | |
| Optional chaining `?.` | **0** | Does NOT increment complexity |
| `guard` (Swift) | +1 | Treated like `if` |
| `when` (Kotlin) | +1 per branch | Each branch, not the `when` itself |
| Pattern match arm | +1 per arm | Rust `match`, Scala `match` |

### IMPORTANT Clarifications
- **`else` does NOT increment.** This is the McCabe standard. An `if/else` has complexity 2 (1 base + 1 for `if`), not 3.
- **`else if` increments by 1** because it is syntactically `else { if (...) }` -- the `if` inside it is what counts.
- **`switch`** itself does not increment. Only each `case` label does. `default` does not increment.
- **Logical operators** in conditions each add 1: `if (a && b || c)` adds 3 (1 for `if`, 1 for `&&`, 1 for `||`).
- **Nested ternaries** each count: `a ? b : c ? d : e` adds 2.
- **Lambda/arrow functions** are separate functions with their own base complexity of 1.

### Per-Function Complexity
- **Definition**: Complexity score for each function, method, or arrow function.
- **Fields**:
  - `name`: Function name (or `<anonymous>` for unnamed functions, `<arrow>` for arrow functions)
  - `filePath`: Relative path from repo root
  - `line`: Starting line number (1-indexed)
  - `complexity`: McCabe complexity score
- **Minimum**: 1 (a function with no branches)

### Per-File Average Complexity
- **Definition**: Arithmetic mean of all function complexities in a file.
- **Edge case**: Files with no functions have no entry (not zero).

### Repo Average Complexity
- **Definition**: Arithmetic mean of all per-function complexities across the entire repository.
- **Edge case**: Repos with no detected functions report `null`.

### Complexity Hotspots
- **Definition**: Top 10 functions by complexity score, descending.
- **Fields**: Same as per-function complexity.
- **Tie-breaking**: By file path (alphabetical), then by line number (ascending).

### Supported Languages for Complexity
Languages with tree-sitter grammars and complexity query support:
- TypeScript / TSX
- JavaScript / JSX
- Python
- Go
- Rust
- Java
- Kotlin
- C / C++
- C#
- Ruby
- PHP
- Swift

---

## 4. Repo Health Checks

Each check is a boolean presence test. Checks are independent.

| Check | Files Searched | Notes |
|-------|---------------|-------|
| **README** | `README.md`, `README`, `README.rst`, `README.txt` | Root directory only |
| **LICENSE** | `LICENSE`, `LICENSE.md`, `LICENSE.txt`, `LICENCE`, `LICENCE.md`, `LICENCE.txt`, `COPYING` | Root directory only. British spelling included. |
| **CI** | `.github/workflows/*.yml`, `.github/workflows/*.yaml`, `.gitlab-ci.yml`, `Jenkinsfile`, `.circleci/config.yml`, `.travis.yml`, `azure-pipelines.yml`, `bitbucket-pipelines.yml` | Any match = true |
| **CONTRIBUTING** | `CONTRIBUTING.md`, `CONTRIBUTING` | Root directory only |
| **.gitignore** | `.gitignore` | Root directory only |
| **.editorconfig** | `.editorconfig` | Root directory only |
| **Dockerfile** | `Dockerfile`, `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml` | Any match = true. Searches root and one level deep. |
| **Security Policy** | `SECURITY.md`, `.github/SECURITY.md` | |
| **Code of Conduct** | `CODE_OF_CONDUCT.md` | Root directory only |
| **Changelog** | `CHANGELOG.md`, `CHANGELOG`, `CHANGES.md`, `HISTORY.md` | Root directory only |

### Output per Check
- `name`: Check identifier (e.g., `"readme"`, `"license"`)
- `present`: Boolean
- `path`: Relative path of the matched file (only if `present` is true)
- `note`: Optional human-readable note (e.g., `"MIT License detected"`)

---

## 5. Structure Metrics

### Folder Tree
- **Definition**: Recursive directory listing of the repository, annotated with file counts per folder.
- **Format**: Indented text representation.
- **Excludes**: Directories excluded by file-policy (node_modules, .git, etc.).
- **Annotation**: Each directory shows `(N files)` where N is the count of direct children files (not recursive).

### Max Depth
- **Definition**: The deepest nesting level of any tracked file, relative to the repo root.
- **Counting**: Root directory = depth 0. `src/core/types.ts` = depth 2.

### Top-Level Folders
- **Definition**: Names of all directories that are direct children of the repo root.
- **Excludes**: Hidden directories (starting with `.`) unless they are meaningful (e.g., `.github`).

### Files Per Folder (Average)
- **Definition**: `totalTrackedFiles / totalTrackedDirectories`
- **Note**: Only directories containing at least one tracked file are counted.

---

## 6. Duplication Metrics

### Source
- **Tool**: `jscpd` (external, via `exec.ts`)
- **Configuration**: Minimum 5 lines, minimum 50 tokens per clone.

### Metrics
- `duplicateLines`: Total lines involved in duplication
- `duplicatePercentage`: `duplicateLines / totalLines * 100`
- `clones`: Array of clone pairs, each with:
  - `firstFile`, `firstStartLine`, `firstEndLine`
  - `secondFile`, `secondStartLine`, `secondEndLine`
  - `lines`: Number of duplicated lines
  - `tokens`: Number of duplicated tokens

---

## 7. Security Metrics

### Source
- **Tool**: `gitleaks` (external, via `exec.ts`)

### Metrics
- `secretsFound`: Count of detected secrets/credentials
- `findings`: Array of findings, each with:
  - `file`: Relative path
  - `line`: Line number
  - `ruleId`: Gitleaks rule identifier (e.g., `generic-api-key`)
- **IMPORTANT**: Raw secret values are NEVER included in output. Only file, line, and ruleId.

---

## 8. Git Metrics

### Metrics
- `totalCommits`: Total number of commits on the default branch
- `contributors`: Count of unique commit authors (by email)
- `firstCommitDate`: ISO 8601 date of the earliest commit
- `lastCommitDate`: ISO 8601 date of the most recent commit
- `activeDays`: Count of unique dates with at least one commit
- `topContributors`: Top 10 contributors by commit count, each with `name`, `email`, `commits`

---

## 9. Dependency Metrics

### Metrics
- `totalDependencies`: Count of declared dependencies
- `directDependencies`: Count of direct (non-dev) dependencies
- `devDependencies`: Count of dev/test dependencies
- `ecosystems`: Detected package ecosystems (npm, cargo, go, pypi, maven, gradle)
- `packageManager`: Detected package manager (bun, npm, yarn, pnpm, cargo, go, pip, poetry)

---

## Metric Status Convention

Every metric section in the JSON output includes a `meta` object:

```json
{
  "meta": {
    "status": "computed",
    "reason": null,
    "durationMs": 142
  }
}
```

- `status`: One of `"computed"`, `"skipped"`, `"error"`
  - `computed`: Metric was successfully calculated
  - `skipped`: Metric was intentionally not computed (e.g., tool not installed, no relevant files)
  - `error`: Metric computation failed unexpectedly
- `reason`: Null when `status` is `"computed"`. Human-readable explanation otherwise.
- `durationMs`: Wall-clock milliseconds for this analysis pass.
