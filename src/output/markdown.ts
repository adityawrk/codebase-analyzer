/**
 * Markdown report formatter.
 * Produces Proximal-format markdown from ReportData.
 *
 * Each section is a standalone formatter function returning string[].
 * The main `formatMarkdown` concatenates them all.
 */

import * as path from 'node:path';
import type {
  ReportData,
  LanguageBreakdown,
  ScoringResult,
  CategoryScore,
} from '../core/types.js';

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function formatMarkdown(report: ReportData): string {
  const lines: string[] = [
    ...formatHeader(report),
    ...formatSummary(report),
    ...formatScoring(report),
    ...formatLanguages(report),
    ...formatCodeTypeBreakdown(report),
    ...formatStructure(report),
    ...formatTests(report),
    ...formatHealth(report),
    ...formatComplexity(report),
    ...formatGodFiles(report),
    ...formatGit(report),
    ...formatDependencies(report),
    ...formatLargestFiles(report),
    ...formatSecurity(report),
    ...formatTechStack(report),
    ...formatConfigTooling(report),
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
      `| ${label.padEnd(10)} | ${String(lang.files).padStart(5)} | ${String(lang.lines).padStart(7)} | ${(String(pctRounded) + '%').padStart(4)} |`,
    );
  }
  lines.push('');
  lines.push(`**Total Lines of Code:** ${report.sizing.totalLines}`);
  lines.push('');

  return lines;
}

// ---------------------------------------------------------------------------
// Code Type Breakdown — heuristic classification by extension / language
// ---------------------------------------------------------------------------

/**
 * Extension sets for heuristic code-type classification.
 * Extensions are lowercase with leading dot. Language names (from scc) are
 * matched case-insensitively as a fallback when the extension field is empty.
 */
const FRONTEND_EXTENSIONS = new Set([
  '.jsx', '.tsx', '.vue', '.svelte',
  '.css', '.scss', '.less', '.sass',
  '.html', '.htm', '.hbs', '.ejs', '.pug', '.styl',
]);

const INFRA_EXTENSIONS = new Set([
  '.sh', '.bash', '.zsh', '.dockerfile',
]);

const INFRA_LANGUAGES = new Set([
  'shell', 'bash', 'zsh', 'dockerfile', 'makefile',
]);

const CONFIG_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml', '.xml',
  '.ini', '.cfg', '.conf', '.env',
]);

const CONFIG_LANGUAGES = new Set([
  'json', 'yaml', 'toml', 'xml',
]);

const DOC_EXTENSIONS = new Set([
  '.md', '.txt', '.rst', '.adoc', '.tex', '.rtf',
]);

const DOC_LANGUAGES = new Set([
  'markdown', 'plain text', 'text', 'license', 'plain',
  'restructuredtext', 'asciidoc',
]);

type CodeCategory = 'Frontend' | 'Backend' | 'Infrastructure' | 'Config' | 'Test' | 'Other';

interface CodeTypeBucket {
  files: number;
  lines: number;
}

/**
 * Classify a single LanguageBreakdown entry into a code-type category.
 * Uses extension first, then falls back to language name.
 */
function classifyLanguageEntry(lang: LanguageBreakdown): CodeCategory {
  const ext = lang.extension.toLowerCase();
  const name = lang.language.toLowerCase();

  if (FRONTEND_EXTENSIONS.has(ext)) return 'Frontend';
  if (INFRA_EXTENSIONS.has(ext) || INFRA_LANGUAGES.has(name)) return 'Infrastructure';
  if (CONFIG_EXTENSIONS.has(ext) || CONFIG_LANGUAGES.has(name)) return 'Config';
  if (DOC_EXTENSIONS.has(ext) || DOC_LANGUAGES.has(name)) return 'Other';

  // Everything else is treated as backend/application code
  return 'Backend';
}

/**
 * Determine primary classification label from the largest category.
 * Returns a string like "Backend Application" or "Frontend Application".
 */
function determinePrimaryClassification(
  buckets: Map<CodeCategory, CodeTypeBucket>,
  report: ReportData,
): string {
  // Find the top language for labelling
  let topLanguage = '';
  if (report.sizing.meta.status === 'computed' && report.sizing.languages.length > 0) {
    const sorted = [...report.sizing.languages].sort((a, b) => b.codeLines - a.codeLines);
    if (sorted[0]) topLanguage = sorted[0].language;
  }

  // Find the category with the most lines (excluding Test and Other for primary type)
  const codeCats: CodeCategory[] = ['Frontend', 'Backend', 'Infrastructure', 'Config'];
  let primary: CodeCategory = 'Backend';
  let maxLines = 0;
  for (const cat of codeCats) {
    const bucket = buckets.get(cat);
    if (bucket && bucket.lines > maxLines) {
      maxLines = bucket.lines;
      primary = cat;
    }
  }

  const suffix = topLanguage ? ` (${topLanguage})` : '';

  switch (primary) {
    case 'Frontend':
      return `Frontend Application${suffix}`;
    case 'Infrastructure':
      return `Infrastructure/DevOps${suffix}`;
    case 'Config':
      return `Configuration-Heavy${suffix}`;
    default:
      return `Backend Application${suffix}`;
  }
}

function formatCodeTypeBreakdown(report: ReportData): string[] {
  if (report.sizing.meta.status !== 'computed' || report.sizing.languages.length === 0) {
    return [];
  }

  // Step 1: Classify each language entry into a category bucket
  const buckets = new Map<CodeCategory, CodeTypeBucket>();
  const allCategories: CodeCategory[] = ['Frontend', 'Backend', 'Infrastructure', 'Config', 'Test', 'Other'];
  for (const cat of allCategories) {
    buckets.set(cat, { files: 0, lines: 0 });
  }

  for (const lang of report.sizing.languages) {
    const cat = classifyLanguageEntry(lang);
    const bucket = buckets.get(cat)!;
    bucket.files += lang.files;
    bucket.lines += lang.lines;
  }

  // Step 2: Carve out test files from the backend/frontend buckets.
  // Test lines are already counted in the language breakdown, so we redistribute
  // them into the Test bucket to avoid double-counting.
  if (report.testAnalysis.meta.status === 'computed' && report.testAnalysis.testFiles > 0) {
    const testBucket = buckets.get('Test')!;
    testBucket.files = report.testAnalysis.testFiles;
    testBucket.lines = report.testAnalysis.testLines;

    // Subtract test counts from Backend bucket (most test files are in code languages).
    // If Backend doesn't have enough, spill into Frontend.
    let testFilesRemaining = report.testAnalysis.testFiles;
    let testLinesRemaining = report.testAnalysis.testLines;

    for (const cat of ['Backend', 'Frontend'] as CodeCategory[]) {
      if (testFilesRemaining <= 0 && testLinesRemaining <= 0) break;
      const bucket = buckets.get(cat)!;

      const filesToSubtract = Math.min(testFilesRemaining, bucket.files);
      const linesToSubtract = Math.min(testLinesRemaining, bucket.lines);
      bucket.files -= filesToSubtract;
      bucket.lines -= linesToSubtract;
      testFilesRemaining -= filesToSubtract;
      testLinesRemaining -= linesToSubtract;
    }
  }

  // Step 3: Calculate total lines for percentages
  const totalLines = Array.from(buckets.values()).reduce((sum, b) => sum + b.lines, 0);
  if (totalLines === 0) return [];

  // Step 4: Build table rows, sorted by lines descending, omitting zero-line categories
  const rows = allCategories
    .map((cat) => ({ category: cat, ...buckets.get(cat)! }))
    .filter((r) => r.lines > 0)
    .sort((a, b) => b.lines - a.lines);

  const lines: string[] = [];
  lines.push('## Code Type Breakdown');
  lines.push('');
  lines.push('Analysis of code distribution by type (backend, frontend, shared/config).');
  lines.push('');
  lines.push('| Category | Files | Lines | % of Code |');
  lines.push('|----------|-------|-------|-----------|');
  for (const row of rows) {
    const pct = Math.round((row.lines / totalLines) * 100);
    lines.push(`| ${row.category} | ${row.files} | ${row.lines} | ${pct}% |`);
  }

  // Step 5: Primary classification sub-section
  const primaryLabel = determinePrimaryClassification(buckets, report);
  lines.push('');
  lines.push('### Primary Classification');
  lines.push('');
  lines.push(`This is primarily a **${primaryLabel}** codebase.`);
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
  if (report.testAnalysis.meta.status !== 'computed') return [];

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

  // Recent Commits
  if (report.git.recentCommits.length > 0) {
    lines.push('### Recent Commits');
    lines.push('');
    lines.push('| Hash | Message | Author | Age |');
    lines.push('|------|---------|--------|-----|');
    for (const c of report.git.recentCommits) {
      lines.push(`| ${c.hash} | ${c.message} | ${c.author} | ${c.date} |`);
    }
    lines.push('');
  }

  // Commit Message Quality
  lines.push('### Commit Message Quality');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Avg Message Length | ${report.git.avgMessageLength} chars |`);
  lines.push(`| Very Short Messages (<10 chars) | ${report.git.shortMessageCount} |`);
  lines.push(`| Conventional Commits | ${report.git.conventionalCommitPercent}% |`);
  lines.push('');

  // Commits That Include Tests
  lines.push('### Commits That Include Tests');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Commits Touching Test Files | ${report.git.commitsWithTests} |`);
  lines.push(`| % of All Commits | ${report.git.commitsWithTestsPercent}% |`);
  lines.push('');

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

function formatLargestFiles(report: ReportData): string[] {
  if (report.sizing.meta.status !== 'computed' || report.sizing.largestFiles.length === 0) {
    return [];
  }

  const lines: string[] = [];
  lines.push('## Largest Files');
  lines.push('');
  lines.push('| File | Lines |');
  lines.push('|------|-------|');
  for (const f of report.sizing.largestFiles) {
    lines.push(`| \`${f.path}\` | ${f.lines} |`);
  }
  lines.push('');

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

// ---------------------------------------------------------------------------
// Configuration & Tooling — combines techStack, repoHealth, and dependencies
// ---------------------------------------------------------------------------

/**
 * Config item definition for the Configuration & Tooling table.
 * Each item maps a display name to a detection strategy using existing report data.
 */
interface ConfigItem {
  /** Display name in the Tool/Config column */
  label: string;
  /**
   * Returns the detected file path/source if found, or null if not found.
   * Receives the full report to query techStack, repoHealth, dependencies, etc.
   */
  detect: (report: ReportData) => string | null;
}

/** Look up a tech stack entry by name (case-insensitive). */
function findTechStack(report: ReportData, name: string): string | null {
  if (report.techStack.meta.status !== 'computed') return null;
  const entry = report.techStack.stack.find(
    (e) => e.name.toLowerCase() === name.toLowerCase(),
  );
  return entry ? entry.source : null;
}

/** Look up a repo health check by id. */
function findHealthCheck(report: ReportData, id: string): string | null {
  if (report.repoHealth.meta.status !== 'computed') return null;
  const check = report.repoHealth.checks.find((c) => c.id === id);
  return check?.present ? (check.path ?? 'detected') : null;
}

/**
 * Ordered list of config items to check.
 * Each entry defines how to detect a tool/config from existing report data.
 * Items are checked in order and always displayed (found or not found).
 */
const CONFIG_ITEMS: ConfigItem[] = [
  {
    label: 'Package Manager',
    detect: (r) => {
      // Check for any ecosystem manifest via dependencies
      if (r.dependencies.meta.status === 'computed' && r.dependencies.packageManager) {
        return r.dependencies.packageManager;
      }
      // Fall back to tech stack for ecosystem-level package managers
      for (const eco of ['npm', 'cargo', 'go', 'python', 'maven', 'gradle']) {
        const src = findTechStack(r, eco);
        if (src) return src;
      }
      return null;
    },
  },
  {
    label: 'TypeScript',
    detect: (r) => findTechStack(r, 'TypeScript'),
  },
  {
    label: 'ESLint',
    detect: (r) => findTechStack(r, 'ESLint'),
  },
  {
    label: 'Prettier',
    detect: (r) => findTechStack(r, 'Prettier'),
  },
  {
    label: 'Biome',
    detect: (r) => findTechStack(r, 'Biome'),
  },
  {
    label: 'Bundler (Vite)',
    detect: (r) => findTechStack(r, 'Vite'),
  },
  {
    label: 'Bundler (Webpack)',
    detect: (r) => findTechStack(r, 'Webpack'),
  },
  {
    label: 'Tailwind CSS',
    detect: (r) => findTechStack(r, 'Tailwind CSS'),
  },
  {
    label: 'Docker',
    detect: (r) => {
      const ts = findTechStack(r, 'Docker');
      if (ts) return ts;
      return findHealthCheck(r, 'dockerfile');
    },
  },
  {
    label: 'Docker Compose',
    detect: (r) => findTechStack(r, 'Docker Compose'),
  },
  {
    label: 'GitHub Actions',
    detect: (r) => {
      const ts = findTechStack(r, 'GitHub Actions');
      if (ts) return ts;
      // Fall back to repoHealth CI check
      const ciCheck = findHealthCheck(r, 'ci');
      return ciCheck;
    },
  },
  {
    label: 'GitLab CI',
    detect: (r) => findTechStack(r, 'GitLab CI'),
  },
  {
    label: '.editorconfig',
    detect: (r) => findHealthCheck(r, 'editorconfig'),
  },
];

function formatConfigTooling(report: ReportData): string[] {
  // Build rows from config items, only including items that are relevant
  // (detected OR commonly expected for the ecosystem)
  const rows: Array<{ label: string; detected: boolean; file: string }> = [];

  for (const item of CONFIG_ITEMS) {
    const result = item.detect(report);
    rows.push({
      label: item.label,
      detected: result !== null,
      file: result ?? '',
    });
  }

  // Filter: only show items that are detected OR are commonly expected.
  // Remove bundler/CI/tool rows that aren't detected to avoid noise for
  // ecosystems where they don't apply. Always show: Package Manager,
  // TypeScript (if TS is in the stack), linters, Docker, CI.
  const alwaysShow = new Set([
    'Package Manager',
    'ESLint',
    'Prettier',
    'Docker',
    '.editorconfig',
  ]);

  // Show TypeScript row only if TS files exist in the sizing data
  const hasTypeScript = report.sizing.meta.status === 'computed' &&
    report.sizing.languages.some((l) => l.language === 'TypeScript');
  if (hasTypeScript) {
    alwaysShow.add('TypeScript');
  }

  // Show at least one CI row — prefer the one that's detected
  const anyCI = rows.some(
    (r) => (r.label === 'GitHub Actions' || r.label === 'GitLab CI') && r.detected,
  );
  if (!anyCI) {
    // Show GitHub Actions as the default "not found" CI row
    alwaysShow.add('GitHub Actions');
  }

  const filteredRows = rows.filter(
    (r) => r.detected || alwaysShow.has(r.label),
  );

  // If nothing is detected at all, skip the section
  if (filteredRows.every((r) => !r.detected)) {
    return [];
  }

  const lines: string[] = [];
  lines.push('## Configuration & Tooling');
  lines.push('');
  lines.push('| Tool/Config | Status | File |');
  lines.push('|-------------|--------|------|');
  for (const row of filteredRows) {
    if (row.detected) {
      lines.push(`| ${row.label} | \u2705 Configured | ${row.file} |`);
    } else {
      lines.push(`| ${row.label} | \u274C Not Found | |`);
    }
  }
  lines.push('');

  return lines;
}

function formatEnvVars(report: ReportData): string[] {
  if (report.envVars.meta.status !== 'computed' || report.envVars.totalVars === 0) {
    return [];
  }

  const vars = report.envVars.variables;
  if (vars.length === 0) return [];

  const lines: string[] = [];
  lines.push('## Environment Variables');
  lines.push('');
  lines.push(`**${vars.length} environment variable(s) detected**`);
  lines.push('');

  const prefixes = Object.entries(report.envVars.byPrefix).sort((a, b) => b[1] - a[1]);
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
  const displayed = vars.slice(0, 30);
  lines.push('### Variables');
  lines.push('');
  lines.push('| Name | File | Line |');
  lines.push('|------|------|------|');
  for (const v of displayed) {
    lines.push(`| ${v.name} | ${v.file} | ${v.line} |`);
  }
  if (vars.length > 30) {
    lines.push('');
    lines.push(`*... and ${vars.length - 30} more variables*`);
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

function capitalize(s: string): string {
  if (s.length === 0) return s;
  // Handle kebab-case: "repo-health" → "RepoHealth"
  return s
    .split('-')
    .map((part) => (part.length > 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join('');
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
