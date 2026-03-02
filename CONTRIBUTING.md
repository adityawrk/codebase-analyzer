# Contributing

## Setup

```bash
git clone https://github.com/adityawrk/codebase-analyzer.git
cd codebase-analyzer
bun install
```

## Development workflow

1. Create a branch from `main`.
2. Make your changes. Run the full test suite before committing:
   ```bash
   bun run build        # TypeScript compile check
   bun test             # unit tests
   bun run test:golden  # golden output comparison
   ```
3. If your change affects analyzer output, regenerate golden fixtures:
   ```bash
   bun run update-golden
   ```
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat(analyzer): add Python import graph support
   fix(scoring): handle missing rubric weights gracefully
   test(golden): update fixtures for new complexity format
   ```
5. Open a pull request against `main`. Describe what changed and why.

## Guidelines

- Use `bun` as the package manager. Never `npm` or `yarn`.
- TypeScript strict mode -- no `any` unless wrapping external tool output with an explicit cast.
- File naming: `kebab-case.ts`.
- All child process spawning goes through `src/core/exec.ts`. Never use `exec(string)`.
- External tool failures must degrade gracefully, never throw.
- Benchmark repos are pinned at immutable SHAs. Do not update without discussion.
