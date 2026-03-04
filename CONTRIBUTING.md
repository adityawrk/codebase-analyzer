# Contributing to codebase-analyzer

Thank you for your interest in contributing! This document provides guidelines and information to help you get started.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior via the contact information in that file.

## How to Contribute

### Reporting Bugs

Before creating a bug report, please check the [existing issues](https://github.com/adityawrk/codebase-analyzer/issues) to avoid duplicates.

When filing a bug report, include:

- Your Node.js version (`node --version`) and OS
- The command you ran and the full error output
- The repository you analyzed (or a minimal reproduction case)
- Whether external tools (scc, jscpd, gitleaks) are installed and their versions

Use the [bug report template](https://github.com/adityawrk/codebase-analyzer/issues/new?template=bug_report.md) when opening a new issue.

### Suggesting Features

Feature requests are welcome. Use the [feature request template](https://github.com/adityawrk/codebase-analyzer/issues/new?template=feature_request.md) and describe:

- The problem you are trying to solve
- Your proposed solution
- Any alternatives you have considered

### Submitting Code

1. Fork the repository and create your branch from `master`.
2. Make your changes following the guidelines below.
3. Add or update tests for your changes.
4. Run the full test suite to ensure nothing is broken.
5. Submit a pull request.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- [bun](https://bun.sh/) -- used as the package manager (never npm or yarn)
- Optional: [scc](https://github.com/boyter/scc), [jscpd](https://github.com/kucherenko/jscpd), [gitleaks](https://github.com/gitleaks/gitleaks) for full integration testing

### Getting started

```bash
git clone https://github.com/adityawrk/codebase-analyzer.git
cd codebase-analyzer
bun install
```

### Running the project

```bash
bun run build                            # Compile TypeScript
bun run dev -- analyze /path/to/repo     # Run in dev mode
```

### Running tests

```bash
bun test                                 # Run all unit tests
bun run test:golden                      # Golden output comparison tests
bun run test:coverage                    # Tests with coverage report
```

If your change affects analyzer output, regenerate golden fixtures:

```bash
bun run update-golden
```

### Linting and formatting

```bash
bun run lint                             # Run ESLint
bun run format                           # Run Prettier (writes changes)
bun run format:check                     # Check formatting without writing
```

## Code Style

### TypeScript

- **Strict mode**: `strict: true` is enforced. No `any` unless wrapping external tool output with an explicit cast.
- **File naming**: `kebab-case.ts`. No version suffixes -- use git history.
- **Imports**: Relative paths within `src/`. No path aliases.
- **Target**: ES2022.

### Architecture rules

- **RepositoryIndex** is built once and consumed by all analyzers. Analyzers must never scan the filesystem independently.
- **file-policy.ts** is the canonical include/exclude authority. External tools receive file lists from the index.
- **exec.ts** handles all child process spawning. Always use `execFile` with an argv array, never `exec` with a string. All spawned processes have enforced timeouts and output caps.
- **External tool failures** must degrade gracefully and return `{ tool, exitCode, stderr, timedOut }`. Never throw on tool failure.
- **Security**: Repos are untrusted input. Every file path goes through `file-policy.ts`. No `eval()` on repo content. No shell interpolation. Symlinks are not followed by default.

### Tests

- Framework: [Vitest](https://vitest.dev/)
- Co-locate unit tests as `*.test.ts` next to their source files.
- Golden output tests live in `tests/golden/`.
- Benchmark repos are pinned at immutable SHAs in `tests/fixtures/benchmark-manifest.json`. Do not update pinned SHAs without discussion.

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Every commit message must follow this format:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | When to use |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes only |
| `test` | Adding or updating tests |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `chore` | Build process, tooling, or dependency changes |
| `ci` | CI/CD configuration changes |

### Scopes

Common scopes: `analyzer`, `scoring`, `output`, `cli`, `core`, `golden`, `deps`, `security`.

### Examples

```
feat(analyzer): add Python import graph support
fix(scoring): handle missing rubric weights gracefully
test(golden): update fixtures for new complexity format
docs(readme): add prerequisites section
refactor(core): extract file-policy from repository-index
```

## Pull Request Process

1. Fill out the PR template completely.
2. Ensure all CI checks pass (TypeScript compilation, unit tests).
3. Update documentation if your change affects user-facing behavior.
4. If your change affects analyzer output, include the updated golden fixtures in the same PR.
5. Keep PRs focused. One logical change per PR.
6. PRs are squash-merged. Your PR title will become the commit message, so write it as a conventional commit.

## Project Structure

```
src/
  cli/          CLI entry point (commander)
  core/         Orchestrator, RepositoryIndex, file-policy, exec, types
  analyzers/    12 analyzer modules
    adapters/   Per-ecosystem dependency adapters (npm, cargo, go, pypi)
  scoring/      Rubric engine and aggregator
  output/       Markdown and JSON formatters
  utils/        tree-sitter wrapper
spec/           Versioned metric definitions
schemas/        JSON Schema for report output (stable public contract)
data/           Lookup tables (package purposes, service registry)
tests/          Test fixtures and golden output snapshots
```

## Questions?

If you have questions about contributing, open a [discussion](https://github.com/adityawrk/codebase-analyzer/discussions) or file an issue. There are no bad questions.
