# Codebase Analyzer — Self-hosted Static Analysis CLI

A TypeScript CLI tool that produces reference-equivalent codebase analysis reports without LLM dependency. Orchestrates existing tools (scc, jscpd, gitleaks) + tree-sitter AST parsing to compute static metrics, then outputs scored markdown/JSON reports. 

## Stack
- TypeScript (strict mode, ES2022 target)
- Node.js 20+ (LTS)
- tree-sitter (via `node-tree-sitter` — C bindings, NOT Rust)
- External tools: `scc` (LOC), `jscpd` (duplication), `gitleaks` (secrets)
- Testing: Vitest + golden output fixtures
- Build: `bun build --compile` for single binary distribution

## Commands
```bash
bun install                              # Install dependencies
bun run build                            # Compile TypeScript
bun run dev -- analyze /path/to/repo     # Run analyzer (dev mode)
bun test                                 # Run all tests
bun run test:golden                      # Run golden output comparison tests
bun run update-golden                    # Regenerate golden output fixtures
```

## Architecture

**Orchestrator pattern:** A single `orchestrator.ts` sequences all analysis passes. Every analyzer receives a shared, immutable `RepositoryIndex` — analyzers never scan the filesystem independently.

```
CLI (commander) → Orchestrator → RepositoryIndex (single-pass)
                              → Analyzers (12 modules, each receives index)
                              → Scoring Engine (rubric.yaml weights)
                              → Output Formatter (markdown or JSON)
```

**Core invariants:**
- `RepositoryIndex` is built once, consumed by all analyzers. No re-traversal.
- `file-policy.ts` is the canonical include/exclude authority. External tools receive file lists FROM the index.
- `exec.ts` handles ALL child process spawning. Uses `execFile` (argv array), never `exec(string)`.
- All external tool output is capped at 50MB. Timeouts are enforced. Missing tools degrade gracefully.

## Key Directories
- `src/cli/` — CLI entry point (commander)
- `src/core/` — Orchestrator, RepositoryIndex, file-policy, exec, types
- `src/analyzers/` — 12 analyzer modules (sizing, structure, testing, git, dependencies, security, repo-health, tech-stack, env-vars, complexity, duplication, architecture)
- `src/analyzers/adapters/` — Per-ecosystem dependency adapters (npm, cargo, go, pypi)
- `src/scoring/` — Rubric engine + aggregator
- `src/output/` — Markdown and JSON formatters
- `src/utils/` — tree-sitter wrapper
- `spec/` — Versioned metric definitions (`metrics-v1.md`)
- `schemas/` — JSON Schema for report output (`report-v1.schema.json` — stable public contract)
- `data/` — Lookup tables (package purposes, service registry)
- `tests/fixtures/` — Benchmark repos pinned at immutable SHAs (`benchmark-manifest.json`)
- `tests/golden/` — Expected output snapshots per fixture repo

## Conventions
- Use `bun` as package manager. Never `npm` or `yarn`.
- Strict TypeScript: `strict: true`, no `any` unless wrapping external tool output with explicit cast.
- File naming: `kebab-case.ts`. No version suffixes — use git history.
- Imports: use relative paths within `src/`, never path aliases.
- Error handling: external tool failures return `{ tool, exitCode, stderr, timedOut }`, never throw.
- Tests: Vitest. Co-locate unit tests as `*.test.ts` next to source. Golden output tests in `tests/golden/`.
- Conventional commits: `feat(analyzer):`, `fix(scoring):`, `test(golden):`, etc.
- **Git author**: Always use `Aditya Patni <adityapatni2106@gmail.com>`. Do NOT add `Co-Authored-By` trailers.

## Security Policy
- **Repos are untrusted input.** Every file path goes through `file-policy.ts`. No `eval()` on repo content. No shell interpolation.
- **Symlinks:** do NOT follow by default. `--follow-symlinks` enables following only within repo root, with cycle detection.
- **Secrets:** gitleaks findings report `{ file, line, ruleId }` only. Raw secret values are NEVER in output. `sanitize()` gate before any Phase 2 LLM calls.
- **Binary detection:** skip files where first 8KB contains null bytes.

## Scoring
- Weights in `rubric.yaml`. Default total = 100.
- Partial data: normalize by available weights. `analysisCompleteness < 60%` → grade = `INCOMPLETE`.
- Every metric in JSON output includes `"status": "computed" | "skipped" | "error"` with reason.
- JSON output conforms to `schemas/report-v1.schema.json`. Breaking changes require version bump.

## Agent Policy
- **Always use Opus model** for all agent/Task invocations. Never use Sonnet or Haiku.
- **Use agents aggressively** — launch agents for any non-trivial task. Agents protect the main context window.
- **Prefer parallel agents** — launch one agent per independent task simultaneously.
- **Run agents in background** for long-running tasks so the main conversation stays responsive.
- **Prefer custom agents** from `.claude/agents/` when their description matches:
  - `tree-sitter-expert` — AST query writing, grammar debugging, complexity calculation
  - `tool-adapter-writer` — wrapping external tools with exec.ts pattern
- **Create specialized agents** when a recurring task pattern emerges.

### When to use agents
- **Always**: Writing analyzers, tests, adapters, or any module touching tree-sitter
- **Always**: Research/exploration that would flood the main context
- **Always**: Long tasks (>5 tool calls) — run in background
- **Avoid agents only for**: Single-file reads, quick git commands, simple questions

## Reference Reports
Three reference reports are the format target (all in `stored locally, not in repo`):
- `ai-startup-tycoon_codebase_analysis.md` — TS/React, 54K LOC
- `golden-era_codebase_analysis.md` — TS/React, 39K LOC
- `resolve_codebase_analysis.md` — Kotlin/Android, 25K LOC

## Benchmark Repos
Pinned in `tests/fixtures/benchmark-manifest.json`. CI rejects unpinned SHAs (`^[0-9a-f]{40}$`).

## LLM Model Policy
- NEVER use models older than: **ChatGPT 5 series** (OpenAI), **Claude 4.6** (Anthropic), **Gemini 3 series** (Google).
- Phase 2 LLM calls (optional): use `claude-sonnet-4-6` for cost efficiency, `claude-opus-4-6` for quality.

## IMPORTANT Warnings
- **Scope contract:** No dashboard. No web server. No auth. No job queue. This is a CLI tool. Period.
- **Do NOT reimplement** what scc, jscpd, or gitleaks already do. Wrap them via exec.ts.
- **tree-sitter core is C**, not Rust. All language bindings call the same C library. Do not cite Rust as a reason for anything.
- **McCabe complexity:** `else` does NOT increment. `catch`, ternary, `&&`/`||` DO increment. See `spec/metrics-v1.md` for the authoritative table.
- **Do NOT create** `_backup`, `_old`, `_v2` copies of files. Use git history.
- **Never commit** `.env` files, API keys, or benchmark repo credentials.
- The plan is in `REVISED-PLAN.md`. It is the scope contract. Read it before proposing architectural changes.
