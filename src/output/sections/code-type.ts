/**
 * Code Type Breakdown section formatter.
 * Heuristic classification of language entries into Frontend/Backend/Infra/Config/Test/Other.
 */

import * as path from 'node:path';
import type { ReportData, LanguageBreakdown } from '../../core/types.js';
import {
  NON_CODE_LANGUAGES,
  detectHasFrontendFramework,
  getTopLanguageName,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Extension sets for heuristic code-type classification.
// Extensions are lowercase with leading dot. Language names (from scc) are
// matched case-insensitively as a fallback when the extension field is empty.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Detection helpers for primary classification
// ---------------------------------------------------------------------------

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
  // Tree strings contain box-drawing characters.
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

// ---------------------------------------------------------------------------
// Main section formatter
// ---------------------------------------------------------------------------

export function formatCodeTypeBreakdown(report: ReportData): string[] {
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
