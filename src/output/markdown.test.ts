/**
 * Tests for the markdown report formatter.
 *
 * All section formatters are private — tested indirectly through the
 * public `formatMarkdown(report)` function with mock ReportData.
 */

import { describe, it, expect } from 'vitest';
import { formatMarkdown } from './markdown.js';
import type {
  ReportData,
  SizingResult,
  StructureResult,
  RepoHealthResult,
  ComplexityResult,
  TestAnalysis,
  GitAnalysisResult,
  DependencyResult,
  SecurityResult,
  TechStackResult,
  EnvVarsResult,
  DuplicationResult,
  ArchitectureResult,
  ScoringResult,
  AnalyzerMeta,
} from '../core/types.js';

// ---------------------------------------------------------------------------
// Mock data factory
// ---------------------------------------------------------------------------

function computedMeta(durationMs = 42): AnalyzerMeta {
  return { status: 'computed', durationMs };
}

function skippedMeta(reason = 'tool not installed'): AnalyzerMeta {
  return { status: 'skipped', reason, durationMs: 0 };
}

function errorMeta(reason = 'parse failed'): AnalyzerMeta {
  return { status: 'error', reason, durationMs: 0 };
}

function mockSizing(overrides: Partial<SizingResult> = {}): SizingResult {
  return {
    meta: computedMeta(),
    totalFiles: 150,
    totalLines: 12500,
    totalCodeLines: 10000,
    totalBlankLines: 1500,
    totalCommentLines: 1000,
    languages: [
      {
        language: 'TypeScript',
        extension: '.ts',
        files: 80,
        lines: 8000,
        codeLines: 6500,
        blankLines: 900,
        commentLines: 600,
        percentOfCode: 64,
      },
      {
        language: 'JavaScript',
        extension: '.js',
        files: 30,
        lines: 3000,
        codeLines: 2500,
        blankLines: 300,
        commentLines: 200,
        percentOfCode: 24,
      },
    ],
    godFiles: [],
    ...overrides,
  };
}

function mockReport(overrides: Partial<ReportData> = {}): ReportData {
  return {
    meta: {
      generatedAt: '2026-03-01T12:00:00.000Z',
      analyzerVersion: '0.1.0',
      directory: '/home/dev/my-project',
      analysisCompleteness: 95,
      grade: 'A',
      score: 88,
    },
    sizing: mockSizing(),
    structure: {
      meta: computedMeta(),
      tree: { name: '.', fileCount: 150, children: [] },
      treeString: 'src/\n  index.ts\n  utils.ts',
    },
    repoHealth: {
      meta: computedMeta(),
      checks: [
        { id: 'readme', name: 'README', present: true, path: 'README.md' },
        { id: 'license', name: 'License', present: false },
        { id: 'ci', name: 'CI Configuration', present: true, path: '.github/workflows/ci.yml' },
      ],
    },
    complexity: {
      meta: computedMeta(),
      repoAvgComplexity: 3.2,
      repoMaxComplexity: 18,
      totalFunctions: 245,
      fileComplexities: [],
      hotspots: [
        { name: 'parseConfig', file: 'src/config.ts', line: 42, complexity: 18 },
        { name: 'resolveImports', file: 'src/resolver.ts', line: 15, complexity: 12 },
      ],
    },
    testAnalysis: {
      meta: computedMeta(),
      testFiles: 12,
      testLines: 1800,
      codeLines: 10700,
      testCodeRatio: 16.82,
      testFrameworks: ['vitest'],
      coverageConfigFound: true,
      testFileList: [
        { path: 'src/core/exec.test.ts', lines: 250 },
        { path: 'src/analyzers/sizing.test.ts', lines: 180 },
      ],
    },
    git: {
      meta: computedMeta(),
      totalCommits: 342,
      contributors: 3,
      firstCommitDate: '2025-01-15T10:00:00Z',
      lastCommitDate: '2026-02-28T18:30:00Z',
      activeDays: 120,
      topContributors: [
        { name: 'Aditya Patni', email: 'aditya@example.com', commits: 300 },
        { name: 'Jane Dev', email: 'jane@example.com', commits: 42 },
      ],
      conventionalCommitPercent: 85,
      busFactor: 1,
      commitFrequency: {
        commitsPerWeek: 6.5,
        commitsPerMonth: 28.5,
      },
    },
    dependencies: {
      meta: computedMeta(),
      totalDependencies: 25,
      directDependencies: 10,
      devDependencies: 15,
      ecosystems: ['npm'],
      packageManager: 'bun',
      dependencies: [
        { name: 'typescript', version: '^5.4.0', type: 'dev', ecosystem: 'npm' },
        { name: 'vitest', version: '^1.6.0', type: 'dev', ecosystem: 'npm' },
      ],
    },
    security: {
      meta: computedMeta(),
      secretsFound: 0,
      findings: [],
    },
    techStack: {
      meta: computedMeta(),
      stack: [
        { name: 'TypeScript', category: 'language-tool', source: 'package.json' },
        { name: 'vitest', category: 'test-runner', source: 'package.json' },
      ],
    },
    envVars: {
      meta: computedMeta(),
      totalVars: 3,
      variables: [
        { name: 'DATABASE_URL', file: 'src/config.ts', line: 5, prefix: 'DATABASE' },
        { name: 'API_KEY', file: 'src/config.ts', line: 12, prefix: 'API' },
        { name: 'NODE_ENV', file: 'src/app.ts', line: 1, prefix: 'NODE' },
      ],
      byPrefix: { DATABASE: 1, API: 1, NODE: 1 },
    },
    duplication: {
      meta: computedMeta(),
      duplicateLines: 120,
      duplicatePercentage: 2.4,
      totalClones: 3,
      clones: [
        {
          firstFile: 'src/a.ts',
          firstStartLine: 10,
          firstEndLine: 30,
          secondFile: 'src/b.ts',
          secondStartLine: 5,
          secondEndLine: 25,
          lines: 20,
          tokens: 150,
        },
      ],
    },
    architecture: {
      meta: computedMeta(),
      totalImports: 180,
      uniqueModules: 12,
      importGraph: [{ from: 'src/core/exec.ts', to: 'src/core/types.ts' }],
      circularDependencies: [
        { cycle: ['src/a.ts', 'src/b.ts', 'src/c.ts'] },
      ],
      moduleCohesion: [
        { module: 'core', intraImports: 15, totalImports: 20, cohesionRatio: 0.75 },
      ],
    },
    scoring: {
      totalScore: 78,
      totalPossible: 100,
      normalizedScore: 78,
      grade: 'B',
      categories: {
        'repo-health': { score: 18, maxScore: 20, metrics: {} },
        testing: { score: 8, maxScore: 20, metrics: {} },
        complexity: { score: 15, maxScore: 15, metrics: {} },
        security: { score: 10, maxScore: 10, metrics: {} },
        dependencies: { score: 12, maxScore: 15, metrics: {} },
        architecture: { score: 15, maxScore: 20, metrics: {} },
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatMarkdown — full report
// ---------------------------------------------------------------------------

describe('formatMarkdown', () => {
  it('produces all expected section headers when all analyzers are computed', () => {
    const report = mockReport();
    const output = formatMarkdown(report);

    expect(output).toContain('# Codebase Analysis: my-project');
    expect(output).toContain('## Summary');
    expect(output).toContain('## Score: B (78/100)');
    expect(output).toContain('## Language Breakdown');
    expect(output).toContain('## Folder Structure');
    expect(output).toContain('## Test Analysis');
    expect(output).toContain('## Repository Health');
    expect(output).toContain('## Cyclomatic Complexity');
    expect(output).toContain('## Git Analysis');
    expect(output).toContain('## Dependencies');
    expect(output).toContain('## Security');
    expect(output).toContain('## Tech Stack');
    expect(output).toContain('## Environment Variables');
    expect(output).toContain('## Code Duplication');
    expect(output).toContain('## Architecture');
  });

  it('ends with a trailing newline', () => {
    const output = formatMarkdown(mockReport());
    expect(output.endsWith('\n')).toBe(true);
  });

  it('uses the basename of meta.directory as the report title', () => {
    const report = mockReport();
    report.meta.directory = '/deeply/nested/path/cool-project';
    const output = formatMarkdown(report);
    expect(output).toContain('# Codebase Analysis: cool-project');
  });

  it('includes footer with grade and completeness when scoring exists', () => {
    const output = formatMarkdown(mockReport());
    expect(output).toContain('Grade: B (78/100)');
    expect(output).toContain('Completeness: 95%');
    expect(output).toContain('codebase-analyzer v0.1.0');
  });

  it('includes footer without grade when scoring is absent', () => {
    const report = mockReport({ scoring: undefined });
    const output = formatMarkdown(report);
    expect(output).toContain('Completeness: 95%');
    expect(output).not.toContain('Grade:');
  });
});

// ---------------------------------------------------------------------------
// formatTests — guard on meta.status
// ---------------------------------------------------------------------------

describe('formatTests section', () => {
  it('returns empty when testAnalysis meta.status is skipped', () => {
    const report = mockReport({
      testAnalysis: {
        meta: skippedMeta('no test files found'),
        testFiles: 0,
        testLines: 0,
        codeLines: 0,
        testCodeRatio: 0,
        testFrameworks: [],
        coverageConfigFound: false,
        testFileList: [],
      },
    });
    const output = formatMarkdown(report);
    expect(output).not.toContain('## Test Analysis');
  });

  it('returns empty when testAnalysis meta.status is error', () => {
    const report = mockReport({
      testAnalysis: {
        meta: errorMeta('read failure'),
        testFiles: 0,
        testLines: 0,
        codeLines: 0,
        testCodeRatio: 0,
        testFrameworks: [],
        coverageConfigFound: false,
        testFileList: [],
      },
    });
    const output = formatMarkdown(report);
    expect(output).not.toContain('## Test Analysis');
  });

  it('renders test analysis content when status is computed', () => {
    const output = formatMarkdown(mockReport());
    expect(output).toContain('## Test Analysis');
    expect(output).toContain('| Test Files | 12 |');
    expect(output).toContain('| Test Lines | 1800 |');
    expect(output).toContain('| Test/Code Ratio | 16.82% |');
  });

  it('renders detected test frameworks', () => {
    const output = formatMarkdown(mockReport());
    expect(output).toContain('### Test Frameworks Detected');
    expect(output).toContain('**vitest**');
  });

  it('renders test file list', () => {
    const output = formatMarkdown(mockReport());
    expect(output).toContain('### Test Files');
    expect(output).toContain('`src/core/exec.test.ts`');
  });
});

// ---------------------------------------------------------------------------
// formatEnvVars — rendering behavior
// ---------------------------------------------------------------------------

describe('formatEnvVars section', () => {
  it('renders variables directly from report data', () => {
    const output = formatMarkdown(mockReport());
    expect(output).toContain('## Environment Variables');
    expect(output).toContain('**3 environment variable(s) detected**');
    expect(output).toContain('| DATABASE_URL | src/config.ts | 5 |');
    expect(output).toContain('| API_KEY | src/config.ts | 12 |');
    expect(output).toContain('| NODE_ENV | src/app.ts | 1 |');
  });

  it('renders prefix breakdown from byPrefix data', () => {
    const output = formatMarkdown(mockReport());
    expect(output).toContain('### By Prefix');
    expect(output).toContain('| DATABASE | 1 |');
    expect(output).toContain('| API | 1 |');
  });

  it('returns empty when totalVars is 0', () => {
    const report = mockReport({
      envVars: {
        meta: computedMeta(),
        totalVars: 0,
        variables: [],
        byPrefix: {},
      },
    });
    const output = formatMarkdown(report);
    expect(output).not.toContain('## Environment Variables');
  });

  it('returns empty when meta.status is not computed', () => {
    const report = mockReport({
      envVars: {
        meta: skippedMeta(),
        totalVars: 3,
        variables: [],
        byPrefix: {},
      },
    });
    const output = formatMarkdown(report);
    expect(output).not.toContain('## Environment Variables');
  });

  it('returns empty when variables array is empty despite totalVars > 0', () => {
    const report = mockReport({
      envVars: {
        meta: computedMeta(),
        totalVars: 3,
        variables: [],
        byPrefix: {},
      },
    });
    const output = formatMarkdown(report);
    // The formatter checks vars.length === 0 after checking totalVars
    expect(output).not.toContain('## Environment Variables');
  });
});

// ---------------------------------------------------------------------------
// formatSecurity — skipped and error states
// ---------------------------------------------------------------------------

describe('formatSecurity section', () => {
  it('renders "Skipped: reason" when status is skipped', () => {
    const report = mockReport({
      security: {
        meta: skippedMeta('gitleaks not installed'),
        secretsFound: 0,
        findings: [],
      },
    });
    const output = formatMarkdown(report);
    expect(output).toContain('## Security');
    expect(output).toContain('*Skipped: gitleaks not installed*');
  });

  it('returns empty when status is error (no section rendered)', () => {
    const report = mockReport({
      security: {
        meta: errorMeta('gitleaks crashed'),
        secretsFound: 0,
        findings: [],
      },
    });
    const output = formatMarkdown(report);
    // formatSecurity only handles computed and skipped — error produces nothing
    expect(output).not.toContain('## Security');
  });

  it('renders no-secrets message when secretsFound is 0', () => {
    const output = formatMarkdown(mockReport());
    expect(output).toContain('No secrets or credentials detected.');
  });

  it('renders findings table when secrets are found', () => {
    const report = mockReport({
      security: {
        meta: computedMeta(),
        secretsFound: 2,
        findings: [
          { file: 'src/config.ts', line: 10, ruleId: 'generic-api-key', description: 'API key detected' },
          { file: '.env.example', line: 3, ruleId: 'aws-access-key', description: 'AWS key detected' },
        ],
      },
    });
    const output = formatMarkdown(report);
    expect(output).toContain('**2 potential secret(s) detected:**');
    expect(output).toContain('| src/config.ts | 10 | generic-api-key |');
    expect(output).toContain('| .env.example | 3 | aws-access-key |');
  });
});

// ---------------------------------------------------------------------------
// formatDuplication — skipped state
// ---------------------------------------------------------------------------

describe('formatDuplication section', () => {
  it('renders "Skipped: reason" when status is skipped', () => {
    const report = mockReport({
      duplication: {
        meta: skippedMeta('jscpd not installed'),
        duplicateLines: 0,
        duplicatePercentage: 0,
        totalClones: 0,
        clones: [],
      },
    });
    const output = formatMarkdown(report);
    expect(output).toContain('## Code Duplication');
    expect(output).toContain('*Skipped: jscpd not installed*');
  });

  it('renders clone data when status is computed', () => {
    const output = formatMarkdown(mockReport());
    expect(output).toContain('## Code Duplication');
    expect(output).toContain('| Duplicate Lines | 120 |');
    expect(output).toContain('| Duplication % | 2.4% |');
    expect(output).toContain('### Largest Clones');
  });

  it('returns empty when status is error', () => {
    const report = mockReport({
      duplication: {
        meta: errorMeta('timeout'),
        duplicateLines: 0,
        duplicatePercentage: 0,
        totalClones: 0,
        clones: [],
      },
    });
    const output = formatMarkdown(report);
    expect(output).not.toContain('## Code Duplication');
  });
});

// ---------------------------------------------------------------------------
// capitalize — kebab-case handling
// ---------------------------------------------------------------------------

describe('capitalize (tested via scoring table output)', () => {
  it('converts kebab-case category names: "repo-health" becomes "RepoHealth"', () => {
    const output = formatMarkdown(mockReport());
    // The scoring table renders capitalize(name) for each category
    expect(output).toContain('| RepoHealth |');
    expect(output).toContain('| Testing |');
    expect(output).toContain('| Complexity |');
    expect(output).toContain('| Security |');
    expect(output).toContain('| Dependencies |');
    expect(output).toContain('| Architecture |');
  });
});

// ---------------------------------------------------------------------------
// Star ratings — scoreToStars / scoreToStarsFromPct
// ---------------------------------------------------------------------------

describe('star ratings in scoring table', () => {
  const fullStar = '\u2605';
  const emptyStar = '\u2606';

  function makeScoring(categories: Record<string, { score: number; maxScore: number }>): ScoringResult {
    const cats: Record<string, { score: number; maxScore: number; metrics: Record<string, never> }> = {};
    for (const [name, { score, maxScore }] of Object.entries(categories)) {
      cats[name] = { score, maxScore, metrics: {} };
    }
    const totalScore = Object.values(categories).reduce((s, c) => s + c.score, 0);
    const totalPossible = Object.values(categories).reduce((s, c) => s + c.maxScore, 0);
    return {
      totalScore,
      totalPossible,
      normalizedScore: Math.round((totalScore / totalPossible) * 100),
      grade: 'B',
      categories: cats,
    };
  }

  it('0% score produces 1 filled star and 4 empty', () => {
    const report = mockReport({
      scoring: makeScoring({ low: { score: 0, maxScore: 100 } }),
    });
    const output = formatMarkdown(report);
    // 0% -> 1 star
    expect(output).toContain(`${fullStar}${emptyStar.repeat(4)}`);
  });

  it('20% score produces 2 filled stars and 3 empty', () => {
    const report = mockReport({
      scoring: makeScoring({ mid: { score: 20, maxScore: 100 } }),
    });
    const output = formatMarkdown(report);
    expect(output).toContain(`${fullStar.repeat(2)}${emptyStar.repeat(3)}`);
  });

  it('50% score produces 3 filled stars and 2 empty', () => {
    const report = mockReport({
      scoring: makeScoring({ mid: { score: 50, maxScore: 100 } }),
    });
    const output = formatMarkdown(report);
    expect(output).toContain(`${fullStar.repeat(3)}${emptyStar.repeat(2)}`);
  });

  it('80% score produces 5 filled stars', () => {
    const report = mockReport({
      scoring: makeScoring({ high: { score: 80, maxScore: 100 } }),
    });
    const output = formatMarkdown(report);
    expect(output).toContain(`${fullStar.repeat(5)}`);
  });

  it('100% score produces 5 filled stars', () => {
    const report = mockReport({
      scoring: makeScoring({ perfect: { score: 100, maxScore: 100 } }),
    });
    const output = formatMarkdown(report);
    expect(output).toContain(`${fullStar.repeat(5)}`);
  });

  it('maxScore 0 produces 0 filled stars and 5 empty', () => {
    const report = mockReport({
      scoring: makeScoring({ zero: { score: 0, maxScore: 0 } }),
    });
    const output = formatMarkdown(report);
    expect(output).toContain(`${emptyStar.repeat(5)}`);
  });
});

// ---------------------------------------------------------------------------
// God files section — conditional rendering
// ---------------------------------------------------------------------------

describe('formatGodFiles section', () => {
  it('renders god files table when god files exist', () => {
    const report = mockReport({
      sizing: mockSizing({
        godFiles: [
          { path: 'src/giant.ts', lines: 1200, language: 'TypeScript' },
          { path: 'src/monster.ts', lines: 800, language: 'TypeScript' },
        ],
      }),
    });
    const output = formatMarkdown(report);
    expect(output).toContain('## God Files (>500 LOC)');
    expect(output).toContain('| src/giant.ts | 1200 | TypeScript |');
    expect(output).toContain('| src/monster.ts | 800 | TypeScript |');
  });

  it('does not render god files section when there are no god files', () => {
    const report = mockReport({
      sizing: mockSizing({ godFiles: [] }),
    });
    const output = formatMarkdown(report);
    expect(output).not.toContain('## God Files');
  });

  it('does not render god files section when sizing status is not computed', () => {
    const report = mockReport({
      sizing: {
        ...mockSizing(),
        meta: errorMeta(),
        godFiles: [{ path: 'src/big.ts', lines: 900, language: 'TypeScript' }],
      },
    });
    const output = formatMarkdown(report);
    expect(output).not.toContain('## God Files');
  });

  it('sorts god files by line count descending', () => {
    const report = mockReport({
      sizing: mockSizing({
        godFiles: [
          { path: 'src/small-god.ts', lines: 600, language: 'TypeScript' },
          { path: 'src/big-god.ts', lines: 2000, language: 'TypeScript' },
          { path: 'src/mid-god.ts', lines: 1000, language: 'TypeScript' },
        ],
      }),
    });
    const output = formatMarkdown(report);
    const bigIdx = output.indexOf('src/big-god.ts');
    const midIdx = output.indexOf('src/mid-god.ts');
    const smallIdx = output.indexOf('src/small-god.ts');
    expect(bigIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(smallIdx);
  });
});

// ---------------------------------------------------------------------------
// Section formatters return empty when meta.status is error
// ---------------------------------------------------------------------------

describe('section formatters return empty on error status', () => {
  it('formatLanguages returns empty when sizing has error status', () => {
    const report = mockReport({
      sizing: { ...mockSizing(), meta: errorMeta() },
    });
    const output = formatMarkdown(report);
    expect(output).not.toContain('## Language Breakdown');
  });

  it('formatStructure returns empty when structure has error status', () => {
    const report = mockReport({
      structure: {
        meta: errorMeta(),
        tree: { name: '.', fileCount: 0, children: [] },
        treeString: '',
      },
    });
    const output = formatMarkdown(report);
    expect(output).not.toContain('## Folder Structure');
  });

  it('formatHealth returns empty when repoHealth has error status', () => {
    const report = mockReport({
      repoHealth: { meta: errorMeta(), checks: [] },
    });
    const output = formatMarkdown(report);
    expect(output).not.toContain('## Repository Health');
  });

  it('formatComplexity returns empty when complexity has error status', () => {
    const report = mockReport({
      complexity: {
        meta: errorMeta(),
        repoAvgComplexity: 0,
        repoMaxComplexity: 0,
        totalFunctions: 0,
        fileComplexities: [],
        hotspots: [],
      },
    });
    const output = formatMarkdown(report);
    expect(output).not.toContain('## Cyclomatic Complexity');
  });

  it('formatGit returns empty when git has error status', () => {
    const report = mockReport({
      git: {
        meta: errorMeta(),
        totalCommits: 0,
        contributors: 0,
        firstCommitDate: null,
        lastCommitDate: null,
        activeDays: 0,
        topContributors: [],
        conventionalCommitPercent: 0,
        busFactor: 0,
        commitFrequency: { commitsPerWeek: 0, commitsPerMonth: 0 },
      },
    });
    const output = formatMarkdown(report);
    expect(output).not.toContain('## Git Analysis');
  });

  it('formatDependencies returns empty when dependencies has error status', () => {
    const report = mockReport({
      dependencies: {
        meta: errorMeta(),
        totalDependencies: 0,
        directDependencies: 0,
        devDependencies: 0,
        ecosystems: [],
        packageManager: null,
        dependencies: [],
      },
    });
    const output = formatMarkdown(report);
    expect(output).not.toContain('## Dependencies');
  });

  it('formatArchitecture returns empty when architecture has error status', () => {
    const report = mockReport({
      architecture: {
        meta: errorMeta(),
        totalImports: 0,
        uniqueModules: 0,
        importGraph: [],
        circularDependencies: [],
        moduleCohesion: [],
      },
    });
    const output = formatMarkdown(report);
    expect(output).not.toContain('## Architecture');
  });

  it('formatTechStack returns empty when techStack has error status', () => {
    const report = mockReport({
      techStack: {
        meta: errorMeta(),
        stack: [{ name: 'vitest', category: 'test-runner', source: 'pkg' }],
      },
    });
    const output = formatMarkdown(report);
    expect(output).not.toContain('## Tech Stack');
  });
});
