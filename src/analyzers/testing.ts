/**
 * Testing analyzer — dedicated test analysis with actual line counting.
 *
 * Replaces the basic `analyzeTests` in sizing.ts. Reads actual file content
 * to count lines (instead of estimating from file size) and includes its own
 * AnalyzerMeta for status tracking.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RepositoryIndex, SizingResult, TestAnalysis } from '../core/types.js';

// ---------------------------------------------------------------------------
// NPM test framework detection
// ---------------------------------------------------------------------------

const NPM_FRAMEWORK_MAP: Record<string, string> = {
  vitest: 'vitest',
  jest: 'jest',
  mocha: 'mocha',
  ava: 'ava',
  tap: 'tap',
  cypress: 'cypress',
  playwright: 'playwright',
  '@playwright/test': 'playwright',
  '@testing-library/react': '@testing-library',
  '@testing-library/vue': '@testing-library',
  '@testing-library/angular': '@testing-library',
  '@testing-library/dom': '@testing-library',
  '@testing-library/jest-dom': '@testing-library',
  '@testing-library/user-event': '@testing-library',
  '@testing-library/svelte': '@testing-library',
};

// ---------------------------------------------------------------------------
// JVM test framework patterns (Gradle / Maven)
// ---------------------------------------------------------------------------

const JVM_FRAMEWORK_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /junit/i, name: 'junit' },
  { pattern: /testng/i, name: 'testng' },
];

// ---------------------------------------------------------------------------
// Coverage config file names (exact match)
// ---------------------------------------------------------------------------

const COVERAGE_CONFIG_EXACT = new Set([
  '.nycrc',
  '.nycrc.json',
  '.coveragerc',
  '.codecov.yml',
  'codecov.yml',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a file's content, returning empty string on any error.
 * Respects the maxFileSize cap from config.
 */
async function safeReadFile(absPath: string, maxSize: number): Promise<string> {
  try {
    const stat = await fs.stat(absPath);
    if (stat.size > maxSize) return '';
    return await fs.readFile(absPath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Count lines in a string. Empty string returns 0.
 * A file with content but no trailing newline still counts the last line.
 */
function countLines(content: string): number {
  if (content.length === 0) return 0;
  let count = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') count++;
  }
  // If the file doesn't end with a newline, count the last line
  if (content[content.length - 1] !== '\n') count++;
  return count;
}

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

async function detectNpmFrameworks(
  root: string,
  manifestPath: string,
  maxSize: number,
): Promise<string[]> {
  const absPath = path.join(root, manifestPath);
  const content = await safeReadFile(absPath, maxSize);
  if (!content) return [];

  const frameworks: string[] = [];
  try {
    const pkg = JSON.parse(content) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    const allDeps: Record<string, string> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const seen = new Set<string>();
    for (const [dep, name] of Object.entries(NPM_FRAMEWORK_MAP)) {
      if (dep in allDeps && !seen.has(name)) {
        seen.add(name);
        frameworks.push(name);
      }
    }
  } catch {
    // Malformed package.json — skip
  }

  return frameworks;
}

async function detectPythonFrameworks(
  root: string,
  manifestPath: string,
  maxSize: number,
): Promise<string[]> {
  const absPath = path.join(root, manifestPath);
  const content = await safeReadFile(absPath, maxSize);
  if (!content) return [];

  const frameworks: string[] = [];
  if (content.includes('pytest')) frameworks.push('pytest');
  if (content.includes('unittest')) frameworks.push('unittest');
  return frameworks;
}

async function detectJvmFrameworks(
  root: string,
  manifestPath: string,
  maxSize: number,
): Promise<string[]> {
  const absPath = path.join(root, manifestPath);
  const content = await safeReadFile(absPath, maxSize);
  if (!content) return [];

  const frameworks: string[] = [];
  for (const { pattern, name } of JVM_FRAMEWORK_PATTERNS) {
    if (pattern.test(content)) {
      frameworks.push(name);
    }
  }
  return frameworks;
}

// ---------------------------------------------------------------------------
// Coverage config detection
// ---------------------------------------------------------------------------

async function detectCoverageConfig(
  index: RepositoryIndex,
): Promise<boolean> {
  for (const file of index.files) {
    const basename = path.basename(file.path);

    // Exact match on known coverage config files
    if (COVERAGE_CONFIG_EXACT.has(basename)) {
      return true;
    }

    // vitest/jest configs: check content for "coverage"
    if (
      basename.startsWith('vitest.config') ||
      basename.startsWith('jest.config')
    ) {
      const absPath = path.join(index.root, file.path);
      const content = await safeReadFile(absPath, index.config.maxFileSize);
      if (content.includes('coverage')) {
        return true;
      }
    }

    // setup.cfg: check for [coverage] section
    if (basename === 'setup.cfg') {
      const absPath = path.join(index.root, file.path);
      const content = await safeReadFile(absPath, index.config.maxFileSize);
      if (content.includes('[coverage')) {
        return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze test coverage metadata: test file count, actual line counts,
 * test frameworks, coverage configuration.
 *
 * Reads actual file content for line counting (no size estimation).
 * Never throws — returns error meta on failure.
 */
export async function analyzeTests(
  index: RepositoryIndex,
  sizing: SizingResult,
): Promise<TestAnalysis> {
  const start = performance.now();

  try {
    // --- Count test files and read actual line counts ---
    const testFileEntries = index.files.filter((f) => f.isTest && !f.isBinary);

    const testFileList: Array<{ path: string; lines: number }> = [];
    let testLines = 0;

    // Read all test files in parallel for line counting
    const lineResults = await Promise.all(
      testFileEntries.map(async (file) => {
        const absPath = path.join(index.root, file.path);
        const content = await safeReadFile(absPath, index.config.maxFileSize);
        const lines = countLines(content);
        return { path: file.path, lines };
      }),
    );

    for (const entry of lineResults) {
      testLines += entry.lines;
      testFileList.push(entry);
    }

    // Sort test files by line count descending
    testFileList.sort((a, b) => b.lines - a.lines);

    // --- Detect test frameworks ---
    const detectedFrameworks = new Set<string>();

    const frameworkPromises: Promise<string[]>[] = [];

    for (const manifest of index.manifests) {
      if (manifest.type === 'npm') {
        frameworkPromises.push(
          detectNpmFrameworks(index.root, manifest.path, index.config.maxFileSize),
        );
      }

      if (manifest.type === 'python-requirements' || manifest.type === 'python-pyproject') {
        frameworkPromises.push(
          detectPythonFrameworks(index.root, manifest.path, index.config.maxFileSize),
        );
      }

      if (manifest.type === 'gradle' || manifest.type === 'maven') {
        frameworkPromises.push(
          detectJvmFrameworks(index.root, manifest.path, index.config.maxFileSize),
        );
      }
    }

    // Go test detection: look for *_test.go files
    const hasGoTests = index.files.some((f) => f.path.endsWith('_test.go'));
    if (hasGoTests) {
      detectedFrameworks.add('go test');
    }

    const allFrameworkResults = await Promise.all(frameworkPromises);
    for (const frameworks of allFrameworkResults) {
      for (const fw of frameworks) {
        detectedFrameworks.add(fw);
      }
    }

    const testFrameworks = Array.from(detectedFrameworks).sort();

    // --- Check for coverage configuration ---
    const coverageConfigFound = await detectCoverageConfig(index);

    // --- Calculate test:code ratio ---
    // codeLines = total lines minus test lines. Uses scc's totalLines (all tracked lines).
    const totalLines = sizing.totalLines;
    const codeLines = totalLines > testLines ? totalLines - testLines : 0;
    // testCodeRatio = testLines / codeLines as a percentage.
    // "What fraction of non-test code is covered by test code?"
    // Matches Proximal's "Test/Code Ratio" semantics.
    const testCodeRatio = codeLines > 0
      ? Math.round((testLines / codeLines) * 10000) / 100
      : 0;

    const durationMs = performance.now() - start;

    return {
      meta: { status: 'computed', durationMs },
      testFiles: testFileEntries.length,
      testLines,
      codeLines,
      testCodeRatio,
      testFrameworks,
      coverageConfigFound,
      testFileList,
    };
  } catch (err) {
    const durationMs = performance.now() - start;
    return {
      meta: {
        status: 'error',
        reason: err instanceof Error ? err.message : String(err),
        durationMs,
      },
      testFiles: 0,
      testLines: 0,
      codeLines: 0,
      testCodeRatio: 0,
      testFrameworks: [],
      coverageConfigFound: false,
      testFileList: [],
    };
  }
}
