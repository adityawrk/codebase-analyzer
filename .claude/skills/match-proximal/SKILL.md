---
name: match-proximal
description: Compare analyzer output against a Proximal report for the same repo. Shows section-by-section coverage and value gaps. One-shot.
user_invocable: true
---

# Match Proximal

Compare the codebase analyzer's output against a Proximal reference report for the same repository. Identifies section-by-section coverage, metric accuracy, and formatting differences.

## When to Invoke

- When the user runs `/match-proximal <proximal-report-path>` with the path to a Proximal report
- Optionally: `/match-proximal <proximal-report-path> <analyzer-output-path>` to compare specific files
- During validation to measure how close our output is to Proximal quality

## Agent Instructions

### Step 1: Load Reports

1. Read the Proximal reference report (markdown file provided by user)
2. Determine which repo it analyzes (from the report header)
3. If analyzer output path provided, read it. Otherwise, check if the analyzer has been run on the same repo and read the latest output.

### Step 2: Parse Proximal Report Sections

Break the Proximal report into its known sections:

| Section | Category | LLM-Required? |
|---------|----------|---------------|
| Summary (file count, language breakdown) | Static metrics | No |
| Language Breakdown table | Static metrics | No |
| Folder Structure (tree) | Static metrics | No |
| Test Analysis (counts, ratio) | Static metrics | No |
| Test Analysis - AI Deep Analysis (coverage map, behavioral classification) | LLM narrative | Yes |
| Code Type Breakdown (categories, percentages) | Heuristic | Partial |
| Code Type - AI Deep Analysis (tech stack, architecture, patterns) | LLM narrative | Yes |
| External Dependencies (count, list) | Static metrics | No |
| External Dependencies - AI Deep Analysis (service inventory, setup guide) | LLM narrative | Yes |
| Git Usage (commits, contributors, conventional %) | Static metrics | No |

### Step 3: Compare Section by Section

For each Proximal section, report:

1. **Coverage:** Does our analyzer produce equivalent data?
   - `FULL` — we produce the same data
   - `PARTIAL` — we produce some but not all
   - `MISSING` — we don't produce this at all
   - `BETTER` — we produce more detail than Proximal

2. **Accuracy (for static metrics):** Compare our values to Proximal's
   - Total LOC: exact match?
   - File count: match?
   - Language breakdown percentages: within 1%?
   - Git stats: match?
   - Test count/ratio: match?

3. **Format match:** Is our markdown output structurally similar?
   - Same table format?
   - Same heading hierarchy?
   - Same star-rating style?

### Step 4: Compute Coverage Score

```
Computable sections matched: X / Y
LLM sections (expected missing in Phase 1): A / B
Overall computable coverage: X/Y as percentage
```

### Step 5: Report

```
## Proximal Format Match Report

### Repo: {name}
Proximal report: {path}
Analyzer output: {path}

### Section-by-Section Comparison

| Proximal Section | Coverage | Accuracy | Format | Notes |
|-----------------|----------|----------|--------|-------|
| Summary | FULL | Exact | Match | |
| Language Breakdown | FULL | LOC off by 2% | Table format differs | scc vs Proximal counting |
| Folder Structure | FULL | Exact | Match | |
| Test Analysis | PARTIAL | Ratio matches | Missing AI narrative | Expected — Phase 1 |
| ...

### Metrics Comparison

| Metric | Proximal Value | Our Value | Match? |
|--------|---------------|-----------|--------|
| Total LOC | 54,231 | 53,988 | ~99.5% |
| Files | 176 | 176 | Exact |
| ...

### Coverage Summary
- Computable sections: {X}/{Y} covered ({pct}%)
- LLM sections: {A}/{B} missing (expected in Phase 1)
- Overall quality: {assessment}

### Gaps to Close
1. {specific actionable gap}
2. {specific actionable gap}
```

### Step 6: Identify Top 3 Highest-Value Gaps

From the gaps found, rank by user value and suggest which to fix first.

## Rules

- This is a read-only comparison. Do NOT modify any files.
- Reference Proximal reports are in `/Users/aditya/projects/Random/Proximal/`:
  - `ai-startup-tycoon_codebase_analysis.md`
  - `golden-era_codebase_analysis.md`
  - `resolve_codebase_analysis.md`
- If no analyzer output exists yet, tell the user to run the analyzer first.
- LLM-required sections being missing is EXPECTED in Phase 1. Don't flag them as failures — flag them as "Phase 2 opportunity."
- Accuracy differences in LOC are often due to different counting tools (scc vs cloc vs custom). Note the likely cause, don't just flag the number.
