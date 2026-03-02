import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { computeScoring, computeMaxDepth, computeAvgFilesPerFolder } from './aggregator.js';
import { loadRubric } from './rubric.js';
import type { ReportData, FolderNode, AnalyzerMeta } from '../core/types.js';

const RUBRIC_PATH = resolve(import.meta.dirname, '../../rubric.yaml');

// --- Fixtures ---

function makeMeta(status: 'computed' | 'skipped' | 'error' = 'computed'): AnalyzerMeta {
  return { status, durationMs: 100, reason: status === 'skipped' ? 'Not available' : undefined };
}

function makeTree(depth: number, filesPerFolder: number): FolderNode {
  if (depth <= 0) {
    return { name: 'leaf', fileCount: filesPerFolder, children: [] };
  }
  return {
    name: `d${depth}`,
    fileCount: filesPerFolder,
    children: [makeTree(depth - 1, filesPerFolder)],
  };
}

function makeFullReport(overrides?: Partial<{
  sizingStatus: 'computed' | 'skipped' | 'error';
  testingStatus: 'computed' | 'skipped' | 'error';
  complexityStatus: 'computed' | 'skipped' | 'error';
  repoHealthStatus: 'computed' | 'skipped' | 'error';
  structureStatus: 'computed' | 'skipped' | 'error';
  godFileCount: number;
  commentRatio: number;
  testCodeRatio: number;
  coverageConfigFound: boolean;
  testFrameworkCount: number;
  avgComplexity: number;
  maxComplexity: number;
  healthChecks: Array<{ name: string; present: boolean }>;
  treeDepth: number;
  filesPerFolder: number;
}>): ReportData {
  const o = {
    sizingStatus: 'computed' as const,
    testingStatus: 'computed' as const,
    complexityStatus: 'computed' as const,
    repoHealthStatus: 'computed' as const,
    structureStatus: 'computed' as const,
    godFileCount: 0,
    commentRatio: 0.15,
    testCodeRatio: 50, // percentage (will be /100 in aggregator)
    coverageConfigFound: true,
    testFrameworkCount: 2,
    avgComplexity: 2,
    maxComplexity: 8,
    healthChecks: [
      { name: 'readme', present: true },
      { name: 'license', present: true },
      { name: 'ci', present: true },
      { name: 'gitignore', present: true },
      { name: 'editorconfig', present: true },
      { name: 'contributing', present: true },
    ],
    treeDepth: 3,
    filesPerFolder: 5,
    ...overrides,
  };

  // Derive totalCommentLines and totalCodeLines from commentRatio
  // commentRatio = totalCommentLines / (totalCodeLines + totalCommentLines)
  // If ratio = 0.15, commentLines = 150, codeLines = 850
  const totalCommentLines = Math.round(o.commentRatio * 1000);
  const totalCodeLines = 1000 - totalCommentLines;

  const godFiles = Array.from({ length: o.godFileCount }, (_, i) => ({
    path: `src/god-file-${i}.ts`,
    lines: 600,
    language: 'TypeScript',
  }));

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      analyzerVersion: '0.1.0',
      directory: '/test/repo',
      analysisCompleteness: 100,
    },
    sizing: {
      meta: makeMeta(o.sizingStatus),
      totalFiles: 100,
      totalLines: 10000,
      totalCodeLines,
      totalBlankLines: 500,
      totalCommentLines,
      languages: [],
      godFiles,
    },
    structure: {
      meta: makeMeta(o.structureStatus),
      tree: makeTree(o.treeDepth, o.filesPerFolder),
      treeString: '',
    },
    repoHealth: {
      meta: makeMeta(o.repoHealthStatus),
      checks: o.healthChecks.map((c) => ({
        name: c.name,
        present: c.present,
      })),
    },
    complexity: {
      meta: makeMeta(o.complexityStatus),
      repoAvgComplexity: o.avgComplexity,
      repoMaxComplexity: o.maxComplexity,
      totalFunctions: 200,
      fileComplexities: [],
      hotspots: [],
    },
    testAnalysis: {
      meta: makeMeta(o.testingStatus),
      testFiles: 30,
      testLines: 2000,
      codeLines: totalCodeLines,
      testCodeRatio: o.testCodeRatio,
      testFrameworks: Array.from({ length: o.testFrameworkCount }, (_, i) => `framework-${i}`),
      coverageConfigFound: o.coverageConfigFound,
      testFileList: [],
    },
    git: {
      meta: makeMeta(),
      totalCommits: 500,
      contributors: 5,
      firstCommitDate: '2023-01-01',
      lastCommitDate: '2025-01-01',
      activeDays: 200,
      topContributors: [],
      conventionalCommitPercent: 80,
      busFactor: 3,
      commitFrequency: { commitsPerWeek: 5, commitsPerMonth: 20 },
    },
    dependencies: {
      meta: makeMeta(),
      totalDependencies: 50,
      directDependencies: 30,
      devDependencies: 20,
      ecosystems: ['npm'],
      packageManager: 'bun',
      dependencies: [],
    },
    security: {
      meta: makeMeta(),
      secretsFound: 0,
      findings: [],
    },
    techStack: {
      meta: makeMeta(),
      stack: [],
    },
    envVars: {
      meta: makeMeta(),
      totalVars: 5,
      variables: [],
      byPrefix: {},
    },
    duplication: {
      meta: makeMeta(),
      duplicateLines: 100,
      duplicatePercentage: 1.0,
      totalClones: 5,
      clones: [],
    },
    architecture: {
      meta: makeMeta(),
      totalImports: 300,
      uniqueModules: 20,
      importGraph: [],
      circularDependencies: [],
      moduleCohesion: [],
    },
  };
}

// --- Tests ---

describe('computeMaxDepth', () => {
  it('returns 0 for a leaf node', () => {
    const leaf: FolderNode = { name: 'root', fileCount: 5, children: [] };
    expect(computeMaxDepth(leaf)).toBe(0);
  });

  it('returns correct depth for linear chain', () => {
    const tree = makeTree(4, 3);
    expect(computeMaxDepth(tree)).toBe(4);
  });

  it('returns correct depth for branching tree', () => {
    const tree: FolderNode = {
      name: 'root',
      fileCount: 2,
      children: [
        { name: 'a', fileCount: 1, children: [
          { name: 'a1', fileCount: 3, children: [] },
        ]},
        { name: 'b', fileCount: 1, children: [
          { name: 'b1', fileCount: 2, children: [
            { name: 'b1a', fileCount: 1, children: [] },
          ]},
        ]},
      ],
    };
    expect(computeMaxDepth(tree)).toBe(3); // root -> b -> b1 -> b1a
  });
});

describe('computeAvgFilesPerFolder', () => {
  it('returns 0 for node with no files and no children', () => {
    const node: FolderNode = { name: 'root', fileCount: 0, children: [] };
    expect(computeAvgFilesPerFolder(node)).toBe(0);
  });

  it('returns correct average for uniform tree', () => {
    const tree: FolderNode = {
      name: 'root',
      fileCount: 4,
      children: [
        { name: 'a', fileCount: 6, children: [] },
        { name: 'b', fileCount: 2, children: [] },
      ],
    };
    // Three folders with files: root(4), a(6), b(2) -> avg = 12/3 = 4
    expect(computeAvgFilesPerFolder(tree)).toBe(4);
  });

  it('excludes folders with zero files', () => {
    const tree: FolderNode = {
      name: 'root',
      fileCount: 0, // no files in root
      children: [
        { name: 'a', fileCount: 10, children: [] },
        { name: 'b', fileCount: 0, children: [] }, // no files
      ],
    };
    // Only 'a' has files: avg = 10/1 = 10
    expect(computeAvgFilesPerFolder(tree)).toBe(10);
  });
});

describe('computeScoring — full pipeline', () => {
  it('scores a perfect codebase with maximum scores', () => {
    const rubric = loadRubric(RUBRIC_PATH);
    const report = makeFullReport();
    const result = computeScoring(report, rubric);

    // All five scored categories should be present
    expect(Object.keys(result.categories)).toContain('sizing');
    expect(Object.keys(result.categories)).toContain('testing');
    expect(Object.keys(result.categories)).toContain('complexity');
    expect(Object.keys(result.categories)).toContain('repoHealth');
    expect(Object.keys(result.categories)).toContain('structure');

    // With perfect values, should get high scores
    expect(result.totalScore).toBeGreaterThan(0);
    expect(result.totalPossible).toBeGreaterThan(0);
    expect(result.normalizedScore).toBeGreaterThanOrEqual(80);
    expect(result.grade).toMatch(/^[A-F]$/);
  });

  it('scores a perfect codebase as grade A', () => {
    const rubric = loadRubric(RUBRIC_PATH);
    const report = makeFullReport({
      godFileCount: 0,
      commentRatio: 0.20,
      testCodeRatio: 60,   // 0.60 after /100
      coverageConfigFound: true,
      testFrameworkCount: 3,
      avgComplexity: 2,
      maxComplexity: 8,
      treeDepth: 3,
      filesPerFolder: 5,
    });
    const result = computeScoring(report, rubric);

    expect(result.grade).toBe('A');
    expect(result.normalizedScore).toBeGreaterThanOrEqual(90);
  });

  it('includes correct metric-level details', () => {
    const rubric = loadRubric(RUBRIC_PATH);
    const report = makeFullReport({ godFileCount: 2 });
    const result = computeScoring(report, rubric);

    const sizingMetrics = result.categories['sizing']?.metrics;
    expect(sizingMetrics).toBeDefined();
    expect(sizingMetrics!['godFileCount']).toBeDefined();
    expect(sizingMetrics!['godFileCount']!.value).toBe(2);
    expect(sizingMetrics!['godFileCount']!.score).toBe(4); // max: 3 threshold
    expect(sizingMetrics!['godFileCount']!.label).toBe('Very few god files');
  });
});

describe('computeScoring — partial data', () => {
  it('adjusts totalPossible when some analyzers are skipped', () => {
    const rubric = loadRubric(RUBRIC_PATH);
    const fullReport = makeFullReport();
    const partialReport = makeFullReport({
      testingStatus: 'skipped',
      complexityStatus: 'error',
    });

    const fullResult = computeScoring(fullReport, rubric);
    const partialResult = computeScoring(partialReport, rubric);

    // Partial should have lower totalPossible
    expect(partialResult.totalPossible).toBeLessThan(fullResult.totalPossible);

    // Skipped categories should have 0 score
    expect(partialResult.categories['testing']!.score).toBe(0);
    expect(partialResult.categories['complexity']!.score).toBe(0);
  });

  it('skipped analyzers do not count toward totalPossible', () => {
    const rubric = loadRubric(RUBRIC_PATH);
    const report = makeFullReport({ testingStatus: 'skipped' });
    const result = computeScoring(report, rubric);

    // Testing weight is 25, so totalPossible should be 100 - 25 = 75
    expect(result.totalPossible).toBe(75);
  });

  it('normalizes score correctly with partial data', () => {
    const rubric = loadRubric(RUBRIC_PATH);

    // Create two reports: one full (perfect), one with testing skipped
    const perfectFull = makeFullReport({
      godFileCount: 0,
      commentRatio: 0.20,
      testCodeRatio: 60,
      coverageConfigFound: true,
      testFrameworkCount: 3,
      avgComplexity: 2,
      maxComplexity: 8,
      treeDepth: 3,
      filesPerFolder: 5,
    });

    const perfectPartial = makeFullReport({
      godFileCount: 0,
      commentRatio: 0.20,
      testCodeRatio: 60,
      coverageConfigFound: true,
      testFrameworkCount: 3,
      avgComplexity: 2,
      maxComplexity: 8,
      treeDepth: 3,
      filesPerFolder: 5,
      testingStatus: 'skipped',
    });

    const fullResult = computeScoring(perfectFull, rubric);
    const partialResult = computeScoring(perfectPartial, rubric);

    // Both should have high normalizedScore since available categories are maxed
    expect(fullResult.normalizedScore).toBeGreaterThanOrEqual(90);
    expect(partialResult.normalizedScore).toBeGreaterThanOrEqual(90);
  });
});

describe('computeScoring — INCOMPLETE grade', () => {
  it('returns INCOMPLETE when analysisCompleteness < 60%', () => {
    const rubric = loadRubric(RUBRIC_PATH);

    // Skip 6 out of 12 analyzers = 50% completeness
    const report = makeFullReport({
      sizingStatus: 'skipped',
      testingStatus: 'skipped',
      complexityStatus: 'skipped',
      repoHealthStatus: 'skipped',
      structureStatus: 'skipped',
    });
    // Also skip some non-rubric analyzers to get below 60%
    report.git.meta = makeMeta('skipped');
    report.dependencies.meta = makeMeta('skipped');

    const result = computeScoring(report, rubric);
    expect(result.grade).toBe('INCOMPLETE');
  });

  it('does not return INCOMPLETE when >= 60% analyzers complete', () => {
    const rubric = loadRubric(RUBRIC_PATH);

    // Only skip 4 out of 12 = 66.7% completeness
    const report = makeFullReport({
      sizingStatus: 'skipped',
      testingStatus: 'skipped',
    });
    report.git.meta = makeMeta('skipped');
    report.dependencies.meta = makeMeta('skipped');

    const result = computeScoring(report, rubric);
    expect(result.grade).not.toBe('INCOMPLETE');
  });
});

describe('computeScoring — grade boundaries', () => {
  it('assigns grade A for normalizedScore >= 90', () => {
    const rubric = loadRubric(RUBRIC_PATH);
    const report = makeFullReport({
      godFileCount: 0,
      commentRatio: 0.20,
      testCodeRatio: 60,
      coverageConfigFound: true,
      testFrameworkCount: 3,
      avgComplexity: 2,
      maxComplexity: 8,
      treeDepth: 3,
      filesPerFolder: 5,
    });
    const result = computeScoring(report, rubric);
    expect(result.grade).toBe('A');
  });

  it('assigns grade B for normalizedScore in [75, 90)', () => {
    const rubric = loadRubric(RUBRIC_PATH);
    // Moderate scores across the board
    const report = makeFullReport({
      godFileCount: 4,       // score 3/5
      commentRatio: 0.08,    // score 3/5
      testCodeRatio: 25,     // 0.25, score 9/15
      coverageConfigFound: false, // score 0/5
      testFrameworkCount: 1, // score 4/5
      avgComplexity: 4,      // score 8/10
      maxComplexity: 12,     // score 8/10
      treeDepth: 4,          // score 10/10
      filesPerFolder: 8,     // score 15/15
    });
    const result = computeScoring(report, rubric);
    expect(result.normalizedScore).toBeGreaterThanOrEqual(75);
    expect(result.normalizedScore).toBeLessThan(90);
    expect(result.grade).toBe('B');
  });

  it('assigns grade F for very low scores', () => {
    const rubric = loadRubric(RUBRIC_PATH);
    const report = makeFullReport({
      godFileCount: 20,      // score 1/5
      commentRatio: 0.01,    // score 1/5
      testCodeRatio: 1,      // 0.01, score 0/15
      coverageConfigFound: false, // score 0/5
      testFrameworkCount: 0, // score 0/5
      avgComplexity: 25,     // score 0/10
      maxComplexity: 60,     // score 0/10
      healthChecks: [
        { name: 'readme', present: false },
        { name: 'license', present: false },
        { name: 'ci', present: false },
        { name: 'gitignore', present: false },
        { name: 'editorconfig', present: false },
        { name: 'contributing', present: false },
      ],
      treeDepth: 15,         // score 1/10
      filesPerFolder: 60,    // score 1/15
    });
    const result = computeScoring(report, rubric);
    expect(result.normalizedScore).toBeLessThan(40);
    expect(result.grade).toBe('F');
  });

  it('assigns grade D for scores in [40, 60)', () => {
    const rubric = loadRubric(RUBRIC_PATH);
    const report = makeFullReport({
      godFileCount: 4,        // score 3/5
      commentRatio: 0.03,     // score 2/5
      testCodeRatio: 10,      // 0.10, score 5/15
      coverageConfigFound: false, // score 0/5
      testFrameworkCount: 1,  // score 4/5
      avgComplexity: 15,      // score 3/10
      maxComplexity: 30,      // score 2/10
      healthChecks: [
        { name: 'readme', present: true },
        { name: 'license', present: false },
        { name: 'ci', present: true },
        { name: 'gitignore', present: true },
        { name: 'editorconfig', present: false },
        { name: 'contributing', present: false },
      ],
      treeDepth: 10,          // score 4/10
      filesPerFolder: 30,     // score 8/15
    });
    const result = computeScoring(report, rubric);
    expect(result.normalizedScore).toBeGreaterThanOrEqual(40);
    expect(result.normalizedScore).toBeLessThan(60);
    expect(result.grade).toBe('D');
  });

  it('assigns grade C for scores in [60, 75)', () => {
    const rubric = loadRubric(RUBRIC_PATH);
    const report = makeFullReport({
      godFileCount: 2,        // score 4/5
      commentRatio: 0.06,     // score 3/5
      testCodeRatio: 20,      // 0.20, score 9/15
      coverageConfigFound: false, // score 0/5
      testFrameworkCount: 1,  // score 4/5
      avgComplexity: 7,       // score 6/10
      maxComplexity: 18,      // score 5/10
      healthChecks: [
        { name: 'readme', present: true },
        { name: 'license', present: true },
        { name: 'ci', present: false },
        { name: 'gitignore', present: true },
        { name: 'editorconfig', present: false },
        { name: 'contributing', present: false },
      ],
      treeDepth: 6,           // score 7/10
      filesPerFolder: 15,     // score 12/15
    });
    const result = computeScoring(report, rubric);
    expect(result.normalizedScore).toBeGreaterThanOrEqual(60);
    expect(result.normalizedScore).toBeLessThan(75);
    expect(result.grade).toBe('C');
  });
});

describe('computeScoring — repoHealth metric extraction', () => {
  it('maps health check names correctly', () => {
    const rubric = loadRubric(RUBRIC_PATH);
    const report = makeFullReport({
      healthChecks: [
        { name: 'readme', present: true },
        { name: 'license', present: false },
        { name: 'ci', present: true },
        { name: 'gitignore', present: true },
        { name: 'editorconfig', present: false },
        { name: 'contributing', present: false },
      ],
    });
    const result = computeScoring(report, rubric);

    const health = result.categories['repoHealth']!;
    expect(health.metrics['readme']!.value).toBe(true);
    expect(health.metrics['readme']!.score).toBe(5);
    expect(health.metrics['license']!.value).toBe(false);
    expect(health.metrics['license']!.score).toBe(0);
    expect(health.metrics['ci']!.value).toBe(true);
    expect(health.metrics['ci']!.score).toBe(5);
    expect(health.metrics['gitignore']!.value).toBe(true);
    expect(health.metrics['gitignore']!.score).toBe(3);
    expect(health.metrics['editorconfig']!.value).toBe(false);
    expect(health.metrics['editorconfig']!.score).toBe(0);
    expect(health.metrics['contributing']!.value).toBe(false);
    expect(health.metrics['contributing']!.score).toBe(0);
  });

  it('treats missing health checks as false', () => {
    const rubric = loadRubric(RUBRIC_PATH);
    const report = makeFullReport({
      healthChecks: [
        { name: 'readme', present: true },
        // Other checks are missing entirely
      ],
    });
    const result = computeScoring(report, rubric);

    const health = result.categories['repoHealth']!;
    expect(health.metrics['readme']!.value).toBe(true);
    expect(health.metrics['license']!.value).toBe(false);
    expect(health.metrics['ci']!.value).toBe(false);
  });
});
