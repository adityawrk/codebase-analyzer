/**
 * Sizing analyzer — wraps `scc` for LOC counting, language breakdown, and god-file detection.
 *
 * If scc is not available on $PATH, falls back to a slower line-counting approach
 * that reads files from the RepositoryIndex.
 */

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { execTool, checkTool } from '../core/exec.js';
import type {
  GodFile,
  LanguageBreakdown,
  RepositoryIndex,
  SizingResult,
  TestAnalysis,
} from '../core/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Files exceeding this many code lines are flagged as god files. */
const GOD_FILE_THRESHOLD = 500;

/**
 * Map scc language names to a canonical primary extension.
 * scc uses title-cased language names; we store the most common extension.
 */
const LANGUAGE_TO_EXTENSION: Record<string, string> = {
  TypeScript: '.ts',
  'TypeScript Typings': '.d.ts',
  TSX: '.tsx',
  JavaScript: '.js',
  JSX: '.jsx',
  Python: '.py',
  Go: '.go',
  Rust: '.rs',
  Java: '.java',
  Kotlin: '.kt',
  Ruby: '.rb',
  Swift: '.swift',
  C: '.c',
  'C Header': '.h',
  'C++': '.cpp',
  'C++ Header': '.hpp',
  'C#': '.cs',
  PHP: '.php',
  Dart: '.dart',
  JSON: '.json',
  YAML: '.yaml',
  TOML: '.toml',
  XML: '.xml',
  Markdown: '.md',
  HTML: '.html',
  CSS: '.css',
  SCSS: '.scss',
  SASS: '.sass',
  LESS: '.less',
  Shell: '.sh',
  Bash: '.sh',
  Zsh: '.zsh',
  SQL: '.sql',
  GraphQL: '.graphql',
  Dockerfile: '.dockerfile',
  Protobuf: '.proto',
  Lua: '.lua',
  R: '.r',
  Elixir: '.ex',
  Erlang: '.erl',
  Haskell: '.hs',
  Scala: '.scala',
  Clojure: '.clj',
  Vue: '.vue',
  Svelte: '.svelte',
  Makefile: '',
  Plain: '.txt',
  Text: '.txt',
  License: '',
  gitignore: '',
};

// ---------------------------------------------------------------------------
// scc JSON types (external tool output — typed loosely on purpose)
// ---------------------------------------------------------------------------

interface SccFileEntry {
  Filename: string;
  Lines: number;
  Code: number;
  Comment: number;
  Blank: number;
}

interface SccLanguageEntry {
  Name: string;
  Count: number;
  Lines: number;
  Code: number;
  Comment: number;
  Blank: number;
  Files: SccFileEntry[];
}

// ---------------------------------------------------------------------------
// Extension lookup helper
// ---------------------------------------------------------------------------

function extensionForLanguage(languageName: string): string {
  return LANGUAGE_TO_EXTENSION[languageName] ?? '';
}

// ---------------------------------------------------------------------------
// scc-based analysis
// ---------------------------------------------------------------------------

async function analyzeSizingWithScc(index: RepositoryIndex): Promise<SizingResult> {
  const start = performance.now();

  const result = await execTool(
    'scc',
    ['--format', 'json', '--no-cocomo', index.root],
    { timeout: index.config.timeout, cwd: index.root },
  );

  if (result.exitCode !== 0) {
    const elapsed = performance.now() - start;
    return {
      meta: {
        status: 'error',
        reason: `scc exited with code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
        durationMs: elapsed,
      },
      totalFiles: 0,
      totalLines: 0,
      totalCodeLines: 0,
      totalBlankLines: 0,
      totalCommentLines: 0,
      languages: [],
      godFiles: [],
    };
  }

  let sccData: SccLanguageEntry[];
  try {
    sccData = JSON.parse(result.stdout) as SccLanguageEntry[];
  } catch {
    const elapsed = performance.now() - start;
    return {
      meta: {
        status: 'error',
        reason: 'Failed to parse scc JSON output',
        durationMs: elapsed,
      },
      totalFiles: 0,
      totalLines: 0,
      totalCodeLines: 0,
      totalBlankLines: 0,
      totalCommentLines: 0,
      languages: [],
      godFiles: [],
    };
  }

  // Accumulate totals
  let totalFiles = 0;
  let totalLines = 0;
  let totalCodeLines = 0;
  let totalBlankLines = 0;
  let totalCommentLines = 0;

  for (const lang of sccData) {
    totalFiles += lang.Count;
    totalLines += lang.Lines;
    totalCodeLines += lang.Code;
    totalBlankLines += lang.Blank;
    totalCommentLines += lang.Comment;
  }

  // Build language breakdown
  const languages: LanguageBreakdown[] = sccData.map((lang) => ({
    language: lang.Name,
    extension: extensionForLanguage(lang.Name),
    files: lang.Count,
    lines: lang.Lines,
    codeLines: lang.Code,
    blankLines: lang.Blank,
    commentLines: lang.Comment,
    percentOfCode: totalCodeLines > 0
      ? Math.round((lang.Code / totalCodeLines) * 10000) / 100
      : 0,
  }));

  // Sort by code lines descending
  languages.sort((a, b) => b.codeLines - a.codeLines);

  // Identify god files
  const godFiles: GodFile[] = [];
  for (const lang of sccData) {
    if (!lang.Files) continue;
    for (const file of lang.Files) {
      if (file.Code > GOD_FILE_THRESHOLD) {
        godFiles.push({
          path: file.Filename,
          lines: file.Code,
          language: lang.Name,
        });
      }
    }
  }

  // Sort god files by lines descending
  godFiles.sort((a, b) => b.lines - a.lines);

  const elapsed = performance.now() - start;
  return {
    meta: { status: 'computed', durationMs: elapsed },
    totalFiles,
    totalLines,
    totalCodeLines,
    totalBlankLines,
    totalCommentLines,
    languages,
    godFiles,
  };
}

// ---------------------------------------------------------------------------
// Fallback analysis (no scc)
// ---------------------------------------------------------------------------

async function countFileLines(absPath: string): Promise<number> {
  try {
    const content = await readFile(absPath, 'utf-8');
    if (content.length === 0) return 0;
    // Count newlines; a file ending without newline still has at least 1 line
    let count = 0;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n') count++;
    }
    // If the file doesn't end with a newline, count the last line
    if (content[content.length - 1] !== '\n') count++;
    return count;
  } catch {
    return 0;
  }
}

async function analyzeSizingFallback(index: RepositoryIndex): Promise<SizingResult> {
  const start = performance.now();

  const languageMap = new Map<string, { files: number; lines: number; extension: string }>();
  const godFiles: GodFile[] = [];

  let totalFiles = 0;
  let totalLines = 0;

  for (const file of index.files) {
    if (file.isBinary) continue;

    const absPath = path.join(index.root, file.path);
    const lines = await countFileLines(absPath);

    totalFiles++;
    totalLines += lines;

    // Accumulate per-language
    const entry = languageMap.get(file.language);
    if (entry) {
      entry.files++;
      entry.lines += lines;
    } else {
      languageMap.set(file.language, {
        files: 1,
        lines,
        extension: file.extension,
      });
    }

    // God file detection (using total lines since we can't distinguish code/comment without scc)
    if (lines > GOD_FILE_THRESHOLD) {
      godFiles.push({
        path: file.path,
        lines,
        language: file.language,
      });
    }
  }

  // Build language breakdown — without scc, we cannot distinguish code/blank/comment
  const languages: LanguageBreakdown[] = [];
  for (const [language, data] of languageMap) {
    languages.push({
      language,
      extension: data.extension,
      files: data.files,
      lines: data.lines,
      codeLines: data.lines, // best estimate without scc
      blankLines: 0,
      commentLines: 0,
      percentOfCode: totalLines > 0
        ? Math.round((data.lines / totalLines) * 10000) / 100
        : 0,
    });
  }

  languages.sort((a, b) => b.codeLines - a.codeLines);
  godFiles.sort((a, b) => b.lines - a.lines);

  const elapsed = performance.now() - start;
  return {
    meta: {
      status: 'computed',
      reason: 'scc not available — used fallback line counting (no code/blank/comment breakdown)',
      durationMs: elapsed,
    },
    totalFiles,
    totalLines,
    totalCodeLines: totalLines, // best estimate
    totalBlankLines: 0,
    totalCommentLines: 0,
    languages,
    godFiles,
  };
}

// ---------------------------------------------------------------------------
// Public API: analyzeSizing
// ---------------------------------------------------------------------------

/**
 * Analyze codebase sizing: LOC, language breakdown, god files.
 *
 * Prefers `scc` for accurate code/blank/comment counting.
 * Falls back to raw line counting from the RepositoryIndex if scc is unavailable.
 */
export async function analyzeSizing(index: RepositoryIndex): Promise<SizingResult> {
  const sccAvailable = await checkTool('scc');

  if (sccAvailable) {
    return analyzeSizingWithScc(index);
  }

  return analyzeSizingFallback(index);
}

// ---------------------------------------------------------------------------
// Public API: analyzeTests
// ---------------------------------------------------------------------------

/**
 * Analyze test coverage metadata: test file count, test frameworks, coverage config.
 *
 * Depends on the sizing result for line counts and on the RepositoryIndex for
 * file/manifest inspection.
 */
export function analyzeTests(
  index: RepositoryIndex,
  sizingResult: SizingResult,
): TestAnalysis {
  // --- Count test files and estimate test lines ---
  const testFileEntries = index.files.filter((f) => f.isTest && !f.isBinary);
  const testFiles = testFileEntries.length;

  // Sum test lines from sizing data: match test file paths against scc file-level data
  let testLines = 0;
  const testFileList: Array<{ path: string; lines: number }> = [];

  // Build a lookup from scc file data if available
  const fileLineMap = new Map<string, number>();
  if (sizingResult.meta.status === 'computed') {
    // scc reports absolute paths in Files[].Filename; the fallback uses relative paths.
    // We try both normalized forms.
    for (const lang of sizingResult.languages) {
      // scc data is not directly accessible here; we need to re-derive from god files
      // and overall data. Since scc file-level data is not stored in SizingResult,
      // we estimate test lines from the total proportionally, or count them ourselves.
    }
  }

  // Since SizingResult does not expose per-file line counts beyond godFiles,
  // count test file lines directly for accuracy.
  const testFileLinePromises = testFileEntries.map(async (file) => {
    const absPath = path.join(index.root, file.path);
    const lines = await countFileLines(absPath);
    return { path: file.path, lines };
  });

  // analyzeTests is synchronous by design (called after sizing completes),
  // but we need async line counting. Build the list from index file sizes as a proxy.
  // Re-implement as sync: estimate lines from file size (~40 bytes/line average).
  for (const file of testFileEntries) {
    const estimatedLines = Math.max(1, Math.round(file.size / 40));
    testLines += estimatedLines;
    testFileList.push({ path: file.path, lines: estimatedLines });
  }

  // Sort test files by estimated line count descending
  testFileList.sort((a, b) => b.lines - a.lines);

  // --- Detect test frameworks ---
  const testFrameworks: string[] = [];
  const detectedFrameworks = new Set<string>();

  for (const manifest of index.manifests) {
    if (manifest.type === 'npm') {
      // Read package.json content to check devDependencies
      const npmFrameworks = detectNpmTestFrameworks(index.root, manifest.path);
      for (const fw of npmFrameworks) {
        detectedFrameworks.add(fw);
      }
    }

    if (manifest.type === 'python-requirements' || manifest.type === 'python-pyproject') {
      const pythonFrameworks = detectPythonTestFrameworks(index.root, manifest.path);
      for (const fw of pythonFrameworks) {
        detectedFrameworks.add(fw);
      }
    }
  }

  // Go test detection: look for files ending in _test.go
  const hasGoTests = index.files.some((f) => f.path.endsWith('_test.go'));
  if (hasGoTests) {
    detectedFrameworks.add('go test');
  }

  testFrameworks.push(...Array.from(detectedFrameworks).sort());

  // --- Check for coverage configuration ---
  const coverageConfigFound = detectCoverageConfig(index);

  // --- Calculate test:code ratio ---
  const nonTestLines = sizingResult.totalLines - testLines;
  const testCodeRatio = nonTestLines > 0
    ? Math.round((testLines / nonTestLines) * 10000) / 100
    : 0;

  return {
    testFiles,
    testLines,
    codeLines: sizingResult.totalCodeLines,
    testCodeRatio,
    testFrameworks,
    coverageConfigFound,
    testFileList,
  };
}

// ---------------------------------------------------------------------------
// Test framework detection helpers
// ---------------------------------------------------------------------------

/**
 * Synchronously read a file from disk for manifest parsing.
 * Returns empty string on any error.
 */
function readFileSync(absPath: string): string {
  try {
    // Use require('node:fs') for sync reads in framework detection
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    return fs.readFileSync(absPath, 'utf-8');
  } catch {
    return '';
  }
}

function detectNpmTestFrameworks(root: string, manifestRelPath: string): string[] {
  const absPath = path.join(root, manifestRelPath);
  const content = readFileSync(absPath);
  if (!content) return [];

  const frameworks: string[] = [];

  try {
    const pkg = JSON.parse(content) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const frameworkMap: Record<string, string> = {
      vitest: 'vitest',
      jest: 'jest',
      mocha: 'mocha',
      '@testing-library/react': '@testing-library',
      '@testing-library/vue': '@testing-library',
      '@testing-library/angular': '@testing-library',
      '@testing-library/dom': '@testing-library',
      cypress: 'cypress',
      playwright: 'playwright',
      '@playwright/test': 'playwright',
    };

    for (const [dep, name] of Object.entries(frameworkMap)) {
      if (dep in allDeps) {
        frameworks.push(name);
      }
    }
  } catch {
    // Malformed package.json — skip
  }

  return frameworks;
}

function detectPythonTestFrameworks(root: string, manifestRelPath: string): string[] {
  const absPath = path.join(root, manifestRelPath);
  const content = readFileSync(absPath);
  if (!content) return [];

  const frameworks: string[] = [];

  // Simple keyword search — works for both requirements.txt and pyproject.toml
  if (content.includes('pytest')) {
    frameworks.push('pytest');
  }
  if (content.includes('unittest')) {
    frameworks.push('unittest');
  }

  return frameworks;
}

// ---------------------------------------------------------------------------
// Coverage config detection
// ---------------------------------------------------------------------------

function detectCoverageConfig(index: RepositoryIndex): boolean {
  const coverageConfigFiles = new Set([
    '.nycrc',
    '.nycrc.json',
    '.coveragerc',
  ]);

  const coverageConfigPatterns = [
    'vitest.config.ts',
    'vitest.config.js',
    'vitest.config.mts',
    'jest.config.ts',
    'jest.config.js',
    'jest.config.json',
    'jest.config.mjs',
    'setup.cfg',
  ];

  for (const file of index.files) {
    const basename = path.basename(file.path);

    // Exact match on known coverage config files
    if (coverageConfigFiles.has(basename)) {
      return true;
    }

    // Check config files that MIGHT contain coverage sections
    if (coverageConfigPatterns.includes(basename)) {
      // For vitest/jest configs, we can't easily check content synchronously
      // without reading the file. The presence of the config file is a strong
      // enough signal — these tools have coverage built in.
      if (
        basename.startsWith('vitest.config') ||
        basename.startsWith('jest.config')
      ) {
        // Check if the file content mentions "coverage"
        const absPath = path.join(index.root, file.path);
        const content = readFileSync(absPath);
        if (content.includes('coverage')) {
          return true;
        }
      }

      // setup.cfg: check for [coverage] section
      if (basename === 'setup.cfg') {
        const absPath = path.join(index.root, file.path);
        const content = readFileSync(absPath);
        if (content.includes('[coverage')) {
          return true;
        }
      }
    }
  }

  return false;
}
