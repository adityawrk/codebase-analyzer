/**
 * Golden output tests — validates the analyzer produces correct, schema-conformant output.
 * Runs self-analysis (analyzes this project) and checks structural properties.
 * These tests are slow since they run real analysis. Use `bun run test:golden` to run.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { analyzeRepository } from '../../src/core/orchestrator.js';
import { formatMarkdown } from '../../src/output/markdown.js';
import { DEFAULT_CONFIG } from '../../src/core/types.js';
import type { AnalysisConfig, ReportData, Grade } from '../../src/core/types.js';
import { SKIP_NON_VITEST } from '../../src/test-utils.js';

const PROJECT_ROOT = path.resolve('.');

// Shared analysis result — computed once, used by all tests.
let report: ReportData;
let markdownOutput: string;

describe.skipIf(SKIP_NON_VITEST)('Golden output tests', { timeout: 120_000 }, () => {
  beforeAll(async () => {
    const config: AnalysisConfig = {
      ...DEFAULT_CONFIG,
      root: PROJECT_ROOT,
    };
    report = await analyzeRepository(PROJECT_ROOT, config);
    markdownOutput = formatMarkdown(report);
  });

  // --- (a) JSON schema validation ---

  describe('JSON schema validation', () => {
    it('conforms to report-v1.schema.json', () => {
      const schemaPath = path.join(PROJECT_ROOT, 'schemas', 'report-v1.schema.json');
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

      const ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);
      const validate = ajv.compile(schema);

      const valid = validate(report);
      if (!valid) {
        const errors = validate.errors?.map(
          (e) => `${e.instancePath} ${e.message}`,
        );
        expect.fail(
          `Schema validation failed:\n${errors?.join('\n') ?? 'unknown errors'}`,
        );
      }
      expect(valid).toBe(true);
    });

    it('analysisCompleteness >= 50', () => {
      expect(report.meta.analysisCompleteness).toBeGreaterThanOrEqual(50);
    });
  });

  // --- (b) Structural smoke tests ---

  describe('Structural smoke tests', () => {
    it('sizing.totalFiles > 0', () => {
      expect(report.sizing.totalFiles).toBeGreaterThan(0);
    });

    it('sizing.languages.length > 0', () => {
      expect(report.sizing.languages.length).toBeGreaterThan(0);
    });

    it('structure.treeString is non-empty', () => {
      expect(report.structure.treeString.length).toBeGreaterThan(0);
    });

    it('repoHealth.checks.length >= 5', () => {
      expect(report.repoHealth.checks.length).toBeGreaterThanOrEqual(5);
    });

    it('complexity.totalFunctions > 0', () => {
      expect(report.complexity.totalFunctions).toBeGreaterThan(0);
    });

    it('testAnalysis.testFiles > 0', () => {
      expect(report.testAnalysis.testFiles).toBeGreaterThan(0);
    });

    it('git.totalCommits > 0', () => {
      expect(report.git.totalCommits).toBeGreaterThan(0);
    });

    it('meta.generatedAt is a valid ISO date', () => {
      const date = new Date(report.meta.generatedAt);
      expect(date.toISOString()).toBe(report.meta.generatedAt);
    });

    it('meta.analyzerVersion is a string', () => {
      expect(typeof report.meta.analyzerVersion).toBe('string');
      expect(report.meta.analyzerVersion.length).toBeGreaterThan(0);
    });
  });

  // --- (c) Benchmark manifest validation ---

  describe('Benchmark manifest validation', () => {
    const SHA_PATTERN = /^[0-9a-f]{40}$/;
    let manifest: {
      version: number;
      fixtures: Array<{
        name: string;
        repo: string;
        sha: string;
        language: string;
        description: string;
      }>;
    };

    beforeAll(() => {
      const manifestPath = path.join(
        PROJECT_ROOT,
        'tests',
        'fixtures',
        'benchmark-manifest.json',
      );
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    });

    it('has at least 3 fixtures', () => {
      expect(manifest.fixtures.length).toBeGreaterThanOrEqual(3);
    });

    it('all entries have sha matching ^[0-9a-f]{40}$', () => {
      for (const fixture of manifest.fixtures) {
        expect(fixture.sha).toMatch(SHA_PATTERN);
      }
    });

    it('all entries have name, repo, and language', () => {
      for (const fixture of manifest.fixtures) {
        expect(typeof fixture.name).toBe('string');
        expect(fixture.name.length).toBeGreaterThan(0);
        expect(typeof fixture.repo).toBe('string');
        expect(fixture.repo.length).toBeGreaterThan(0);
        expect(typeof fixture.language).toBe('string');
        expect(fixture.language.length).toBeGreaterThan(0);
      }
    });
  });

  // --- (d) Markdown output format test ---

  describe('Markdown output format', () => {
    const expectedHeaders = [
      '# Codebase Analysis:',
      '## Summary',
      '## Language Breakdown',
      '## Folder Structure',
      '## Test Analysis',
      '## Repository Health',
      '## Cyclomatic Complexity',
      '## Git Analysis',
      '## Dependencies',
      '## Largest Files',
      '## Security',
    ];

    it('contains expected section headers', () => {
      for (const header of expectedHeaders) {
        expect(markdownOutput).toContain(header);
      }
    });

    it('output is non-empty and > 100 lines', () => {
      expect(markdownOutput.length).toBeGreaterThan(0);
      const lineCount = markdownOutput.split('\n').length;
      expect(lineCount).toBeGreaterThan(100);
    });
  });

  // --- (e) Scoring output validation ---

  describe('Scoring output validation', () => {
    const VALID_GRADES: Grade[] = ['A', 'B', 'C', 'D', 'F', 'INCOMPLETE'];

    it('report.scoring is populated', () => {
      expect(report.scoring).toBeDefined();
      expect(report.scoring).not.toBeNull();
    });

    it('scoring has a valid grade', () => {
      expect(VALID_GRADES).toContain(report.scoring!.grade);
    });

    it('scoring.normalizedScore is between 0 and 100', () => {
      expect(report.scoring!.normalizedScore).toBeGreaterThanOrEqual(0);
      expect(report.scoring!.normalizedScore).toBeLessThanOrEqual(100);
    });

    it('scoring.totalScore <= scoring.totalPossible', () => {
      expect(report.scoring!.totalScore).toBeLessThanOrEqual(
        report.scoring!.totalPossible,
      );
    });

    it('scoring has at least 3 scored categories', () => {
      const categoryCount = Object.keys(report.scoring!.categories).length;
      expect(categoryCount).toBeGreaterThanOrEqual(3);
    });

    it('meta.grade matches scoring.grade', () => {
      expect(report.meta.grade).toBe(report.scoring!.grade);
    });

    it('meta.score matches scoring.normalizedScore', () => {
      expect(report.meta.score).toBe(report.scoring!.normalizedScore);
    });

    it('each scored category has score <= maxScore', () => {
      for (const [catName, cat] of Object.entries(report.scoring!.categories)) {
        expect(
          cat.score,
          `${catName}: score (${cat.score}) should be <= maxScore (${cat.maxScore})`,
        ).toBeLessThanOrEqual(cat.maxScore);
      }
    });

    it('each metric has score <= maxScore', () => {
      for (const [catName, cat] of Object.entries(report.scoring!.categories)) {
        for (const [metricName, metric] of Object.entries(cat.metrics)) {
          expect(
            metric.score,
            `${catName}.${metricName}: score (${metric.score}) should be <= maxScore (${metric.maxScore})`,
          ).toBeLessThanOrEqual(metric.maxScore);
        }
      }
    });
  });
});
