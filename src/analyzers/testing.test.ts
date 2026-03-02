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

describe('analyzeTests', () => {
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

  it('codeLines matches sizing.totalCodeLines', async () => {
    const index = await buildTestIndex();
    const sizing = await analyzeSizing(index);
    const result = await analyzeTests(index, sizing);

    expect(result.codeLines).toBe(sizing.totalCodeLines);
  });
});
