# codebase-analyzer

Self-hosted CLI tool that produces codebase analysis reports with scoring, complexity metrics, test coverage analysis, git history insights, dependency auditing, and architecture mapping. No LLM dependency -- all metrics are computed via static analysis and existing open-source tools.

## Stack

- **TypeScript** (strict mode, ES2022)
- **Node.js 20+** (LTS)
- **tree-sitter** -- AST parsing for complexity and import graph analysis
- **scc** -- lines of code, language breakdown
- **jscpd** -- copy-paste / duplication detection
- **gitleaks** -- secret scanning

## Installation

```bash
bun install
bun run build
```

Requires [bun](https://bun.sh) as the package manager. External tools (`scc`, `jscpd`, `gitleaks`) are optional -- the analyzer degrades gracefully when any tool is missing.

## Usage

```bash
bun run dev -- analyze /path/to/repo
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--format` | Output format: `markdown` or `json` | `markdown` |
| `--output` | Write report to file instead of stdout | - |
| `--offline` | Skip network-dependent checks | `false` |
| `--timeout` | Per-tool timeout in milliseconds | `60000` |
| `--include` | Glob patterns to include | - |
| `--exclude` | Glob patterns to exclude | - |
| `--follow-symlinks` | Follow symlinks within repo root | `false` |
| `--rubric` | Path to custom rubric YAML | built-in |
| `--max-file-size` | Max file size to analyze (bytes) | `1048576` |

### Single binary

```bash
bun build --compile
```

Produces a standalone binary with no runtime dependencies.

## Report Sections

Reports include the following sections:

- **Summary and Grade** -- overall score with letter grade
- **Language Breakdown** -- LOC, file counts, language percentages
- **Folder Structure** -- directory tree with purpose annotations
- **Test Analysis** -- test file detection, coverage estimation, framework identification
- **Repository Health** -- README, CI, license, gitignore, branch hygiene
- **Complexity** -- McCabe cyclomatic complexity per function and file
- **Git Analysis** -- commit frequency, contributor stats, churn hotspots
- **Dependencies** -- package counts, outdated checks, known vulnerabilities
- **Security** -- secret detection findings (file, line, rule -- never raw values)
- **Tech Stack** -- frameworks, libraries, infrastructure detection
- **Environment Variables** -- env var usage across the codebase
- **Duplication** -- copy-paste detection with locations
- **Architecture** -- import graph, layer analysis, circular dependency detection

## Scoring

Five scoring categories, each weighted in `rubric.yaml`:

| Category | What it measures |
|----------|-----------------|
| Sizing | LOC distribution, file sizes, language balance |
| Testing | Test presence, coverage, framework usage |
| Complexity | Function and file complexity, deep nesting |
| RepoHealth | README, CI, license, documentation |
| Structure | Directory organization, module boundaries |

Scores map to letter grades A through F. Total weights default to 100. When analysis is incomplete (below 60% of metrics available), the grade is reported as `INCOMPLETE` rather than misleading.

JSON output conforms to `schemas/report-v1.schema.json`.

## Development

```bash
bun install                          # install dependencies
bun run build                        # compile TypeScript
bun run dev -- analyze /path/to/repo # run in dev mode
bun run test                         # run all tests
bun run test:golden                  # golden output comparison
bun run update-golden                # regenerate golden fixtures
```

## License

MIT License. See [LICENSE](LICENSE) for details.
