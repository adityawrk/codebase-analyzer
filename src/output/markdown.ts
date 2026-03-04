/**
 * Markdown report formatter.
 * Produces structured markdown from ReportData.
 *
 * Each section is a standalone formatter function returning string[].
 * The main `formatMarkdown` concatenates them all.
 */

import * as path from 'node:path';
import type {
  ReportData,
  LanguageBreakdown,
  SizingResult,
} from '../core/types.js';

// ---------------------------------------------------------------------------
// Non-code language filter — used to find the real "top language" for classification
// ---------------------------------------------------------------------------

/** Languages that are not source code — filtered from Language Breakdown and classification. */
const NON_CODE_LANGUAGES = new Set([
  'markdown', 'json', 'jsonl', 'jsonc', 'yaml', 'toml', 'xml',
  'plain text', 'text', 'plain',
  'license', 'gitignore', 'docker ignore',
  'svg', 'csv', 'ini',
  'properties file', 'batch', 'patch',
  'gemfile', 'rakefile', 'makefile',
  'restructuredtext', 'asciidoc',
]);

/** JS/TS language set for ESLint/Prettier relevance check */
const JS_TS_LANGUAGES = new Set([
  'JavaScript', 'TypeScript', 'JSX', 'TSX', 'TypeScript Typings',
]);

/** Check if the project has a frontend framework AND actual frontend component files (.tsx/.jsx/.vue/.svelte). */
function detectHasFrontendFramework(report: ReportData): boolean {
  if (report.sizing.meta.status !== 'computed') return false;

  // Check 1: Definitive frontend rendering libraries in deps.
  // react-dom, vue, svelte, @angular/core are ONLY used in browser/UI contexts.
  // Unlike bare "react" (which Hono uses for JSX typings), these are unambiguous.
  if (report.dependencies.meta.status === 'computed') {
    const renderingLibs = new Set(['react-dom', 'vue', 'svelte', '@angular/core', 'solid-js', 'preact']);
    const hasRenderingLib = report.dependencies.dependencies.some(
      (dep) => renderingLibs.has(dep.name.toLowerCase()),
    );
    if (hasRenderingLib) return true;
  }

  // Check 2: Explicit frontend component file extensions (.tsx/.jsx/.vue/.svelte).
  // Note: scc may merge .tsx into "TypeScript", so this check alone is insufficient.
  const hasFrontendFiles = report.sizing.languages.some(
    (l) => l.language === 'TSX' || l.language === 'JSX' ||
      l.extension === '.tsx' || l.extension === '.jsx' ||
      l.extension === '.vue' || l.extension === '.svelte',
  );
  if (!hasFrontendFiles) return false;

  // With frontend files present, check for framework entries
  if (report.techStack.meta.status === 'computed') {
    const frameworkNames = new Set(['react', 'vue', 'svelte', 'angular', 'next.js', 'nuxt', 'remix', 'gatsby', 'solid', 'preact']);
    for (const entry of report.techStack.stack) {
      if (frameworkNames.has(entry.name.toLowerCase())) return true;
    }
  }
  if (report.dependencies.meta.status === 'computed') {
    const frontendPkgs = new Set(['react', 'next', 'nuxt', 'remix', 'gatsby']);
    for (const dep of report.dependencies.dependencies) {
      if (frontendPkgs.has(dep.name.toLowerCase())) return true;
    }
  }
  return false;
}

/** Check if JS/TS is a significant part of the codebase (>= 5% of code lines) */
function hasJsTsLanguages(sizing: SizingResult): boolean {
  if (sizing.meta.status !== 'computed') return false;
  const jsTsLines = sizing.languages
    .filter((l) => JS_TS_LANGUAGES.has(l.language))
    .reduce((sum, l) => sum + l.codeLines, 0);
  return jsTsLines > 0 && (sizing.totalCodeLines === 0 || jsTsLines / sizing.totalCodeLines >= 0.05);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function formatMarkdown(report: ReportData): string {
  const lines: string[] = [
    ...formatHeader(report),
    ...formatSummary(report),
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
    `**Directory:** \`${path.basename(report.meta.directory)}\``,
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
    // Use code-only total: sum lines from non-filtered languages only
    const codeOnlyTotal = report.sizing.languages
      .filter((l) => !NON_CODE_LANGUAGES.has(l.language.toLowerCase()))
      .reduce((sum, l) => sum + l.lines, 0);
    lines.push(`| Total Lines of Code | ${codeOnlyTotal} |`);
  }

  // Languages detected (count) — exclude non-code languages
  if (report.sizing.meta.status === 'computed' && report.sizing.languages.length > 0) {
    const codeLanguageCount = report.sizing.languages.filter(
      (l) => !NON_CODE_LANGUAGES.has(l.language.toLowerCase()),
    ).length;
    if (codeLanguageCount > 0) {
      lines.push(`| Languages Detected | ${codeLanguageCount} |`);
    }
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

  // Analysis completeness note — always show
  lines.push(`**Analysis Completeness:** ${report.meta.analysisCompleteness}%`);
  lines.push('');

  return lines;
}


function formatLanguages(report: ReportData): string[] {
  if (report.sizing.meta.status !== 'computed' || report.sizing.languages.length === 0) {
    return [];
  }

  // Filter out non-code languages (License, Plain Text, Markdown, JSON, etc.)
  const codeLanguages = report.sizing.languages.filter(
    (l) => !NON_CODE_LANGUAGES.has(l.language.toLowerCase()),
  );
  if (codeLanguages.length === 0) return [];

  // Recalculate percentages based on code-only total
  const codeTotalLines = codeLanguages.reduce((sum, l) => sum + l.codeLines, 0);

  const lines: string[] = [];
  lines.push('## Language Breakdown');
  lines.push('| Extension | Files | Lines | % of Code |');
  lines.push('|-----------|-------|-------|-----------|');
  const sorted = [...codeLanguages].sort((a, b) => b.lines - a.lines);
  for (const lang of sorted) {
    const pct = codeTotalLines > 0 ? Math.round((lang.codeLines / codeTotalLines) * 100) : 0;
    const label = lang.extension || lang.language;
    lines.push(
      `| ${label.padEnd(10)} | ${String(lang.files).padStart(5)} | ${String(lang.lines).padStart(7)} | ${(String(pct) + '%').padStart(4)} |`,
    );
  }
  lines.push('');
  const totalLinesDisplayed = codeLanguages.reduce((sum, l) => sum + l.lines, 0);
  lines.push(`**Total Lines of Code:** ${totalLinesDisplayed}`);
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
 * When a frontend framework is detected, .ts/.js files are classified as Frontend.
 */
function classifyLanguageEntry(lang: LanguageBreakdown, hasFrontend: boolean): CodeCategory {
  const ext = lang.extension.toLowerCase();
  const name = lang.language.toLowerCase();

  if (FRONTEND_EXTENSIONS.has(ext)) return 'Frontend';
  if (INFRA_EXTENSIONS.has(ext) || INFRA_LANGUAGES.has(name)) return 'Infrastructure';
  if (CONFIG_EXTENSIONS.has(ext) || CONFIG_LANGUAGES.has(name)) return 'Config';
  if (DOC_EXTENSIONS.has(ext) || DOC_LANGUAGES.has(name)) return 'Other';

  // When a frontend framework is detected, classify JS/TS as Frontend
  if (hasFrontend && (ext === '.ts' || ext === '.js' || ext === '.tsx' || ext === '.jsx')) {
    return 'Frontend';
  }

  // Everything else is treated as backend/application code
  return 'Backend';
}

/**
 * Check for mobile application signals in tech stack.
 * Only returns true if there are strong app signals (not just SDK presence in a library).
 */
function detectMobileApp(report: ReportData): boolean {
  if (report.techStack.meta.status !== 'computed') return false;
  const mobileSignals = new Set([
    'android sdk', 'react native', 'flutter', 'swiftui', 'uikit',
    'kotlin multiplatform', 'jetpack compose', 'expo',
  ]);
  const hasMobileSignal = report.techStack.stack.some((e) => mobileSignals.has(e.name.toLowerCase()));
  if (!hasMobileSignal) return false;

  // Android SDK alone is insufficient — many JVM libraries support Android without being apps.
  // Require actual app structure: check for Android manifest or app-level source files.
  if (report.repoHealth.meta.status === 'computed') {
    const hasAppManifest = report.repoHealth.checks.some(
      (c) => c.present && c.path && /AndroidManifest\.xml/i.test(c.path),
    );
    if (hasAppManifest) return true;
  }
  // Check if the repo has app source directories typical of mobile apps.
  // Match standalone directory names only — e.g. "app/" but not "android-test-app/".
  // Tree strings contain box-drawing characters (├── └──).
  if (report.structure.meta.status === 'computed') {
    const tree = report.structure.treeString;
    // Match standalone "app/", "ios/", "android/" directory names — not substrings like "android-test-app/"
    const hasAppDir = /(?:^|[\s])(?:app|ios|android)\//.test(tree);
    if (hasAppDir) return true;
  }
  // Fallback: non-Android mobile frameworks are strong app signals
  const strongMobileSignals = new Set(['react native', 'flutter', 'swiftui', 'uikit', 'expo']);
  return report.techStack.stack.some((e) => strongMobileSignals.has(e.name.toLowerCase()));
}

/**
 * Check for library signals: published package without app entry point.
 * Detects npm libs, PyPI packages, Rust crates, Ruby gems, Go modules.
 */
function detectLibrary(report: ReportData): boolean {
  if (report.dependencies.meta.status !== 'computed') return false;

  const ecosystems = report.dependencies.ecosystems.map((e) => e.toLowerCase());

  // Go modules and Cargo crates are usually libraries (CLI tools caught earlier)
  if (ecosystems.includes('go') || ecosystems.includes('cargo')) return true;

  // Gradle/Maven: Kotlin/Java libraries (mobile apps caught at Priority 1, frameworks at Priority 2)
  if (ecosystems.includes('gradle') || ecosystems.includes('maven')) {
    const topLang = getTopLanguageName(report);
    if (/^(kotlin|java)$/i.test(topLang)) {
      // Only classify as library if no web/server framework in tech stack
      const jvmServerFrameworks = new Set([
        'spring', 'spring boot', 'ktor', 'micronaut', 'quarkus',
        'dropwizard', 'play', 'grails', 'vertx', 'spark java',
      ]);
      const hasServerFramework = report.techStack.meta.status === 'computed' &&
        report.techStack.stack.some((e) => jvmServerFrameworks.has(e.name.toLowerCase()));
      if (!hasServerFramework) return true;
    }
  }

  // npm/pypi packages that are NOT apps — detect by absence of app-level frameworks.
  // Only check DIRECT (non-dev) dependencies — dev deps like express (for testing) shouldn't
  // prevent library classification for packages like axios or markdown-it.
  const appFrameworks = new Set([
    // Node.js backend frameworks
    'express', 'fastify', 'koa', 'hapi', 'nest', '@nestjs/core',
    // Python backend frameworks
    'flask', 'fastapi', 'django', 'tornado', 'starlette',
    // Ruby frameworks
    'rails', 'sinatra',
    // Frontend rendering (already classified as frontend, not library)
    'react-dom', 'vue', 'svelte', '@angular/core', 'solid-js', 'preact',
    'next', 'nuxt', 'remix', 'gatsby',
  ]);

  const hasAppFramework = report.dependencies.dependencies.some(
    (dep) => dep.type !== 'dev' && appFrameworks.has(dep.name.toLowerCase()),
  );

  // Don't classify as library if it has frontend rendering signals
  if (detectHasFrontendFramework(report)) return false;

  // Only apply ecosystem-based library detection when the ecosystem matches the
  // primary language. Prevents e.g. redis (C server with a few Python test scripts)
  // from being classified as a Python library.
  const topLang = getTopLanguageName(report);
  const ecosystemMatchesLang =
    (ecosystems.includes('npm') && /typescript|javascript|tsx|jsx/i.test(topLang)) ||
    (ecosystems.includes('pypi') && /python/i.test(topLang));

  if (!hasAppFramework && ecosystemMatchesLang) {
    return true;
  }

  return false;
}

/** Get the top code language name from sizing data. */
function getTopLanguageName(report: ReportData): string {
  if (report.sizing.meta.status !== 'computed' || report.sizing.languages.length === 0) return '';
  const codeOnly = report.sizing.languages.filter(
    (l) => !NON_CODE_LANGUAGES.has(l.language.toLowerCase()),
  );
  const sorted = [...codeOnly].sort((a, b) => b.codeLines - a.codeLines);
  return sorted[0]?.language ?? '';
}

/**
 * Detect if the project IS a framework (e.g. FastAPI, Hono, Express).
 * A framework is a published package that other projects depend on — it provides
 * the same name as its package in its own tech stack (since it IS that thing).
 */
function detectFramework(report: ReportData): boolean {
  if (report.dependencies.meta.status !== 'computed') return false;
  if (report.techStack.meta.status !== 'computed') return false;

  // Known framework package names that are themselves frameworks
  const frameworkNames = new Set([
    'express', 'fastify', 'koa', 'hapi', '@nestjs/core',
    'flask', 'fastapi', 'django', 'tornado', 'starlette',
    'actix-web', 'axum', 'rocket', 'warp',
    'gin', 'echo', 'fiber', 'chi',
    'rails', 'sinatra',
    'spring', 'spring boot',
    'hono',
  ]);

  // If the project's directory name matches a known framework, it's likely THE framework
  const repoName = path.basename(report.meta.directory).toLowerCase().replace(/[^a-z0-9]/g, '');
  return frameworkNames.has(repoName) || [...frameworkNames].some((f) => f.replace(/[^a-z0-9]/g, '') === repoName);
}

/**
 * Detect if the project is a CLI tool.
 * Uses multiple signals: CLI framework deps, binary entry points, and language context.
 */
function detectCLITool(report: ReportData): boolean {
  const topLang = getTopLanguageName(report);
  const cliLangs = /^(rust|go|c|c\+\+|zig|nim|python)$/i;
  if (!cliLangs.test(topLang)) return false;

  // If the project IS a CLI/TUI framework/library itself, it's a library not a CLI tool
  const cliLibNames = new Set([
    'click', 'typer', 'bubbletea', 'bubble-tea', 'charm', 'ink', 'blessed',
    'urwid', 'rich', 'textual', 'prompt-toolkit', 'promptui',
  ]);
  const repoName = path.basename(report.meta.directory).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (cliLibNames.has(repoName)) return false;

  // No web framework in tech stack
  const webFrameworks = new Set([
    'actix web', 'axum', 'rocket', 'warp', 'gin', 'echo', 'fiber', 'chi',
    'flask', 'fastapi', 'django', 'express', 'fastify',
  ]);
  const hasWebFramework = report.techStack.stack.some((e) => webFrameworks.has(e.name.toLowerCase()));
  if (hasWebFramework) return false;

  // Signal 1: CLI framework deps (strong signal — only direct deps, not optional/dev)
  const cliFrameworks = new Set([
    'clap', 'structopt', 'argh',                    // Rust
    'cobra', 'urfave/cli', 'kingpin',                // Go
    'argparse', 'click', 'typer',                    // Python
  ]);
  if (report.dependencies.meta.status === 'computed') {
    const hasCLIDep = report.dependencies.dependencies.some(
      (dep) => dep.type === 'direct' && cliFrameworks.has(dep.name.toLowerCase()),
    );
    if (hasCLIDep) return true;
  }

  // Signal 2: Tech stack has CLI-related entries
  const cliTechNames = new Set(['clap', 'cobra', 'structopt', 'argparse']);
  const hasCLITech = report.techStack.meta.status === 'computed' &&
    report.techStack.stack.some((e) => cliTechNames.has(e.name.toLowerCase()));
  if (hasCLITech) return true;

  // Signal 3: Binary entry points in folder tree (main.rs, main.go, cmd/)
  if (report.structure.meta.status === 'computed') {
    const tree = report.structure.treeString;
    if (/(?:main\.rs|main\.go|cmd\/)/.test(tree)) return true;
  }

  // Signal 4: Binary entry point detected in file index (main.rs, main.go)
  // Only for compiled languages — Python __main__.py is too common in libraries
  if (report.sizing.meta.status === 'computed' && report.sizing.hasBinaryEntryPoint
      && /^(rust|go|c|c\+\+|zig|nim)$/i.test(topLang)) return true;

  // Signal 5: For C projects, small codebases with no library signals are likely CLI tools
  if (/^c$/i.test(topLang) && report.sizing.totalFiles < 50) return true;

  return false;
}

/**
 * Determine primary classification label from the largest category.
 * Returns a string like "Backend Application", "Library", "Mobile Application", etc.
 */
function determinePrimaryClassification(
  buckets: Map<CodeCategory, CodeTypeBucket>,
  report: ReportData,
): string {
  // Find the top CODE language for labelling (exclude non-code like Markdown, JSON, etc.)
  let topLanguage = '';
  if (report.sizing.meta.status === 'computed' && report.sizing.languages.length > 0) {
    const codeOnly = report.sizing.languages.filter(
      (l) => !NON_CODE_LANGUAGES.has(l.language.toLowerCase()),
    );
    const sorted = [...codeOnly].sort((a, b) => b.codeLines - a.codeLines);
    if (sorted[0]) topLanguage = sorted[0].language;
  }

  const suffix = topLanguage ? ` (${topLanguage})` : '';

  // Priority 1: Mobile application detection
  if (detectMobileApp(report)) {
    return `Mobile Application${suffix}`;
  }

  // Priority 2: Framework detection (project IS a framework, not just using one)
  if (detectFramework(report)) {
    return `Framework${suffix}`;
  }

  // Priority 3: CLI tool detection
  if (detectCLITool(report)) {
    return `CLI Tool${suffix}`;
  }

  // Priority 4: Library detection (Go/Rust modules are almost always libraries)
  if (detectLibrary(report)) {
    return `Library${suffix}`;
  }

  // Priority 3: Standard category-based classification
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
  const hasFrontend = detectHasFrontendFramework(report);
  const buckets = new Map<CodeCategory, CodeTypeBucket>();
  const allCategories: CodeCategory[] = ['Frontend', 'Backend', 'Infrastructure', 'Config', 'Test', 'Other'];
  for (const cat of allCategories) {
    buckets.set(cat, { files: 0, lines: 0 });
  }

  for (const lang of report.sizing.languages) {
    const cat = classifyLanguageEntry(lang, hasFrontend);
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
  if (report.complexity.meta.status === 'skipped') {
    return [
      '## Cyclomatic Complexity',
      '',
      `*Skipped: ${report.complexity.meta.reason ?? 'Unknown reason'}*`,
      '',
    ];
  }
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
  lines.push('## God Files (>500 Code Lines)');
  lines.push('');
  lines.push('Files exceeding 500 lines of code (blanks and comments excluded).');
  lines.push('');
  lines.push('| File | Code Lines | Language |');
  lines.push('|------|------------|----------|');
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
  lines.push('## Largest Files (Total Lines)');
  lines.push('');
  lines.push('Files with the most total lines (including blanks, comments, and code).');
  lines.push('');
  lines.push('| File | Total Lines |');
  lines.push('|------|-------------|');
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
      lines.push('| File | Line | Rule | Context |');
      lines.push('|------|------|------|---------|');
      for (const f of report.security.findings) {
        lines.push(`| ${f.file} | ${f.line} | ${f.ruleId} | ${f.context ?? 'production'} |`);
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
    'Docker',
    '.editorconfig',
  ]);

  // Only show ESLint/Prettier as expected items for JS/TS projects
  if (hasJsTsLanguages(report.sizing)) {
    alwaysShow.add('ESLint');
    alwaysShow.add('Prettier');
  }

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
        // Display actual range span for each file — avoids showing impossible
        // line counts when jscpd's fragment size doesn't match the range.
        const firstSpan = Math.max(c.firstEndLine - c.firstStartLine + 1, 1);
        const secondSpan = Math.max(c.secondEndLine - c.secondStartLine + 1, 1);
        lines.push(`| ${c.firstFile}:${c.firstStartLine}-${c.firstEndLine} | ${firstSpan} | ${c.secondFile}:${c.secondStartLine}-${c.secondEndLine} | ${secondSpan} |`);
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
  if (report.architecture.meta.status === 'skipped') {
    return [
      '## Architecture',
      '',
      `*Skipped: ${report.architecture.meta.reason ?? 'Unknown reason'}*`,
      '',
    ];
  }
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
  return [
    '---',
    `*Completeness: ${report.meta.analysisCompleteness}% | Generated by codebase-analyzer v${report.meta.analyzerVersion}*`,
  ];
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

