# codebase-analyzer

[![CI](https://github.com/adityawrk/codebase-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/adityawrk/codebase-analyzer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

Self-hosted CLI tool that produces comprehensive codebase analysis reports -- scoring, complexity metrics, test coverage analysis, git history insights, dependency auditing, architecture mapping, and more. No LLM dependency. All metrics are computed locally via static analysis and existing open-source tools.

**Point it at any repository. Get a scored report in seconds.**

---

## Features

- **Language Breakdown** -- LOC, file counts, and language percentages via [scc](https://github.com/boyter/scc)
- **Complexity Analysis** -- McCabe cyclomatic complexity per function using [tree-sitter](https://tree-sitter.github.io/) AST parsing
- **Test Analysis** -- Test file detection, coverage estimation, framework identification
- **Git Insights** -- Commit frequency, contributor stats, bus factor, churn hotspots
- **Dependency Audit** -- Package counts, outdated checks, known vulnerabilities (npm, Cargo, Go, pip)
- **Security Scanning** -- Secret detection via [gitleaks](https://github.com/gitleaks/gitleaks) (reports location only, never raw values)
- **Duplication Detection** -- Copy-paste analysis via [jscpd](https://github.com/kucherenko/jscpd)
- **Architecture Mapping** -- Import graph, layer analysis, circular dependency detection
- **Repository Health** -- README, CI, license, gitignore, branch hygiene scoring
- **Tech Stack Detection** -- Frameworks, libraries, and infrastructure identification
- **Environment Variables** -- Env var usage tracking across the codebase
- **Scoring and Grading** -- Weighted rubric producing A-F letter grades across five categories
- **Multiple Output Formats** -- Markdown reports or structured JSON conforming to a published schema

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- [bun](https://bun.sh/) package manager

The following external tools are **optional** -- the analyzer degrades gracefully when any of them are missing:

| Tool | Purpose | Install |
|------|---------|---------|
| [scc](https://github.com/boyter/scc) | Lines of code, language breakdown | `brew install scc` or [releases](https://github.com/boyter/scc/releases) |
| [jscpd](https://github.com/kucherenko/jscpd) | Copy-paste / duplication detection | `npm install -g jscpd` |
| [gitleaks](https://github.com/gitleaks/gitleaks) | Secret scanning | `brew install gitleaks` or [releases](https://github.com/gitleaks/gitleaks/releases) |

## Installation

### From source

```bash
git clone https://github.com/adityawrk/codebase-analyzer.git
cd codebase-analyzer
bun install
bun run build
```

### From npm

```bash
npm install -g codebase-analyzer
```

### Single binary

Build a standalone binary with no runtime dependencies:

```bash
bun run build:binary
```

## Usage

### Analyze a repository

```bash
# From source (dev mode)
bun run dev -- analyze /path/to/repo

# If installed globally
codebase-analyzer analyze /path/to/repo
```

### Output to a file

```bash
codebase-analyzer analyze /path/to/repo --output report.md
```

### JSON output

```bash
codebase-analyzer analyze /path/to/repo --format json --output report.json
```

JSON output conforms to [`schemas/report-v1.schema.json`](schemas/report-v1.schema.json).

### All options

| Flag | Description | Default |
|------|-------------|---------|
| `--format` | Output format: `markdown` or `json` | `markdown` |
| `--output` | Write report to file instead of stdout | stdout |
| `--offline` | Skip network-dependent checks | `false` |
| `--timeout` | Per-tool timeout in milliseconds | `60000` |
| `--include` | Glob patterns to include | all files |
| `--exclude` | Glob patterns to exclude | built-in defaults |
| `--follow-symlinks` | Follow symlinks within repo root | `false` |
| `--rubric` | Path to custom rubric YAML | built-in |
| `--max-file-size` | Max file size to analyze (bytes) | `1048576` |

## Report Sections

A generated report includes the following sections:

| Section | Description |
|---------|-------------|
| Summary and Grade | Overall score with letter grade (A-F) |
| Language Breakdown | LOC, file counts, language percentages |
| Folder Structure | Directory tree with purpose annotations |
| Test Analysis | Test file detection, coverage estimation, framework identification |
| Repository Health | README, CI, license, gitignore, branch hygiene |
| Complexity | McCabe cyclomatic complexity per function and file |
| Git Analysis | Commit frequency, contributor stats, churn hotspots |
| Dependencies | Package counts, outdated checks, known vulnerabilities |
| Security | Secret detection findings (file, line, rule -- never raw values) |
| Tech Stack | Frameworks, libraries, infrastructure detection |
| Environment Variables | Env var usage across the codebase |
| Duplication | Copy-paste detection with locations |
| Architecture | Import graph, layer analysis, circular dependency detection |

## Scoring

Five scoring categories, each weighted in [`rubric.yaml`](rubric.yaml):

| Category | Weight | What it measures |
|----------|--------|-----------------|
| Sizing | 10 | LOC distribution, file sizes, language balance |
| Testing | 25 | Test presence, coverage, framework usage |
| Complexity | 20 | Function and file complexity, deep nesting |
| Repo Health | 20 | README, CI, license, documentation |
| Structure | 25 | Directory organization, module boundaries |

Scores map to letter grades: **A** (85-100), **B** (70-84), **C** (55-69), **D** (35-54), **F** (0-34). When analysis is incomplete (below 60% of metrics available), the grade is reported as **INCOMPLETE** rather than producing a misleading score.

You can provide a custom rubric file to adjust weights for your team's priorities:

```bash
codebase-analyzer analyze /path/to/repo --rubric my-rubric.yaml
```

## Architecture

```
CLI (commander) --> Orchestrator --> RepositoryIndex (single-pass file inventory)
                                 --> Analyzers (12 modules, each receives index)
                                 --> Scoring Engine (rubric.yaml weights)
                                 --> Output Formatter (markdown or JSON)
```

- **RepositoryIndex** is built once and consumed by all analyzers. No duplicate filesystem traversal.
- **file-policy.ts** is the canonical include/exclude authority. External tools receive file lists from the index.
- **exec.ts** handles all child process spawning with `execFile` (argv arrays, never shell strings), enforced timeouts, and 50 MB output caps.
- All external tool failures degrade gracefully -- missing tools produce skipped sections, not crashes.

## Development

```bash
bun install                              # Install dependencies
bun run build                            # Compile TypeScript
bun run dev -- analyze /path/to/repo     # Run analyzer (dev mode)
bun test                                 # Run all tests
bun run test:golden                      # Golden output comparison
bun run update-golden                    # Regenerate golden fixtures
bun run lint                             # Run ESLint
bun run format                           # Run Prettier
bun run format:check                     # Check formatting without writing
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development workflow, code style guide, and PR process.

## Contributing

Contributions are welcome! Whether it is a bug report, feature request, documentation improvement, or code contribution -- all help is appreciated.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request. For major changes, please open an issue first to discuss what you would like to change.

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Security

For information about reporting security vulnerabilities, see [SECURITY.md](SECURITY.md).

## License

MIT License. See [LICENSE](LICENSE) for details.
