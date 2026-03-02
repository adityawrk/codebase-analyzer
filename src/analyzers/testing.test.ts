/**
 * Unit tests for the dedicated testing analyzer.
 *
 * Runs against the codebase_analysis project itself as a real-world fixture.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { analyzeTests } from './testing.js';
import { analyzeSizing } from './sizing.js';
import { buildRepositoryIndex } from '../core/repo-index.js';
import type { AnalysisConfig } from '../core/types.js';
import { SKIP_NON_VITEST } from '../test-utils.js';

/**
 * Build a RepositoryIndex for the codebase_analysis project itself.
 */
async function buildTestIndex() {
  const root = path.resolve(__dirname, '../..');
  const config: AnalysisConfig = {
    root,
    format: 'markdown',
    outputPath: null,
    include: [],
    exclude: [],
    timeout: 60_000,
    offline: false,
    followSymlinks: false,
    maxFileSize: 1_048_576,
  };
  return buildRepositoryIndex(root, config);
}

describe.skipIf(SKIP_NON_VITEST)('analyzeTests', () => {
  it('detects vitest as a test framework', async () => {
    const index = await buildTestIndex();
    const sizing = await analyzeSizing(index);
    const result = await analyzeTests(index, sizing);

    expect(result.testFrameworks).toContain('vitest');
  });

  it('finds test files in the project', async () => {
    const index = await buildTestIndex();
    const sizing = await analyzeSizing(index);
    const result = await analyzeTests(index, sizing);

    // This project has .test.ts files
    expect(result.testFiles).toBeGreaterThan(0);
  });

  it('testLines > 0 from actual line counting', async () => {
    const index = await buildTestIndex();
    const sizing = await analyzeSizing(index);
    const result = await analyzeTests(index, sizing);

    expect(result.testLines).toBeGreaterThan(0);
  });

  it('testCodeRatio >= 0', async () => {
    const index = await buildTestIndex();
    const sizing = await analyzeSizing(index);
    const result = await analyzeTests(index, sizing);

    expect(result.testCodeRatio).toBeGreaterThanOrEqual(0);
  });

  it('coverageConfigFound is true (vitest.config.ts has coverage)', async () => {
    const index = await buildTestIndex();
    const sizing = await analyzeSizing(index);
    const result = await analyzeTests(index, sizing);

    expect(result.coverageConfigFound).toBe(true);
  });

  it('testFileList is sorted descending by lines', async () => {
    const index = await buildTestIndex();
    const sizing = await analyzeSizing(index);
    const result = await analyzeTests(index, sizing);

    for (let i = 1; i < result.testFileList.length; i++) {
      expect(result.testFileList[i]!.lines).toBeLessThanOrEqual(
        result.testFileList[i - 1]!.lines,
      );
    }
  });

  it('meta.status is computed on success', async () => {
    const index = await buildTestIndex();
    const sizing = await analyzeSizing(index);
    const result = await analyzeTests(index, sizing);

    expect(result.meta.status).toBe('computed');
    expect(result.meta.durationMs).toBeGreaterThan(0);
  });

  it('testFileList entries have valid path and positive lines', async () => {
    const index = await buildTestIndex();
    const sizing = await analyzeSizing(index);
    const result = await analyzeTests(index, sizing);

    expect(result.testFileList.length).toBeGreaterThan(0);
    for (const entry of result.testFileList) {
      expect(typeof entry.path).toBe('string');
      expect(entry.path.length).toBeGreaterThan(0);
      expect(typeof entry.lines).toBe('number');
      expect(entry.lines).toBeGreaterThan(0);
    }
  });

  it('codeLines equals totalLines minus testLines', async () => {
    const index = await buildTestIndex();
    const sizing = await analyzeSizing(index);
    const result = await analyzeTests(index, sizing);

    expect(result.codeLines).toBe(sizing.totalLines - result.testLines);
  });

  it('testCodeRatio is positive (test lines / code lines)', async () => {
    const index = await buildTestIndex();
    const sizing = await analyzeSizing(index);
    const result = await analyzeTests(index, sizing);

    // testCodeRatio = testLines / codeLines * 100
    // Can exceed 100% if test code outweighs production code
    expect(result.testCodeRatio).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases with synthetic sizing data
// ---------------------------------------------------------------------------

describe.skipIf(SKIP_NON_VITEST)('analyzeTests — edge cases', () => {
  it('testCodeRatio is 0 when totalLines is 0', async () => {
    const index = await buildTestIndex();
    // Create a sizing result that reports 0 total lines (e.g. scc returned nothing)
    const zeroSizing: import('../core/types.js').SizingResult = {
      meta: { status: 'computed', durationMs: 1 },
      totalFiles: 0,
      totalLines: 0,
      totalCodeLines: 0,
      totalBlankLines: 0,
      totalCommentLines: 0,
      languages: [],
      godFiles: [],
      largestFiles: [],
    };
    const result = await analyzeTests(index, zeroSizing);

    // When totalLines is 0, codeLines should be clamped to 0 and ratio is 0
    expect(result.testCodeRatio).toBe(0);
    expect(result.codeLines).toBe(0);
  });

  it('codeLines is 0 when testLines exceeds totalLines', async () => {
    const index = await buildTestIndex();
    // Create a sizing result where totalLines is less than actual test lines
    // (simulates a scenario where scc counted fewer lines than the test file reader)
    const smallSizing: import('../core/types.js').SizingResult = {
      meta: { status: 'computed', durationMs: 1 },
      totalFiles: 1,
      totalLines: 1,
      totalCodeLines: 1,
      totalBlankLines: 0,
      totalCommentLines: 0,
      languages: [],
      godFiles: [],
      largestFiles: [],
    };
    const result = await analyzeTests(index, smallSizing);

    // testLines from this project will exceed totalLines=1
    // The analyzer clamps: codeLines = totalLines > testLines ? totalLines - testLines : 0
    expect(result.codeLines).toBe(0);
    expect(result.testCodeRatio).toBe(0);
  });
});
