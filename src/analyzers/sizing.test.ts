import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { analyzeSizing } from './sizing.js';
import { buildRepositoryIndex } from '../core/repo-index.js';
import type { AnalysisConfig } from '../core/types.js';

/**
 * Build a RepositoryIndex for the codebase_analysis project itself.
 * This is used as a real-world test fixture.
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

describe('analyzeSizing', () => {
  it('produces a valid SizingResult with totalFiles > 0', async () => {
    const index = await buildTestIndex();
    const result = await analyzeSizing(index);

    expect(result.meta.status).toBe('computed');
    expect(result.meta.durationMs).toBeGreaterThan(0);
    expect(result.totalFiles).toBeGreaterThan(0);
  });

  it('reports totalLines > 0', async () => {
    const index = await buildTestIndex();
    const result = await analyzeSizing(index);

    expect(result.totalLines).toBeGreaterThan(0);
    expect(result.totalCodeLines).toBeGreaterThan(0);
  });

  it('returns a non-empty languages array', async () => {
    const index = await buildTestIndex();
    const result = await analyzeSizing(index);

    expect(result.languages.length).toBeGreaterThan(0);
    // Should include TypeScript since this is a TS project
    const tsLang = result.languages.find(
      (l) => l.language === 'TypeScript' || l.language === 'TSX',
    );
    expect(tsLang).toBeDefined();
  });

  it('has percentOfCode values that sum to approximately 100', async () => {
    const index = await buildTestIndex();
    const result = await analyzeSizing(index);

    const totalPercent = result.languages.reduce(
      (sum, lang) => sum + lang.percentOfCode,
      0,
    );
    // Allow for rounding: should be between 99 and 101
    expect(totalPercent).toBeGreaterThanOrEqual(99);
    expect(totalPercent).toBeLessThanOrEqual(101);
  });

  it('includes language, extension, files, and line counts in each breakdown', async () => {
    const index = await buildTestIndex();
    const result = await analyzeSizing(index);

    for (const lang of result.languages) {
      expect(typeof lang.language).toBe('string');
      expect(lang.language.length).toBeGreaterThan(0);
      expect(typeof lang.extension).toBe('string');
      expect(lang.files).toBeGreaterThan(0);
      expect(lang.lines).toBeGreaterThanOrEqual(0);
      expect(lang.codeLines).toBeGreaterThanOrEqual(0);
      expect(lang.blankLines).toBeGreaterThanOrEqual(0);
      expect(lang.commentLines).toBeGreaterThanOrEqual(0);
      expect(typeof lang.percentOfCode).toBe('number');
    }
  });

  it('languages are sorted by codeLines descending', async () => {
    const index = await buildTestIndex();
    const result = await analyzeSizing(index);

    for (let i = 1; i < result.languages.length; i++) {
      expect(result.languages[i]!.codeLines).toBeLessThanOrEqual(
        result.languages[i - 1]!.codeLines,
      );
    }
  });

  it('godFiles only contains files exceeding the threshold', async () => {
    const index = await buildTestIndex();
    const result = await analyzeSizing(index);

    // godFiles may be empty if no file exceeds 500 lines — that's fine
    for (const gf of result.godFiles) {
      expect(gf.lines).toBeGreaterThan(500);
      expect(typeof gf.path).toBe('string');
      expect(typeof gf.language).toBe('string');
    }
  });

  it('totals are consistent with language breakdown sums', async () => {
    const index = await buildTestIndex();
    const result = await analyzeSizing(index);

    const sumFiles = result.languages.reduce((s, l) => s + l.files, 0);
    const sumLines = result.languages.reduce((s, l) => s + l.lines, 0);
    const sumCode = result.languages.reduce((s, l) => s + l.codeLines, 0);
    const sumBlank = result.languages.reduce((s, l) => s + l.blankLines, 0);
    const sumComments = result.languages.reduce((s, l) => s + l.commentLines, 0);

    expect(sumFiles).toBe(result.totalFiles);
    expect(sumLines).toBe(result.totalLines);
    expect(sumCode).toBe(result.totalCodeLines);
    expect(sumBlank).toBe(result.totalBlankLines);
    expect(sumComments).toBe(result.totalCommentLines);
  });
});

