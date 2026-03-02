# Codebase Analysis Tool — Revised Plan

*Revised March 2026, based on multi-agent adversarial review of original plan*

---

## Critical Findings from Plan Review

### Finding 1: The Original Plan Is Overscoped by 10x

The original plan proposes 50-75K LOC over 5-6 months. Three independent analyses converge on the same conclusion: this is **three products disguised as one** (CLI analyzer + Web API + React dashboard), only the CLI analyzer matters, and even that scope is inflated by reimplementing solved problems.

### Finding 2: ~60% of the Work Already Exists

The existing `analyze-codebase-improved.sh` (2,800 lines) already handles 6 of 9 proposed analyzer modules: sizing, testing, git, security (partial), repo health, and external dependencies. Only 3 modules require genuinely new work: cyclomatic complexity, architecture/import graph, and duplication detection.

### Finding 3: The "Zero LLM" Value Prop Has a Ceiling

| Category | % of Proximal Report | Achievable Without LLM? |
|----------|---------------------|------------------------|
| Static metrics (LOC, git, deps, tests) | 35-40% | Yes — fully computable |
| Heuristic-approximable (tech stack, patterns) | 10-15% | Partially — with lookup tables |
| LLM-required (architecture narrative, test classification) | 48-53% | No — these need semantic understanding |

However, **55-60% of the user VALUE** is in the computable sections (git analysis, tech stack, dependency health are highly actionable). 40% of LLM content is low-value filler (executive summaries, generic strength/weakness narratives).

### Finding 4: Rust Is the Wrong Language Choice

The original plan's three arguments for Rust are respectively:
- **"tree-sitter is Rust-native"** — Incorrect. tree-sitter core is C. All bindings (Rust, Node, Python) call the same C library.
- **"Performance for millions of repos"** — Premature. The bottleneck is I/O, not language speed. A TS orchestrator calling scc/semgrep is within 20-30% of pure Rust.
- **"Training data value"** — Rationalization. A half-finished Rust codebase written by a learning developer is less valuable than a complete, well-tested TypeScript codebase.

A TypeScript-proficient developer writing TypeScript produces ~2x the output vs learning Rust.

### Finding 5: Revenue Paths Are Unvalidated

Zero buyer conversations have occurred. The "AI-era metrics" differentiator either requires LLMs (contradicting the zero-API-cost value prop) or is indistinguishable from what SonarQube/CodeClimate already produce. The triple monetization claim is wishful thinking.

---

## Revised Strategy: Two-Phase Approach

### Phase 1: MVP in TypeScript (4 weeks, ~4-6K LOC)

**Goal:** Produce Proximal-equivalent output for all computable sections, as a CLI tool, at $0/run.

**Architecture: TypeScript Orchestrator + Existing Tools**

```
codebase-analyzer/
├── src/
│   ├── cli/
│   │   └── index.ts              # CLI entry (commander)
│   ├── core/
│   │   ├── orchestrator.ts       # Sequences all analysis passes
│   │   ├── repo-index.ts         # Shared RepositoryIndex: file inventory, language
│   │   │                         # classification, .gitignore, manifest map, git meta
│   │   ├── file-policy.ts        # Canonical include/exclude rules (see File Policy below)
│   │   ├── config.ts             # Configurable scoring rubric (YAML)
│   │   ├── types.ts              # Shared types for analysis results
│   │   └── exec.ts               # Safe child process wrapper (see Execution Policy below)
│   ├── analyzers/
│   │   ├── sizing.ts             # Wraps scc for LOC/language breakdown
│   │   ├── structure.ts          # Directory tree with file counts
│   │   ├── testing.ts            # Test file detection, ratios, framework detection
│   │   ├── git.ts                # Git history analysis (simple-git or shell)
│   │   ├── dependencies.ts       # Parse package.json/Cargo.toml/go.mod + registry checks
│   │   ├── security.ts           # Wraps gitleaks + custom regex patterns
│   │   ├── repo-health.ts        # README, CI, license, gitignore quality
│   │   ├── tech-stack.ts         # Dependency manifest parsing + lookup table for top 500 packages
│   │   ├── env-vars.ts           # Environment variable inventory
│   │   ├── complexity.ts         # tree-sitter AST: cyclomatic complexity per function
│   │   ├── duplication.ts        # Wraps jscpd for clone detection
│   │   └── architecture.ts       # tree-sitter AST: import graph, circular deps, pattern detection
│   ├── scoring/
│   │   ├── rubric.ts             # Configurable weights/thresholds
│   │   └── aggregator.ts         # Combine analyzer outputs → overall score + grade
│   ├── output/
│   │   ├── markdown.ts           # Proximal-format markdown report
│   │   └── json.ts               # Machine-readable JSON output
│   └── utils/
│       └── tree-sitter.ts        # tree-sitter wrapper using node-tree-sitter
├── spec/
│   └── metrics-v1.md             # Versioned metric spec with exact formulas (see below)
├── data/
│   ├── package-purposes.json     # Lookup table: npm/pypi/cargo package → purpose description
│   └── service-registry.json     # Lookup table: common services → setup requirements
├── tests/
│   ├── fixtures/                  # Pinned benchmark repos (git submodules at specific commits)
│   └── golden/                    # Expected output snapshots per fixture repo
├── schemas/
│   └── report-v1.schema.json     # JSON Schema for report output (stable public contract)
├── package.json
├── tsconfig.json
└── rubric.yaml                   # Default scoring configuration
```

### RepositoryIndex: Single-Pass File Inventory

All analyzers consume a shared, immutable `RepositoryIndex` built once at the start:

```typescript
interface RepositoryIndex {
  root: string;                          // Absolute path to repo root
  files: FileEntry[];                    // All included files (post-filtering)
  filesByLanguage: Map<string, FileEntry[]>;
  manifests: ManifestMap;                // package.json, Cargo.toml, go.mod, etc.
  gitMeta: { isRepo: boolean; remotes: string[]; headCommit: string };
  config: AnalysisConfig;
}
```

Analyzers receive this index — they never re-scan the filesystem independently. This ensures consistency (all analyzers see the same file set) and efficiency (one traversal, not twelve).

### File Selection Policy

A canonical `file-policy.ts` governs what files enter the analysis:

- **Respect `.gitignore`** — use `git ls-files --cached --others --exclude-standard` for git repos (includes untracked-but-not-ignored files to capture current working state), or parse `.gitignore` manually for non-git dirs. Use `--committed-only` flag to restrict to committed files only when reproducibility matters (e.g., batch analysis of cloned repos).
- **Default excludes:** `node_modules/`, `vendor/`, `.git/`, `dist/`, `build/`, `__pycache__/`, `*.min.js`, `*.min.css`, `*.map`, `*.lock` (except for dependency analysis)
- **Binary detection:** skip files where first 8KB contains null bytes
- **Max file size:** 1MB (configurable). Files above threshold are counted but not parsed
- **Symlink handling:** do NOT follow symlinks by default (untrusted input safety). With `--follow-symlinks` flag, follow symlinks but ONLY if `fs.realpathSync(target)` resolves to a path under the repo root. Block special files (devices, FIFOs). Track visited inodes to break cycles.
- **Configurable overrides:** `--include` and `--exclude` glob patterns on CLI

### External Tool Execution Policy

All external tool invocations go through `exec.ts`:

- **No shell interpolation:** use `child_process.execFile` (argv array), never `exec(string)`
- **Path normalization:** `path.resolve()` all inputs before passing to external tools
- **Per-tool timeouts:** default 60s for scc/jscpd, 120s for gitleaks, configurable via `--timeout`
- **Output size cap:** 50MB stdout limit per tool invocation, kill + report error if exceeded
- **Structured error handling:** tool failures return `{ tool, exitCode, stderr, timedOut }`, never crash the pipeline
- **Graceful degradation:** if an external tool is missing, skip that analyzer and note it in the report (not a fatal error)

### Secret Data Handling Policy

- **Never output raw secret values.** Gitleaks findings are reported as `{ file, line, ruleId, description }` — the actual secret content is masked
- **Sanitizer gate for Phase 2 LLM:** before any data is sent to an external LLM, a `sanitize()` pass strips: file contents matching gitleaks rules, env var values, any string matching common key patterns (API_KEY=..., password=..., token=...)
- **Opt-in verbosity:** `--show-secrets` flag must be explicitly passed to include masked-but-present secret excerpts in the report

**External tool dependencies (installed as prerequisites):**
- `scc` — LOC counting (Go binary, available via brew/npm/direct download)
- `jscpd` — Duplication detection (npm package)
- `gitleaks` — Secret detection (Go binary, available via brew)
- `tree-sitter` + grammars — AST parsing (npm: `tree-sitter`, `tree-sitter-typescript`, `tree-sitter-python`, `tree-sitter-go`)

**What each analyzer does:**

All analyzers receive the shared `RepositoryIndex` — they never scan the filesystem independently.

| Analyzer | Consumes from Index | Technique | Output |
|----------|-------------------|-----------|--------|
| sizing | files, filesByLanguage | Shell to `scc --format json` via exec.ts | LOC by language, file count, god files (>500 LOC) |
| structure | files | Build tree from file paths (no re-traversal) | Directory tree with file counts per folder |
| testing | files, manifests | Pattern match test files, parse config from manifests | Test count, ratio, framework detection, untested files list |
| git | gitMeta, root | Shell to `git log/shortlog/tag` via exec.ts | Commits, contributors, conventional %, bus factor, commit frequency |
| dependencies | manifests | Parse manifests + per-ecosystem registry adapters (see below) | Total deps, outdated count, license list |
| security | root | Shell to `gitleaks` via exec.ts (secrets masked in output) | Finding count by rule, eval usage, .env exposure |
| repo-health | files, root | File existence checks against index | README, CI, license, contributing, gitignore booleans |
| tech-stack | manifests | Parse deps + lookup table | Framework, test runner, linter, build tool, deployment |
| env-vars | files | Grep source files in index for env var patterns | Variable inventory categorized by prefix |
| complexity | filesByLanguage | tree-sitter AST: McCabe cyclomatic complexity (see spec) | Complexity per function, avg/max per file |
| duplication | root | Shell to `jscpd --format json` via exec.ts | Clone %, duplicated blocks, largest clones |
| architecture | filesByLanguage | tree-sitter AST: parse imports, build directed graph | Import graph, circular deps, module cohesion ratio |

### Per-Ecosystem Dependency Adapters

The `dependencies.ts` analyzer uses ecosystem-specific adapters — NOT a single npm-only approach:

| Ecosystem | Manifest | Lockfile | Registry API | Adapter |
|-----------|----------|----------|-------------|---------|
| npm/yarn/pnpm | package.json | package-lock.json, yarn.lock, pnpm-lock.yaml | registry.npmjs.org | npm-adapter.ts |
| Cargo (Rust) | Cargo.toml | Cargo.lock | crates.io API | cargo-adapter.ts |
| Go modules | go.mod | go.sum | proxy.golang.org | go-adapter.ts |
| PyPI (Python) | requirements.txt, pyproject.toml | (varies) | pypi.org/pypi/{pkg}/json | pypi-adapter.ts |

Each adapter returns a unified `DependencyReport` type. If a manifest is detected for an unsupported ecosystem, the report explicitly states `"ecosystem": "unsupported"` rather than silently defaulting to zero.

Lockfiles are preferred over manifests for exact version resolution. Network calls are optional — `--offline` flag skips registry checks and reports only what's parseable locally.

### External Tool File Consistency

External tools (scc, gitleaks, jscpd) have their own ignore semantics which can diverge from `file-policy.ts`. To ensure consistency:

1. **Generate a canonical file list** from `RepositoryIndex` and write it to a temp file
2. **Feed external tools this exact file list** where supported:
   - `scc`: pass explicit file paths via stdin pipe in `exec.ts` (spawn scc process, write filelist to stdin programmatically — no shell redirection syntax)
   - `jscpd`: use `--files-list` option pointing to the canonical list
   - `gitleaks`: use `--no-git` mode with explicit path list where possible
3. **Where a tool cannot consume a file list** (e.g., gitleaks in git-scan mode): pass `--config` with generated ignore rules matching `file-policy.ts`
4. **Consistency test in CI:** after each analyzer runs, compare the set of files it reported on against the `RepositoryIndex` file set. Flag discrepancies as test failures.

### Cyclomatic Complexity: McCabe Method (Language-Specific)

The `complexity` analyzer uses the standard McCabe method, NOT a naive keyword count:

**Base rule:** Every function starts at complexity = 1 (the default path).

**Increments (+1 each) by language:**

| Construct | TS/JS | Python | Go |
|-----------|-------|--------|-----|
| `if` / `elif` / `else if` | +1 | +1 | +1 |
| `else` | NOT counted (it's the default path) | NOT counted | NOT counted |
| `case` (in switch) | +1 per case | N/A | +1 per case |
| `for` / `while` / `do-while` | +1 | +1 | +1 |
| `for...in` / `for...of` | +1 | +1 (`for x in`) | +1 (`range`) |
| `catch` | +1 | +1 (`except`) | N/A (Go uses error returns) |
| `&&` / `||` (logical operators) | +1 each | +1 (`and`/`or`) | +1 each |
| Ternary `? :` | +1 | +1 (`x if cond else y`) | N/A |
| `??` (nullish coalescing) | +1 | N/A | N/A |
| Optional chaining `?.` | NOT counted | N/A | N/A |

**Validation:** Each language's complexity calculator is validated against 5+ known functions with hand-computed expected values in the fixture test suite.

---

**Week-by-week breakdown:**

| Week | Deliverable | Key Files |
|------|-------------|-----------|
| 1 | CLI skeleton, RepositoryIndex, file-policy, exec.ts, sizing, structure, repo-health + tree-sitter spike (complexity for TS only) | cli/index.ts, repo-index.ts, file-policy.ts, exec.ts, sizing.ts, structure.ts, repo-health.ts, complexity.ts (TS only), markdown.ts |
| 2 | git, testing, dependencies (npm adapter first), security, tech-stack, env-vars | git.ts, testing.ts, dependencies.ts, npm-adapter.ts, security.ts, tech-stack.ts, env-vars.ts |
| 3 | architecture analyzer, duplication, complexity for Python+Go, remaining dep adapters (cargo, go, pypi) | architecture.ts, duplication.ts, complexity.ts (multi-lang), cargo-adapter.ts, go-adapter.ts, pypi-adapter.ts |
| 4 | Scoring engine, JSON schema, golden output tests, benchmark validation, report formatting polish | rubric.ts, aggregator.ts, report-v1.schema.json, golden output fixtures, markdown.ts polish |

**Validation strategy: Benchmark Suite with Golden Outputs**

Validation is NOT "eyeball it against Proximal reports." It is a structured, repeatable process:

1. **Benchmark corpus:** 5 pinned repos as git submodules at immutable full SHAs. Stored in `tests/fixtures/benchmark-manifest.json` — CI rejects any entry not matching `^[0-9a-f]{40}$`:

   ```json
   {
     "fixtures": [
       { "repo": "adityawrk/ai-startup-tycoon", "sha": "a128a5c5e7c3b8f2d1a4e6f9c0b3d5a7e8f1c2d4", "desc": "TS/React game, 54K LOC" },
       { "repo": "adityawrk/golden-era", "sha": "<MUST_BE_PINNED_BEFORE_FIRST_CI_RUN>", "desc": "TS/React game, 39K LOC" },
       { "repo": "adityawrk/cs-support", "sha": "<MUST_BE_PINNED_BEFORE_FIRST_CI_RUN>", "desc": "Kotlin Android, 25K LOC" },
       { "repo": "fastify/fastify", "sha": "<MUST_BE_PINNED_BEFORE_FIRST_CI_RUN>", "desc": "TS HTTP framework, public" },
       { "repo": "pallets/flask", "sha": "<MUST_BE_PINNED_BEFORE_FIRST_CI_RUN>", "desc": "Python web framework, public" }
     ]
   }
   ```

   **Implementation task (Week 1, Day 1):** Run `git ls-remote` for each repo, capture the current HEAD or latest release tag SHA, and replace all `<MUST_BE_PINNED_BEFORE_FIRST_CI_RUN>` placeholders with full 40-character SHAs. CI validates: `jq -r '.fixtures[].sha' benchmark-manifest.json | grep -vE '^[0-9a-f]{40}$' && exit 1` (note `-r` flag for raw output without quotes).

2. **Golden output files:** For each benchmark repo, a `tests/golden/{repo}.json` file containing the expected analysis output. These are generated once, hand-verified, and committed.

3. **Per-metric tolerances:**
   | Metric | Tolerance | Rationale |
   |--------|-----------|-----------|
   | Total LOC | exact match | Deterministic from scc |
   | File count | exact match | Deterministic |
   | Test/code ratio | ±0.5% | Depends on test file pattern matching |
   | Conventional commit % | exact match | Deterministic regex |
   | Bus factor | exact match | Deterministic from git shortlog |
   | Cyclomatic complexity (avg) | ±0.5 | Rounding differences across implementations |
   | Duplication % | ±2% | jscpd config sensitivity |
   | Circular dependencies count | exact match | Deterministic graph analysis |

4. **CI gating:** `npm test` includes a golden-output comparison. Any metric outside tolerance fails the build. New repos/metrics require updating golden files explicitly (`npm run update-golden`).

### Phase 2: Targeted LLM Enhancement (2 weeks, optional)

**Goal:** Add the 3-4 highest-value LLM sections using focused prompts, not broad codebase sweeps.

Instead of sending the entire codebase to an LLM, send **pre-computed structured context** from Phase 1 and ask specific questions:

| LLM Call | Input (from Phase 1) | Prompt | Value |
|----------|---------------------|--------|-------|
| Architecture Pattern | Folder tree + tech stack + top-10 file names per dir | "What architecture pattern does this codebase follow?" | HIGH — #1 most valuable LLM insight |
| Code Organization | Folder tree + first 20 lines of each top-level file | "What does each directory contain and what is its purpose?" | HIGH — #2 most valuable |
| Setup Guide | docker-compose + Makefile + .env.example + detected DBs | "Write a step-by-step local development setup guide" | HIGH — huge onboarding time-saver |
| Test Gap Analysis | Source module list + corresponding test files | "Which modules appear undertested and what tests are missing?" | MEDIUM — actionable recommendations |

**Cost estimate:** 4 focused prompts × ~2K tokens input × ~1K tokens output = ~12K total tokens per analysis = **~$0.05/run** (vs Proximal's ~$3/run).

**What to explicitly DROP (LLM sections not worth replicating):**
- Behavioral vs Implementation test classification (too noisy without LLM, misleading with heuristics)
- Side-Effect Testable Features (requires deep semantic understanding)
- Refactoring Resilience Analysis (niche, requires reading test code)
- Executive Summaries (filler narrative)
- First-time setup time estimates (inaccurate regardless of source)

---

## What NOT to Build (Scope Cuts)

| Original Plan Item | LOC Estimate | Decision | Reason |
|-------------------|-------------|----------|--------|
| React Dashboard | 10-15K | CUT | No buyer needs it. Proximal itself outputs markdown. |
| Web API Server | 4-6K | CUT | Premature. Add only if there's a paying customer who needs it. |
| Job Queue | included above | CUT | Solves a problem that doesn't exist yet. |
| Auth System | included above | CUT | Solves a problem that doesn't exist yet. |
| 6+ language AST parsers from day 1 | 8-12K | REDUCE to 3 | Start with TS/JS, Python, Go. Add more on demand. |
| Reimplemented LOC counter | 3-5K | CUT | Use `scc` — battle-tested, faster than anything you'd build. |
| Reimplemented secret scanner | 1-2K | CUT | Use `gitleaks` — 17K stars, comprehensive rules. |
| Reimplemented duplication detector | 2-3K | CUT | Use `jscpd` — well-maintained, JSON output. |

---

## Language Decision: TypeScript

| Factor | Rust | TypeScript | Winner |
|--------|------|------------|--------|
| Developer proficiency | Learning | Expert | TS |
| tree-sitter performance | FFI to C | FFI to C (identical) | Tie |
| Ecosystem for this domain | Adequate | Rich (npm packages for all manifest formats) | TS |
| Development velocity | ~2,500 LOC/week | ~5,000 LOC/week | TS |
| Timeline to MVP | 10-12 weeks | 4 weeks | TS |
| Single binary distribution | Native | bun build --compile | Tie (good enough) |
| Batch performance (future) | 20-30% faster | Good enough, optimize later | Rust (future) |

**Decision: TypeScript now. If batch performance becomes a real bottleneck later, rewrite hot paths (AST analysis) in Rust as a native module.**

---

## Metric Specification (spec/metrics-v1.md)

Every metric has a formal definition. Key examples:

### Scoring Under Partial Data

When analyzers are skipped (tool missing, offline mode, unsupported ecosystem), the scoring engine handles it explicitly:

1. **Each metric has a weight** in `rubric.yaml`. The default total weight sums to 100.
2. **Available weight** = sum of weights for metrics that were actually computed.
3. **Normalized score** = (weighted sum of available metrics) / (available weight) × 100.
4. **Analysis completeness** = (available weight / total weight) × 100, emitted in the report as `analysisCompleteness: 85%`.
5. **Partial grade policy:** if `analysisCompleteness < 60%`, the overall grade is marked as `"grade": "INCOMPLETE"` instead of a letter grade. This prevents misleading A/B/C grades when half the analyzers didn't run.
6. **Per-metric status:** every metric in the JSON output includes `"status": "computed" | "skipped" | "error"` with a reason string.

### Metric Definitions

| Metric | Formula | Unit | Notes |
|--------|---------|------|-------|
| Bus Factor | Number of contributors who authored ≥5% of commits in last 12 months. Minimum 1. | integer | Uses `git shortlog -sn --since="12 months ago"` |
| Test/Code Ratio | (test file LOC) / (non-test file LOC) × 100 | percentage | Test files identified by path pattern: `*test*`, `*spec*`, `__tests__/` |
| Conventional Commit % | (commits matching canonical regex) / total commits × 100 | percentage | Evaluated on last 100 commits. Canonical regex defined once in `spec/metrics-v1.md` code block — see spec for authoritative pattern. |
| Module Cohesion Ratio | (intra-module imports) / (total imports from that module) | 0.0-1.0 | Computed per top-level directory. Higher = more self-contained. |
| God File Threshold | Files with >500 LOC (configurable via rubric) | count + file list | Excludes generated files, lockfiles |
| Cyclomatic Complexity | McCabe method, baseline 1 per function (see table above) | integer per function | Reported as: per-function, per-file avg, repo avg, max |

Full spec is maintained in `spec/metrics-v1.md` with examples and edge case documentation. Changes to metric definitions require a version bump.

---

## LOC and Timeline Summary

| Component | LOC (TypeScript) |
|-----------|-----------------|
| CLI + config | 400-600 |
| Core (orchestrator, repo-index, file-policy, exec, types) | 600-900 |
| 12 analyzers + 4 dependency adapters | 3,000-4,200 |
| Scoring engine + JSON schema | 500-700 |
| Output formatters | 400-600 |
| Utilities (tree-sitter wrapper) | 200-300 |
| Data files (JSON lookups) | 500-800 |
| Metric spec + schemas | 300-500 (markdown + JSON schema) |
| Tests (unit + golden output fixtures) | 2,000-3,000 |
| **Total Phase 1** | **7,900-11,600** |
| Optional LLM integration (Phase 2) | 500-800 |
| **Total with Phase 2** | **8,400-12,400** |

**Timeline:** 4-6 weeks (Phase 1), +2 weeks (Phase 2) = **6-8 weeks total**

This is a dramatically more achievable scope than 50-75K LOC over 5-6 months.

---

## Validation Before Scaling

Before building anything beyond the 6-8 week MVP:

1. **Validate output quality** — Run on 30+ public repos, compare with SonarQube/CodeClimate output. Is the scoring rubric calibrated correctly?
2. **Validate demand** — Contact 5 potential buyers (email Proximal, Mechanize, Poolside). Share sample reports. Do they want this?
3. **Validate the Proximal submission angle** — If the primary goal is creating a codebase for Proximal, does this tool + its codebase meet their requirements? (50K+ LOC, test coverage, commit history)
4. **Decide on expansion** — Only add the web server, dashboard, or more languages if there's a paying customer who asks.

---

## Open Questions (Resolved)

| Original Question | Resolution |
|-------------------|-----------|
| Rust or Go? | Neither. TypeScript. |
| Open source or closed? | Open source the CLI, charge for hosted/SaaS if demand validates. |
| Which languages first? | TypeScript/JavaScript + Python + Go (covers ~70% of modern codebases). |
| Configurable scoring rubric? | Yes — YAML config file, low implementation cost, high value. |
| How to validate demand? | Build MVP first (4 weeks), then share reports from 30 public repos publicly. |
| Are target repos untrusted input? | **Yes.** Repos are arbitrary user-provided paths. All file reads use the RepositoryIndex (which enforces the file policy). External tool invocations use exec.ts (no shell interpolation). No `eval()` on repo content. Symlink cycles are detected. But we do NOT sandbox to a container — that's a future enhancement if the tool is ever exposed as a service. |
| Is fully offline operation required? | **No, but supported.** `--offline` flag skips all network calls (dependency registry checks). Everything else works offline. Default is online (for dependency freshness). |
| Is JSON output a stable public contract? | **Yes.** Report output conforms to `schemas/report-v1.schema.json`. Breaking changes require a new schema version (`report-v2.schema.json`). The schema is validated in CI. |

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Output is "just SonarQube but worse" | High | Fatal | Differentiate on: Proximal-specific metrics (test discipline, commit-test co-occurrence), scoring rubric optimized for AI training data evaluation, markdown-first output |
| No buyers at any price point | Medium | High | Validate in weeks 5-6 before investing more. Pivot to using the tool for own Proximal submissions. |
| External tools (scc, gitleaks, jscpd) break or change API | Low | Medium | Pin versions in docs, wrap with adapter interfaces. If a tool is missing at runtime, gracefully degrade: skip that analyzer and note "scc not found — sizing analysis skipped" in report. Do NOT build fallback reimplementations (contradicts scope cuts). |
| tree-sitter grammar changes break AST analysis | Low | Medium | Pin grammar versions, test against known codebases |
| Scope creep back to 50K LOC | Medium | High | This document is the scope contract. No dashboard. No web server. No auth. Period. |
