/**
 * Markdown report formatter.
 * Produces reference-format markdown from ReportData.
 *
 * Each section is a standalone formatter function returning string[].
 * The main `formatMarkdown` concatenates them all.
 */

import * as path from 'node:path';
import type {
  ReportData,
  ScoringResult,
  CategoryScore,
} from '../core/types.js';

// ---------------------------------------------------------------------------
// Test file detection for env var filtering
// ---------------------------------------------------------------------------

const TEST_DIR_PATTERNS = [
  '/__tests__/',
  '/test/',
  '/tests/',
  '/spec/',
];

const TEST_DIR_START_PATTERNS = [
  '__tests__/',
  'test/',
  'tests/',
  'spec/',
];

/**
 * Returns true if the file path looks like a test file.
 * Used to filter out env vars that only appear in test fixtures.
 */
function isTestFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const basename = path.basename(filePath);

  // Directory-based detection
  for (const pattern of TEST_DIR_PATTERNS) {
    if (normalized.includes(pattern)) return true;
  }
  for (const pattern of TEST_DIR_START_PATTERNS) {
    if (normalized.startsWith(pattern)) return true;
  }

  // File-name pattern detection: *.test.*, *.spec.*
  const nameWithoutExt = basename.replace(/\.[^.]+$/, '');
  if (
    nameWithoutExt.endsWith('.test') ||
    nameWithoutExt.endsWith('.spec') ||
    nameWithoutExt.endsWith('_test') ||
    nameWithoutExt.endsWith('_spec')
  ) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function formatMarkdown(report: ReportData): string {
  const lines: string[] = [
    ...formatHeader(report),
    ...formatSummary(report),
    ...formatScoring(report),
    ...formatLanguages(report),
    ...formatStructure(report),
    ...formatTests(report),
    ...formatHealth(report),
    ...formatComplexity(report),
    ...formatGodFiles(report),
    ...formatGit(report),
    ...formatDependencies(report),
    ...formatSecurity(report),
    ...formatTechStack(report),
    ...formatEnvVars(report),
    ...formatDuplication(report),
    ...formatArchitecture(report),
    ...formatFooter(report),
  ];

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Section formatters — each returns string[]
// ---------------------------------------------------------------------------

function formatHeader(report: ReportData): string[] {
  const repoName = path.basename(report.meta.directory);
  return [
    `# Codebase Analysis: ${repoName}`,
    `**Generated:** ${formatDate(report.meta.generatedAt)}`,
    `**Directory:** \`${report.meta.directory}\``,
    '---',
  ];
}

function formatSummary(report: ReportData): string[] {
  const lines: string[] = [];
  lines.push('## Summary');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Total Files (tracked) | ${report.sizing.totalFiles} |`);

  // Total Lines of Code
  if (report.sizing.meta.status === 'computed') {
    lines.push(`| Total Lines of Code | ${report.sizing.totalLines} |`);
  }

  // Languages detected (count)
  if (report.sizing.meta.status === 'computed' && report.sizing.languages.length > 0) {
    lines.push(`| Languages Detected | ${report.sizing.languages.length} |`);
  }

  // Test Coverage Ratio
  if (report.testAnalysis.meta.status === 'computed') {
    lines.push(`| Test/Code Ratio | ${report.testAnalysis.testCodeRatio}% |`);
  }

  // Complexity Average
  if (report.complexity.meta.status === 'computed') {
    lines.push(`| Complexity Average | ${report.complexity.repoAvgComplexity.toFixed(1)} |`);
  }

  lines.push('');

  // Summary highlights (grade, strengths, concerns)
  if (report.scoring) {
    lines.push(`**Grade: ${report.scoring.grade} (${report.scoring.normalizedScore}/100)**`);
    lines.push('');

    const strengths = getHighScoringCategories(report.scoring, 80);
    const concerns = getLowScoringCategories(report.scoring, 50);

    if (strengths.length > 0) {
      lines.push('**Key Strengths:**');
      for (const s of strengths) {
        lines.push(`- ${capitalize(s.name)} (${s.pct.toFixed(0)}%)`);
      }
      lines.push('');
    }

    if (concerns.length > 0) {
      lines.push('**Key Concerns:**');
      for (const c of concerns) {
        lines.push(`- ${capitalize(c.name)} (${c.pct.toFixed(0)}%)`);
      }
      lines.push('');
    }
  }

  return lines;
}

function formatScoring(report: ReportData): string[] {
  if (!report.scoring) return [];

  const lines: string[] = [];
  lines.push(`## Score: ${report.scoring.grade} (${report.scoring.normalizedScore}/100)`);
  lines.push('');
  lines.push('| Category | Score | Max | Rating |');
  lines.push('|----------|-------|-----|--------|');
  for (const [name, cat] of Object.entries(report.scoring.categories)) {
    const stars = scoreToStars(cat);
    lines.push(`| ${capitalize(name)} | ${cat.score} | ${cat.maxScore} | ${stars} |`);
  }
  const totalStars = scoreToStarsFromPct(report.scoring.normalizedScore);
  lines.push(`| **Total** | **${report.scoring.totalScore}** | **${report.scoring.totalPossible}** | **${totalStars}** |`);
  lines.push('');

  return lines;
}

function formatLanguages(report: ReportData): string[] {
  if (report.sizing.meta.status !== 'computed' || report.sizing.languages.length === 0) {
    return [];
  }

  const lines: string[] = [];
  lines.push('## Language Breakdown');
  lines.push('| Extension | Files | Lines | % of Code |');
  lines.push('|-----------|-------|-------|-----------|');
  const sorted = [...report.sizing.languages].sort((a, b) => b.lines - a.lines);
  for (const lang of sorted) {
    const pctRounded = Math.round(lang.percentOfCode);
    const label = lang.extension || `(${lang.language})`;
    lines.push(
      `| ${padRight(label, 10)} | ${padLeft(String(lang.files), 5)} | ${padLeft(String(lang.lines), 7)} | ${padLeft(String(pctRounded) + '%', 4)} |`,
    );
  }
  lines.push('');
  lines.push(`**Total Lines of Code:** ${report.sizing.totalLines}`);
  lines.push('');

  return lines;
}

function formatStructure(report: ReportData): string[] {
  if (report.structure.meta.status !== 'computed') return [];

  return [
    '## Folder Structure',
    '',
    '```',
    report.structure.treeString,
    '```',
    '',
  ];
}

function formatTests(report: ReportData): string[] {
  const lines: string[] = [];
  lines.push('## Test Analysis');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Test Files | ${report.testAnalysis.testFiles} |`);
  lines.push(`| Test Lines | ${report.testAnalysis.testLines} |`);
  lines.push(`| Code Lines (non-test) | ${report.testAnalysis.codeLines} |`);
  lines.push(`| Test/Code Ratio | ${report.testAnalysis.testCodeRatio}% |`);

  if (report.testAnalysis.coverageConfigFound) {
    lines.push('### Coverage Configuration');
    lines.push('');
    lines.push('- **Coverage Reports**: Coverage configuration found');
    lines.push('');
  }

  if (report.testAnalysis.testFrameworks.length > 0) {
    lines.push('### Test Frameworks Detected');
    lines.push('');
    for (const fw of report.testAnalysis.testFrameworks) {
      lines.push(`- **${fw}**`);
    }
    lines.push('');
  }

  if (report.testAnalysis.testFileList.length > 0) {
    lines.push('### Test Files');
    lines.push('');
    const topFiles = report.testAnalysis.testFileList.slice(0, 40);
    for (const f of topFiles) {
      lines.push(`- \`${f.path}\` (${f.lines} lines)`);
    }
    if (report.testAnalysis.testFileList.length > 40) {
      lines.push(`*... and ${report.testAnalysis.testFileList.length - 40} more test files*`);
    }
    lines.push('');
  }

  return lines;
}

function formatHealth(report: ReportData): string[] {
  if (report.repoHealth.meta.status !== 'computed') return [];

  const lines: string[] = [];
  lines.push('## Repository Health');
  lines.push('');
  lines.push('| Check | Status | Path |');
  lines.push('|-------|--------|------|');
  for (const check of report.repoHealth.checks) {
    const status = check.present ? 'Present' : 'Missing';
    const icon = check.present ? '\u2705' : '\u274C';
    const filePath = check.path ?? '';
    lines.push(`| ${check.name} | ${icon} ${status} | ${filePath} |`);
  }
  lines.push('');

  return lines;
}

function formatComplexity(report: ReportData): string[] {
  if (report.complexity.meta.status !== 'computed') return [];

  const lines: string[] = [];
  lines.push('## Cyclomatic Complexity');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Average Complexity | ${report.complexity.repoAvgComplexity.toFixed(1)} |`);
  lines.push(`| Max Complexity | ${report.complexity.repoMaxComplexity} |`);
  lines.push(`| Total Functions | ${report.complexity.totalFunctions} |`);
  lines.push('');

  if (report.complexity.hotspots.length > 0) {
    lines.push('### Complexity Hotspots');
    lines.push('');
    lines.push('| Function | File | Line | Complexity |');
    lines.push('|----------|------|------|------------|');
    for (const fn of report.complexity.hotspots) {
      lines.push(`| ${fn.name} | ${fn.file} | ${fn.line} | ${fn.complexity} |`);
    }
    lines.push('');
  }

  return lines;
}

function formatGodFiles(report: ReportData): string[] {
  if (report.sizing.meta.status !== 'computed' || report.sizing.godFiles.length === 0) {
    return [];
  }

  const lines: string[] = [];
  lines.push('## God Files (>500 LOC)');
  lines.push('');
  lines.push('| File | Lines | Language |');
  lines.push('|------|-------|----------|');
  const sorted = [...report.sizing.godFiles].sort((a, b) => b.lines - a.lines);
  for (const f of sorted) {
    lines.push(`| ${f.path} | ${f.lines} | ${f.language} |`);
  }
  lines.push('');

  return lines;
}

function formatGit(report: ReportData): string[] {
  if (report.git.meta.status !== 'computed') return [];

  const lines: string[] = [];
  lines.push('## Git Analysis');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Commits | ${report.git.totalCommits} |`);
  lines.push(`| Contributors | ${report.git.contributors} |`);
  lines.push(`| Active Days | ${report.git.activeDays} |`);
  lines.push(`| Bus Factor | ${report.git.busFactor} |`);
  lines.push(`| Conventional Commits | ${report.git.conventionalCommitPercent}% |`);
  if (report.git.firstCommitDate) {
    lines.push(`| First Commit | ${formatDate(report.git.firstCommitDate)} |`);
  }
  if (report.git.lastCommitDate) {
    lines.push(`| Last Commit | ${formatDate(report.git.lastCommitDate)} |`);
  }
  lines.push(`| Commits/Week | ${report.git.commitFrequency.commitsPerWeek.toFixed(1)} |`);
  lines.push(`| Commits/Month | ${report.git.commitFrequency.commitsPerMonth.toFixed(1)} |`);
  lines.push('');

  if (report.git.topContributors.length > 0) {
    lines.push('### Top Contributors');
    lines.push('');
    lines.push('| Name | Email | Commits |');
    lines.push('|------|-------|---------|');
    for (const c of report.git.topContributors) {
      lines.push(`| ${c.name} | ${c.email} | ${c.commits} |`);
    }
    lines.push('');
  }

  return lines;
}

function formatDependencies(report: ReportData): string[] {
  if (report.dependencies.meta.status !== 'computed') return [];

  const lines: string[] = [];
  lines.push('## Dependencies');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Dependencies | ${report.dependencies.totalDependencies} |`);
  lines.push(`| Direct Dependencies | ${report.dependencies.directDependencies} |`);
  lines.push(`| Dev Dependencies | ${report.dependencies.devDependencies} |`);
  if (report.dependencies.packageManager) {
    lines.push(`| Package Manager | ${report.dependencies.packageManager} |`);
  }
  lines.push(`| Ecosystems | ${report.dependencies.ecosystems.join(', ') || 'None detected'} |`);
  lines.push('');

  if (report.dependencies.dependencies.length > 0) {
    lines.push('### Dependency List');
    lines.push('');
    lines.push('| Name | Version | Type | Ecosystem |');
    lines.push('|------|---------|------|-----------|');
    const deps = report.dependencies.dependencies.slice(0, 50);
    for (const d of deps) {
      lines.push(`| ${d.name} | ${d.version} | ${d.type} | ${d.ecosystem} |`);
    }
    if (report.dependencies.dependencies.length > 50) {
      lines.push('');
      lines.push(`*... and ${report.dependencies.dependencies.length - 50} more dependencies*`);
    }
    lines.push('');
  }

  return lines;
}

function formatSecurity(report: ReportData): string[] {
  const lines: string[] = [];

  if (report.security.meta.status === 'computed') {
    lines.push('## Security');
    lines.push('');
    if (report.security.secretsFound === 0) {
      lines.push('No secrets or credentials detected.');
    } else {
      lines.push(`**${report.security.secretsFound} potential secret(s) detected:**`);
      lines.push('');
      lines.push('| File | Line | Rule |');
      lines.push('|------|------|------|');
      for (const f of report.security.findings) {
        lines.push(`| ${f.file} | ${f.line} | ${f.ruleId} |`);
      }
    }
    lines.push('');
  } else if (report.security.meta.status === 'skipped') {
    lines.push('## Security');
    lines.push('');
    lines.push(`*Skipped: ${report.security.meta.reason ?? 'Unknown reason'}*`);
    lines.push('');
  }

  return lines;
}

function formatTechStack(report: ReportData): string[] {
  if (report.techStack.meta.status !== 'computed' || report.techStack.stack.length === 0) {
    return [];
  }

  const lines: string[] = [];
  lines.push('## Tech Stack');
  lines.push('');
  lines.push('| Tool | Category | Source |');
  lines.push('|------|----------|--------|');
  const sortedStack = [...report.techStack.stack].sort((a, b) => a.category.localeCompare(b.category));
  for (const entry of sortedStack) {
    lines.push(`| ${entry.name} | ${entry.category} | ${entry.source} |`);
  }
  lines.push('');

  return lines;
}

function formatEnvVars(report: ReportData): string[] {
  if (report.envVars.meta.status !== 'computed' || report.envVars.totalVars === 0) {
    return [];
  }

  // Filter out variables that only appear in test files
  const nonTestVars = report.envVars.variables.filter((v) => !isTestFilePath(v.file));

  // If all variables were in test files, skip the section entirely
  if (nonTestVars.length === 0) return [];

  const lines: string[] = [];
  lines.push('## Environment Variables');
  lines.push('');
  lines.push(`**${nonTestVars.length} environment variable(s) detected**`);
  lines.push('');

  // Recompute prefix counts from filtered variables
  const prefixCounts: Record<string, number> = {};
  for (const v of nonTestVars) {
    prefixCounts[v.prefix] = (prefixCounts[v.prefix] ?? 0) + 1;
  }

  const prefixes = Object.entries(prefixCounts).sort((a, b) => b[1] - a[1]);
  if (prefixes.length > 0) {
    lines.push('### By Prefix');
    lines.push('');
    lines.push('| Prefix | Count |');
    lines.push('|--------|-------|');
    for (const [prefix, count] of prefixes) {
      lines.push(`| ${prefix} | ${count} |`);
    }
    lines.push('');
  }

  // Show variable list (capped at 30)
  const vars = nonTestVars.slice(0, 30);
  lines.push('### Variables');
  lines.push('');
  lines.push('| Name | File | Line |');
  lines.push('|------|------|------|');
  for (const v of vars) {
    lines.push(`| ${v.name} | ${v.file} | ${v.line} |`);
  }
  if (nonTestVars.length > 30) {
    lines.push('');
    lines.push(`*... and ${nonTestVars.length - 30} more variables*`);
  }
  lines.push('');

  return lines;
}

function formatDuplication(report: ReportData): string[] {
  const lines: string[] = [];

  if (report.duplication.meta.status === 'computed') {
    lines.push('## Code Duplication');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Duplicate Lines | ${report.duplication.duplicateLines} |`);
    lines.push(`| Duplication % | ${report.duplication.duplicatePercentage.toFixed(1)}% |`);
    lines.push(`| Clone Pairs | ${report.duplication.totalClones} |`);
    lines.push('');

    if (report.duplication.clones.length > 0) {
      lines.push('### Largest Clones');
      lines.push('');
      lines.push('| First File | Lines | Second File | Lines |');
      lines.push('|------------|-------|-------------|-------|');
      const topClones = report.duplication.clones.slice(0, 10);
      for (const c of topClones) {
        lines.push(`| ${c.firstFile}:${c.firstStartLine}-${c.firstEndLine} | ${c.lines} | ${c.secondFile}:${c.secondStartLine}-${c.secondEndLine} | ${c.lines} |`);
      }
      lines.push('');
    }
  } else if (report.duplication.meta.status === 'skipped') {
    lines.push('## Code Duplication');
    lines.push('');
    lines.push(`*Skipped: ${report.duplication.meta.reason ?? 'Unknown reason'}*`);
    lines.push('');
  }

  return lines;
}

function formatArchitecture(report: ReportData): string[] {
  if (report.architecture.meta.status !== 'computed') return [];

  const lines: string[] = [];
  lines.push('## Architecture');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Imports | ${report.architecture.totalImports} |`);
  lines.push(`| Unique Modules | ${report.architecture.uniqueModules} |`);
  lines.push(`| Circular Dependencies | ${report.architecture.circularDependencies.length} |`);
  lines.push('');

  if (report.architecture.circularDependencies.length > 0) {
    lines.push('### Circular Dependencies');
    lines.push('');
    for (const cd of report.architecture.circularDependencies) {
      lines.push(`- ${cd.cycle.join(' → ')} → ${cd.cycle[0]}`);
    }
    lines.push('');
  }

  if (report.architecture.moduleCohesion.length > 0) {
    lines.push('### Module Cohesion');
    lines.push('');
    lines.push('| Module | Intra-module | Total | Cohesion Ratio |');
    lines.push('|--------|-------------|-------|----------------|');
    const sorted = [...report.architecture.moduleCohesion].sort((a, b) => b.cohesionRatio - a.cohesionRatio);
    for (const m of sorted) {
      lines.push(`| ${m.module} | ${m.intraImports} | ${m.totalImports} | ${m.cohesionRatio.toFixed(2)} |`);
    }
    lines.push('');
  }

  return lines;
}

function formatFooter(report: ReportData): string[] {
  const lines: string[] = [];
  lines.push('---');
  if (report.scoring) {
    lines.push(
      `*Grade: ${report.scoring.grade} (${report.scoring.normalizedScore}/100) | Completeness: ${report.meta.analysisCompleteness}% | Generated by codebase-analyzer v${report.meta.analyzerVersion}*`,
    );
  } else {
    lines.push(
      `*Completeness: ${report.meta.analysisCompleteness}% | Generated by codebase-analyzer v${report.meta.analyzerVersion}*`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function padRight(s: string, n: number): string {
  return s.padEnd(n);
}

function padLeft(s: string, n: number): string {
  return s.padStart(n);
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Maps a category score percentage to a 5-star rating string.
 * 0-20% = 1 star, 20-40% = 2, 40-60% = 3, 60-80% = 4, 80-100% = 5.
 */
function scoreToStars(cat: CategoryScore): string {
  if (cat.maxScore === 0) return starsString(0);
  const pct = (cat.score / cat.maxScore) * 100;
  return scoreToStarsFromPct(pct);
}

function scoreToStarsFromPct(pct: number): string {
  let filled: number;
  if (pct >= 80) filled = 5;
  else if (pct >= 60) filled = 4;
  else if (pct >= 40) filled = 3;
  else if (pct >= 20) filled = 2;
  else filled = 1;
  return starsString(filled);
}

function starsString(filled: number): string {
  const full = '\u2605'; // black star
  const empty = '\u2606'; // white star
  return full.repeat(filled) + empty.repeat(5 - filled);
}

interface CategorySummary {
  name: string;
  pct: number;
}

function getHighScoringCategories(scoring: ScoringResult, threshold: number): CategorySummary[] {
  const results: CategorySummary[] = [];
  for (const [name, cat] of Object.entries(scoring.categories)) {
    if (cat.maxScore === 0) continue;
    const pct = (cat.score / cat.maxScore) * 100;
    if (pct > threshold) {
      results.push({ name, pct });
    }
  }
  return results.sort((a, b) => b.pct - a.pct);
}

function getLowScoringCategories(scoring: ScoringResult, threshold: number): CategorySummary[] {
  const results: CategorySummary[] = [];
  for (const [name, cat] of Object.entries(scoring.categories)) {
    if (cat.maxScore === 0) continue;
    const pct = (cat.score / cat.maxScore) * 100;
    if (pct < threshold) {
      results.push({ name, pct });
    }
  }
  return results.sort((a, b) => a.pct - b.pct);
}
