# Phase 2: LLM Enhancement Plan

*Written March 2026. Not yet implemented. This document describes the design for optional LLM-powered report sections.*

---

## Overview

Phase 2 adds an optional `--enhance` CLI flag that calls the Claude API to generate four high-value report sections that cannot be computed statically. These sections were identified in `REVISED-PLAN.md` as the top LLM-dependent insights by user value.

**Cost:** ~$0.05/run using `claude-sonnet-4-6` (4 focused prompts, ~12K total tokens).

**Scope:** This is strictly additive. Phase 1 continues to work identically without `--enhance`. No new external tool dependencies are introduced at build time.

---

## Sections to Add

### 1. Architecture Pattern Analysis

Identify the architectural pattern the codebase follows (MVC, microservices, monolith, event-driven, hexagonal, etc.), evaluate separation of concerns, and detect common anti-patterns.

**Input from Phase 1:** Folder tree from the `structure` analyzer, tech stack detection results, top-10 file names per directory, import graph from the `architecture` analyzer, circular dependency list.

**Why this requires an LLM:** Static analysis can detect imports and directory structure, but classifying those into named architectural patterns and evaluating their quality requires semantic understanding of conventions across ecosystems.

### 2. Code Organization Assessment

Rate overall code organization quality, identify misplaced files (e.g., business logic in a `utils/` folder, tests outside the test directory), and suggest structural improvements.

**Input from Phase 1:** Full folder tree, first 20 lines of each top-level file (to capture module docstrings/exports), file-by-language breakdown, module cohesion ratios.

**Why this requires an LLM:** Naming conventions and organizational quality are inherently subjective. Static rules can flag anomalies, but providing actionable reorganization suggestions requires understanding what each module does.

### 3. Setup Guide

Auto-generate a "Getting Started" guide for new developers based on the codebase structure, dependencies, detected services, and build scripts.

**Input from Phase 1:** Detected manifests (package.json, Cargo.toml, go.mod, etc.), docker-compose/Dockerfile contents if present, Makefile/justfile targets, `.env.example` variables, tech stack results, detected databases/services from the service registry.

**Why this requires an LLM:** Synthesizing scattered configuration files into a coherent step-by-step narrative is a natural language generation task. The static analysis provides all the raw facts; the LLM arranges them into prose a human can follow.

### 4. Test Gap Analysis

Identify untested critical paths, suggest high-value test targets, and assess test quality beyond coverage numbers.

**Input from Phase 1:** Source module list paired with corresponding test files (from the `testing` analyzer), complexity hotspots (from the `complexity` analyzer), import graph centrality (which modules are most depended upon), god file list.

**Why this requires an LLM:** Determining which untested modules are *critical* requires understanding what the code does, not just whether a test file exists. Prioritizing test targets by business impact is a judgment call that benefits from semantic comprehension.

---

## Sections Explicitly Dropped

These LLM-powered sections are **not worth replicating** (per analysis in `REVISED-PLAN.md`):

| Section | Reason for Dropping |
|---------|-------------------|
| Behavioral vs Implementation test classification | Too noisy without deep semantic analysis; misleading with heuristics |
| Side-Effect Testable Features | Requires understanding of business logic intent |
| Refactoring Resilience Analysis | Niche, requires reading test implementation details |
| Executive Summaries | Low-value filler narrative |
| First-time setup time estimates | Inaccurate regardless of source |

---

## Technical Design

### CLI Interface

```
codebase-analyzer analyze /path/to/repo --enhance
codebase-analyzer analyze /path/to/repo --enhance --enhance-model claude-opus-4-6
codebase-analyzer analyze /path/to/repo --enhance --enhance-endpoint http://localhost:8080/v1
codebase-analyzer analyze /path/to/repo --enhance --dry-run
```

- `--enhance` — Enable LLM enhancement. Off by default. Requires `ANTHROPIC_API_KEY` environment variable.
- `--enhance-model <model>` — Model to use. Default: `claude-sonnet-4-6` (cost-efficient). Alternative: `claude-opus-4-6` (higher quality).
- `--enhance-endpoint <url>` — Override the API endpoint. Enables use of a local/self-hosted model or compatible proxy.
- `--dry-run` — When combined with `--enhance`, prints the prompts that would be sent (with token counts) but does not call the API. Useful for cost estimation and prompt review.

### Module Layout

```
src/enhancers/
├── index.ts                 # Enhancer orchestration: run all enhancers, collect results
├── types.ts                 # EnhancerResult, EnhancerConfig, BudgetTracker types
├── client.ts                # Thin wrapper around @anthropic-ai/sdk (API key validation,
│                            # endpoint override, retry logic)
├── sanitize.ts              # sanitize() gate — strips secrets before any LLM call
├── architecture-pattern.ts  # Enhancer: Architecture Pattern Analysis
├── code-organization.ts     # Enhancer: Code Organization Assessment
├── setup-guide.ts           # Enhancer: Setup Guide
└── test-gap-analysis.ts     # Enhancer: Test Gap Analysis
```

Each enhancer file exports a single function with this signature:

```typescript
interface EnhancerInput {
  reportData: ReportData;       // Full Phase 1 analysis results
  repoIndex: RepositoryIndex;   // For reading sampled file content
  config: EnhancerConfig;       // Model, endpoint, budget limits
}

interface EnhancerResult {
  section: string;              // e.g., "architecture-pattern"
  status: "computed" | "error"; // Follows existing metric status convention
  markdown: string;             // Generated content (empty string on error)
  error?: string;               // Reason string on failure
  tokensUsed: {
    input: number;
    output: number;
  };
  costUsd: number;              // Estimated cost for this section
}

type Enhancer = (input: EnhancerInput) => Promise<EnhancerResult>;
```

### Orchestration Flow

The enhancer step runs **after** all static analyzers complete and **before** the output formatter runs:

```
CLI → Orchestrator → RepositoryIndex (single-pass)
                  → Analyzers (12 modules)
                  → Scoring Engine
                  → [NEW] Enhancers (if --enhance flag is set)
                  → Output Formatter (static sections + enhanced sections)
```

Enhancers run sequentially (not in parallel) to keep API usage predictable and debuggable. Each enhancer is independent — if one fails, the others still run.

### Dependency Management

- **New dependency:** `@anthropic-ai/sdk`
- **Lazy-loaded:** The SDK is imported dynamically only when `--enhance` is used (`await import("@anthropic-ai/sdk")`). Users who never use `--enhance` pay no startup cost and have no hard dependency on the SDK.
- **No other new dependencies.** Prompt construction uses template strings, not a prompt library.

### Context Construction

Each enhancer builds a focused prompt from Phase 1 results. File content is **sampled**, never sent in its entirety:

| Enhancer | Context Sent to LLM |
|----------|-------------------|
| Architecture Pattern | Folder tree (depth 3), tech stack, top-10 filenames per directory, import graph summary (top 20 edges by weight), circular dependency list |
| Code Organization | Folder tree (full), first 20 lines of each top-level module, file count by directory, module cohesion ratios |
| Setup Guide | All manifest files (package.json, Cargo.toml, etc.), docker-compose.yml, Makefile/justfile, .env.example, detected services/databases |
| Test Gap Analysis | Source-to-test file mapping, complexity top-20 functions, import graph centrality (top 20 most-imported modules), god file list, test/code ratio |

**File content sampling rules:**
- Only the first N lines of key files are sent (N configurable, default 30).
- Binary files are never sent.
- Generated files (lockfiles, minified bundles, sourcemaps) are excluded.
- Total context per prompt is capped (see Budget Controls below).

### Budget Controls

| Control | Default | Configurable? |
|---------|---------|--------------|
| Max input tokens per section | 4,000 | Yes, via `EnhancerConfig` |
| Max output tokens per section | 2,000 | Yes, via `EnhancerConfig` |
| Total budget cap per run | $0.25 | Yes, via `--enhance-budget` flag |
| Dry-run mode | Off | Yes, via `--dry-run` flag |

The `BudgetTracker` in `types.ts` accumulates token usage across all enhancer calls. If the running total exceeds the budget cap, remaining enhancers are skipped with `status: "error"` and `error: "Budget cap exceeded"`.

After all enhancers complete, a summary is logged to stderr:

```
[enhance] Architecture Pattern: 1,847 input + 892 output tokens ($0.008)
[enhance] Code Organization:    2,103 input + 1,204 output tokens ($0.012)
[enhance] Setup Guide:          3,412 input + 1,567 output tokens ($0.018)
[enhance] Test Gap Analysis:    1,956 input + 1,089 output tokens ($0.011)
[enhance] Total: 9,318 input + 4,752 output tokens ($0.049)
```

### Output Format

Enhanced sections are clearly marked in the report output:

**Markdown output:**
```markdown
## Architecture Pattern Analysis
> *This section was generated by claude-sonnet-4-6. Static analysis data was used as input.*

[LLM-generated content here]
```

**JSON output:**
```json
{
  "enhancedSections": {
    "architecturePattern": {
      "status": "computed",
      "model": "claude-sonnet-4-6",
      "markdown": "...",
      "tokensUsed": { "input": 1847, "output": 892 },
      "costUsd": 0.008
    }
  }
}
```

Enhanced sections live in a separate `enhancedSections` key in the JSON output, clearly separated from computed metrics. This keeps the `report-v1.schema.json` contract intact — enhanced sections are an additive extension, not a modification to existing fields.

### Graceful Degradation

| Failure Mode | Behavior |
|-------------|----------|
| `ANTHROPIC_API_KEY` not set | Print error message with setup instructions, exit with non-zero code |
| API key invalid (401) | Print error, skip all enhancers, continue with static-only report |
| Single enhancer API call fails (timeout, 500, rate limit) | That section shows `"Enhancement unavailable: [reason]"`, other enhancers still run |
| Budget cap exceeded mid-run | Remaining enhancers skipped with budget explanation |
| `--enhance-endpoint` unreachable | Print connection error, skip all enhancers, continue with static-only report |

In all degradation cases, the Phase 1 static report is still produced in full. Enhancement failures never block static output.

---

## Security Considerations

### Secret Sanitization

All data passed to the LLM goes through the `sanitize()` gate in `src/enhancers/sanitize.ts`. This is the same sanitization policy referenced in `CLAUDE.md` and `REVISED-PLAN.md`:

1. **Gitleaks findings:** Only `{ file, line, ruleId }` metadata is included. Raw secret values from gitleaks are never in the Phase 1 `ReportData`, so they cannot leak into prompts.
2. **File content sampling:** Before any file content snippet is included in a prompt, it passes through `sanitize()` which strips:
   - Lines matching common secret patterns (`API_KEY=...`, `password=...`, `token=...`, `secret=...`)
   - Environment variable values (keeps variable names, redacts values)
   - Strings matching patterns from gitleaks rule definitions
3. **Manifest files:** Dependency lists are safe to send. Private registry URLs are redacted.

### API Key Handling

- The `ANTHROPIC_API_KEY` is read from the environment, never from the analyzed repository.
- The key is validated (a lightweight `/v1/messages` call with minimal tokens) before sending any repository data.
- The key is never logged, never included in report output, never written to disk.

### Data Minimization

- File content is sampled (first N lines of key files), not sent in entirety.
- The total context per prompt is capped at a configurable token limit.
- No user-identifying information from the analyzed repository is sent beyond what is necessary for the analysis (file paths, dependency names, code structure).

### Self-Hosted Option

The `--enhance-endpoint` flag allows routing all LLM calls to a local or self-hosted endpoint. This means sensitive codebases can use Phase 2 enhancements without sending any data to external APIs.

---

## Schema Considerations

Enhanced sections are additive to the existing `report-v1.schema.json`. The approach:

- Add an optional `enhancedSections` object to the schema with each section as an optional property.
- Since all new fields are optional and additive, this does **not** constitute a breaking change. Existing consumers that ignore unknown keys are unaffected.
- If the enhanced section schema needs breaking changes in the future, it follows the same version-bump policy as the rest of the schema.

---

## Testing Strategy

### Unit Tests

- **Prompt construction tests:** Verify that each enhancer produces a well-formed prompt from fixture `ReportData`. Assert token count is within budget. Assert no secret patterns appear in the prompt text.
- **Sanitization tests:** Feed known secret patterns through `sanitize()` and verify they are stripped.
- **Budget tracker tests:** Verify budget cap enforcement, partial completion behavior.
- **Client wrapper tests:** Verify API key validation, endpoint override, retry logic using mocked HTTP responses.

### Integration Tests

- **Mock API tests:** Use a local HTTP server that returns canned responses. Verify end-to-end flow: CLI `--enhance` flag through to enhanced sections in the output.
- **Real API tests:** Run against the actual Anthropic API for a small benchmark repo. These are opt-in (require `ANTHROPIC_API_KEY` in CI environment), marked with a `@slow` tag, and excluded from default `bun test` runs.
- **Dry-run tests:** Verify `--dry-run` prints prompts without making API calls.

### Golden Output Tests

Enhanced sections are **excluded** from golden output comparisons. LLM output is non-deterministic, so golden tests only validate the static portions of the report. Enhanced section tests verify structural correctness (valid JSON, expected keys present, status field values) rather than content equality.

---

## Estimated Effort

| Component | LOC Estimate |
|-----------|-------------|
| `src/enhancers/index.ts` (orchestration) | 60-80 |
| `src/enhancers/types.ts` (types + budget tracker) | 40-60 |
| `src/enhancers/client.ts` (API wrapper) | 60-80 |
| `src/enhancers/sanitize.ts` (secret stripping) | 50-70 |
| 4 enhancer modules (architecture, code-org, setup-guide, test-gap) | 200-280 |
| CLI flag additions to `src/cli/` | 30-50 |
| Output formatter changes for enhanced sections | 40-60 |
| Tests (unit + integration) | 200-300 |
| **Total** | **~500-800 LOC** |

**Timeline:** 2-3 days of focused implementation, assuming Phase 1 is complete and stable.

---

## Open Questions

| Question | Status |
|----------|--------|
| Should enhanced sections affect the overall score/grade? | Leaning no. Scoring should remain deterministic and reproducible. |
| Should prompts be versioned alongside the metric spec? | Probably yes. Prompt changes can alter output quality significantly. |
| Is streaming output worth the complexity for CLI usage? | Probably no. Total generation time is ~10-15 seconds; a spinner is sufficient. |
| Should we cache LLM responses for unchanged repos? | Maybe. Hash the prompt inputs; if identical, reuse cached response. Low priority. |
