/**
 * Unit and integration tests for the duplication analyzer (jscpd wrapper).
 *
 * Only mocks exec.ts (checkTool/execTool). The filesystem (node:fs/promises)
 * is NOT mocked — instead, the execTool mock writes real temp files that the
 * analyzer's real fs.readFile picks up naturally.
 *
 * Pure parsing logic is tested via the exported parseJscpdReportJson helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { AnalysisConfig, GitMeta, RepositoryIndex } from '../core/types.js';
import { DEFAULT_CONFIG } from '../core/types.js';

// ---------------------------------------------------------------------------
// Mock exec.ts — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../core/exec.js', () => ({
  checkTool: vi.fn(),
  execTool: vi.fn(),
}));

// Import the mocked functions so we can control their return values
import { checkTool, execTool } from '../core/exec.js';
import { analyzeDuplication, parseJscpdReportJson } from './duplication.js';

// Cast to vi.Mock for type-safe stubbing
const mockCheckTool = checkTool as unknown as ReturnType<typeof vi.fn>;
const mockExecTool = execTool as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<AnalysisConfig>): AnalysisConfig {
  return { ...DEFAULT_CONFIG, root: '/mock/repo', ...overrides };
}

const EMPTY_GIT: GitMeta = {
  isRepo: false,
  remotes: [],
  headCommit: null,
  defaultBranch: null,
  totalCommits: null,
  firstCommitDate: null,
  lastCommitDate: null,
};

function makeMockIndex(overrides?: Partial<RepositoryIndex>): RepositoryIndex {
  return {
    root: '/mock/repo',
    files: [],
    filesByLanguage: new Map(),
    filesByExtension: new Map(),
    manifests: [],
    gitMeta: EMPTY_GIT,
    config: makeConfig(),
    ...overrides,
  };
}

/** Sample jscpd JSON report with 2 clone pairs (absolute paths). */
function makeSampleReport(repoRoot: string = '/mock/repo'): object {
  return {
    duplicates: [
      {
        format: 'typescript',
        lines: 10,
        tokens: 80,
        firstFile: {
          name: `${repoRoot}/src/foo.ts`,
          start: 10,
          end: 20,
          startLoc: { line: 10, column: 0 },
          endLoc: { line: 20, column: 0 },
        },
        secondFile: {
          name: `${repoRoot}/src/bar.ts`,
          start: 30,
          end: 40,
          startLoc: { line: 30, column: 0 },
          endLoc: { line: 40, column: 0 },
        },
        fragment: 'const x = 1;\nconst y = 2;',
      },
      {
        format: 'typescript',
        lines: 25,
        tokens: 200,
        firstFile: {
          name: `${repoRoot}/src/utils/helper.ts`,
          start: 5,
          end: 30,
          startLoc: { line: 5, column: 0 },
          endLoc: { line: 30, column: 0 },
        },
        secondFile: {
          name: `${repoRoot}/src/utils/helper2.ts`,
          start: 15,
          end: 40,
          startLoc: { line: 15, column: 0 },
          endLoc: { line: 40, column: 0 },
        },
        fragment: 'function doSomething() {...}',
      },
    ],
    statistics: {
      duplicatedLines: 35,
      percentage: '3.2',
      total: { lines: 1094 },
    },
  };
}

/** Sample empty jscpd report. */
const EMPTY_REPORT: object = {
  duplicates: [],
  statistics: {
    duplicatedLines: 0,
    percentage: '0',
    total: { lines: 500 },
  },
};

/**
 * Configure the execTool mock to write a real jscpd-report.json file.
 *
 * The mock intercepts the `--output` argument, writes the report JSON to that
 * temp directory (which the analyzer already created), then returns success.
 * The analyzer's real fs.readFile picks up the file naturally.
 */
function mockExecToolWithReport(report: object) {
  mockExecTool.mockImplementation(
    async (_tool: string, args: string[], _opts?: unknown) => {
      const outputIdx = args.indexOf('--output');
      if (outputIdx !== -1 && outputIdx + 1 < args.length) {
        const outputDir = args[outputIdx + 1]!;
        // The analyzer already created this dir, but ensure it exists
        await fs.mkdir(outputDir, { recursive: true });
        await fs.writeFile(
          path.join(outputDir, 'jscpd-report.json'),
          JSON.stringify(report),
          'utf-8',
        );
      }
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
    },
  );
}

/**
 * Configure the execTool mock to write malformed content to the report file.
 */
function mockExecToolWithMalformedReport() {
  mockExecTool.mockImplementation(
    async (_tool: string, args: string[], _opts?: unknown) => {
      const outputIdx = args.indexOf('--output');
      if (outputIdx !== -1 && outputIdx + 1 < args.length) {
        const outputDir = args[outputIdx + 1]!;
        await fs.mkdir(outputDir, { recursive: true });
        await fs.writeFile(
          path.join(outputDir, 'jscpd-report.json'),
          'this is not valid json',
          'utf-8',
        );
      }
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
    },
  );
}

// ---------------------------------------------------------------------------
// Unit tests — parseJscpdReportJson (pure parsing, no IO)
// ---------------------------------------------------------------------------

describe('parseJscpdReportJson — parsing', () => {
  it('parses a valid report with clones', () => {
    const report = makeSampleReport('/repo');
    const result = parseJscpdReportJson(JSON.stringify(report), '/repo');

    expect(result).not.toBeNull();
    expect(result!.duplicateLines).toBe(35);
    expect(result!.duplicatePercentage).toBeCloseTo(3.2);
    expect(result!.clones).toHaveLength(2);
  });

  it('returns clones sorted by lines descending', () => {
    const report = makeSampleReport('/repo');
    const result = parseJscpdReportJson(JSON.stringify(report), '/repo');

    expect(result!.clones[0]!.lines).toBe(25);
    expect(result!.clones[1]!.lines).toBe(10);
  });

  it('makes file paths relative to repo root', () => {
    const report = makeSampleReport('/my/project');
    const result = parseJscpdReportJson(JSON.stringify(report), '/my/project');

    for (const clone of result!.clones) {
      expect(clone.firstFile).not.toMatch(/^\//);
      expect(clone.secondFile).not.toMatch(/^\//);
    }

    const bigClone = result!.clones.find((c) => c.lines === 25);
    expect(bigClone!.firstFile).toBe('src/utils/helper.ts');
    expect(bigClone!.secondFile).toBe('src/utils/helper2.ts');
  });

  it('handles empty duplicates array', () => {
    const result = parseJscpdReportJson(JSON.stringify(EMPTY_REPORT), '/repo');

    expect(result).not.toBeNull();
    expect(result!.duplicateLines).toBe(0);
    expect(result!.duplicatePercentage).toBe(0);
    expect(result!.clones).toEqual([]);
  });

  it('handles percentage as a number', () => {
    const report = {
      duplicates: [],
      statistics: { duplicatedLines: 10, percentage: 4.5, total: { lines: 200 } },
    };
    const result = parseJscpdReportJson(JSON.stringify(report), '/repo');
    expect(result!.duplicatePercentage).toBe(4.5);
  });

  it('handles missing statistics fields gracefully', () => {
    const report = { duplicates: [], statistics: {} };
    const result = parseJscpdReportJson(JSON.stringify(report), '/repo');

    expect(result).not.toBeNull();
    expect(result!.duplicateLines).toBe(0);
    expect(result!.duplicatePercentage).toBe(0);
  });

  it('returns null for invalid JSON', () => {
    const result = parseJscpdReportJson('this is not json', '/repo');
    expect(result).toBeNull();
  });

  it('returns null for a JSON array instead of object', () => {
    const result = parseJscpdReportJson('[]', '/repo');
    expect(result).toBeNull();
  });

  it('returns null for a JSON primitive', () => {
    const result = parseJscpdReportJson('"hello"', '/repo');
    expect(result).toBeNull();
  });

  it('returns null for JSON null', () => {
    const result = parseJscpdReportJson('null', '/repo');
    expect(result).toBeNull();
  });

  it('handles missing duplicates field gracefully', () => {
    const report = { statistics: { duplicatedLines: 5, percentage: '1.0', total: { lines: 500 } } };
    const result = parseJscpdReportJson(JSON.stringify(report), '/repo');
    expect(result).not.toBeNull();
    expect(result!.clones).toEqual([]);
    expect(result!.duplicateLines).toBe(5);
  });

  it('handles duplicates as non-array gracefully', () => {
    const report = { duplicates: 'not-an-array', statistics: { duplicatedLines: 0, percentage: '0', total: { lines: 0 } } };
    const result = parseJscpdReportJson(JSON.stringify(report), '/repo');
    expect(result).not.toBeNull();
    expect(result!.clones).toEqual([]);
  });

  it('skips malformed clone entries with missing firstFile', () => {
    const report = {
      duplicates: [
        { format: 'typescript', lines: 10, tokens: 50, secondFile: { name: 'b.ts', start: 1, end: 10 } },
      ],
      statistics: { duplicatedLines: 10, percentage: '1.0', total: { lines: 1000 } },
    };
    const result = parseJscpdReportJson(JSON.stringify(report), '/repo');
    expect(result).not.toBeNull();
    expect(result!.clones).toEqual([]);
  });

  it('skips clone entries where start/end are not numbers', () => {
    const report = {
      duplicates: [
        {
          format: 'typescript',
          lines: 10,
          tokens: 50,
          firstFile: { name: 'a.ts', start: 'bad', end: 10 },
          secondFile: { name: 'b.ts', start: 1, end: 10 },
        },
      ],
      statistics: { duplicatedLines: 10, percentage: '1.0', total: { lines: 1000 } },
    };
    const result = parseJscpdReportJson(JSON.stringify(report), '/repo');
    expect(result).not.toBeNull();
    expect(result!.clones).toEqual([]);
  });

  it('coerces NaN percentage to 0', () => {
    const report = {
      duplicates: [],
      statistics: { duplicatedLines: 0, percentage: 'not-a-number', total: { lines: 100 } },
    };
    const result = parseJscpdReportJson(JSON.stringify(report), '/repo');
    expect(result).not.toBeNull();
    expect(result!.duplicatePercentage).toBe(0);
  });

  it('coerces Infinity percentage to 0', () => {
    const report = {
      duplicates: [],
      statistics: { duplicatedLines: 0, percentage: Infinity, total: { lines: 100 } },
    };
    const result = parseJscpdReportJson(JSON.stringify(report), '/repo');
    expect(result).not.toBeNull();
    expect(result!.duplicatePercentage).toBe(0);
  });

  it('skips clone entries with non-numeric lines/tokens (schema requires >= 1)', () => {
    const report = {
      duplicates: [
        {
          format: 'typescript',
          lines: 'bad',
          tokens: null,
          firstFile: { name: '/repo/a.ts', start: 1, end: 10 },
          secondFile: { name: '/repo/b.ts', start: 1, end: 10 },
        },
      ],
      statistics: { duplicatedLines: 10, percentage: '1.0', total: { lines: 1000 } },
    };
    const result = parseJscpdReportJson(JSON.stringify(report), '/repo');
    expect(result).not.toBeNull();
    expect(result!.clones).toHaveLength(0);
  });

  it('handles completely missing statistics gracefully', () => {
    const report = { duplicates: [] };
    const result = parseJscpdReportJson(JSON.stringify(report), '/repo');
    expect(result).not.toBeNull();
    expect(result!.duplicateLines).toBe(0);
    expect(result!.duplicatePercentage).toBe(0);
  });

  it('maps clone pair fields correctly', () => {
    const report = makeSampleReport('/repo');
    const result = parseJscpdReportJson(JSON.stringify(report), '/repo');

    const clone = result!.clones.find((c) => c.lines === 10)!;
    expect(clone.firstFile).toBe('src/foo.ts');
    expect(clone.firstStartLine).toBe(10);
    expect(clone.firstEndLine).toBe(20);
    expect(clone.secondFile).toBe('src/bar.ts');
    expect(clone.secondStartLine).toBe(30);
    expect(clone.secondEndLine).toBe(40);
    expect(clone.tokens).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — analyzeDuplication with mocked exec
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('analyzeDuplication — tool availability', () => {
  it('returns skipped if jscpd is not installed', async () => {
    mockCheckTool.mockResolvedValue(false);
    const index = makeMockIndex();

    const result = await analyzeDuplication(index);

    expect(result.meta.status).toBe('skipped');
    expect(result.meta.reason).toContain('jscpd not installed');
    expect(result.duplicateLines).toBe(0);
    expect(result.duplicatePercentage).toBe(0);
    expect(result.totalClones).toBe(0);
    expect(result.clones).toEqual([]);
    expect(mockExecTool).not.toHaveBeenCalled();
  });
});

describe('analyzeDuplication — successful analysis', () => {
  it('returns computed with parsed output on success', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecToolWithReport(makeSampleReport('/mock/repo'));

    const index = makeMockIndex();
    const result = await analyzeDuplication(index);

    expect(result.meta.status).toBe('computed');
    expect(result.duplicateLines).toBe(35);
    expect(result.duplicatePercentage).toBeCloseTo(3.2);
    expect(result.totalClones).toBe(2);
    expect(result.clones).toHaveLength(2);
  });

  it('meta.status is computed on success', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecToolWithReport(makeSampleReport('/mock/repo'));

    const index = makeMockIndex();
    const result = await analyzeDuplication(index);

    expect(result.meta.status).toBe('computed');
    expect(result.meta.reason).toBeUndefined();
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('analyzeDuplication — clone sorting', () => {
  it('clones are sorted by lines descending', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecToolWithReport(makeSampleReport('/mock/repo'));

    const index = makeMockIndex();
    const result = await analyzeDuplication(index);

    expect(result.clones).toHaveLength(2);
    // The 25-line clone should come before the 10-line clone
    expect(result.clones[0]!.lines).toBe(25);
    expect(result.clones[1]!.lines).toBe(10);
  });
});

describe('analyzeDuplication — file paths', () => {
  it('file paths are relative to repo root', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecToolWithReport(makeSampleReport('/mock/repo'));

    const index = makeMockIndex({ root: '/mock/repo' });
    const result = await analyzeDuplication(index);

    expect(result.clones).toHaveLength(2);

    // All paths should be relative (no leading slash)
    for (const clone of result.clones) {
      expect(clone.firstFile).not.toMatch(/^\//);
      expect(clone.secondFile).not.toMatch(/^\//);
    }

    // Verify specific relative paths
    const firstClone = result.clones.find((c) => c.lines === 25);
    expect(firstClone).toBeDefined();
    expect(firstClone!.firstFile).toBe('src/utils/helper.ts');
    expect(firstClone!.secondFile).toBe('src/utils/helper2.ts');

    const secondClone = result.clones.find((c) => c.lines === 10);
    expect(secondClone).toBeDefined();
    expect(secondClone!.firstFile).toBe('src/foo.ts');
    expect(secondClone!.secondFile).toBe('src/bar.ts');
  });
});

describe('analyzeDuplication — empty output', () => {
  it('handles empty jscpd output (no duplicates)', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecToolWithReport(EMPTY_REPORT);

    const index = makeMockIndex();
    const result = await analyzeDuplication(index);

    expect(result.meta.status).toBe('computed');
    expect(result.duplicateLines).toBe(0);
    expect(result.duplicatePercentage).toBe(0);
    expect(result.totalClones).toBe(0);
    expect(result.clones).toEqual([]);
  });

  it('handles missing report file gracefully', async () => {
    mockCheckTool.mockResolvedValue(true);
    // execTool succeeds but does NOT write a report file
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });

    const index = makeMockIndex();
    const result = await analyzeDuplication(index);

    // Missing report file is treated as computed with 0 duplicates
    expect(result.meta.status).toBe('computed');
    expect(result.duplicateLines).toBe(0);
    expect(result.totalClones).toBe(0);
    expect(result.clones).toEqual([]);
  });
});

describe('analyzeDuplication — error handling', () => {
  it('returns error status for non-zero exit codes', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: 'jscpd: unknown option --bad',
      exitCode: 1,
      timedOut: false,
    });

    const index = makeMockIndex();
    const result = await analyzeDuplication(index);

    expect(result.meta.status).toBe('error');
    expect(result.meta.reason).toContain('exited with code 1');
    expect(result.meta.reason).toContain('unknown option');
    expect(result.duplicateLines).toBe(0);
    expect(result.clones).toEqual([]);
  });

  it('returns error status when jscpd times out', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: -1,
      timedOut: true,
    });

    const index = makeMockIndex();
    const result = await analyzeDuplication(index);

    expect(result.meta.status).toBe('error');
    expect(result.meta.reason).toContain('timed out');
    expect(result.duplicateLines).toBe(0);
  });

  it('returns error when JSON report is malformed', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecToolWithMalformedReport();

    const index = makeMockIndex();
    const result = await analyzeDuplication(index);

    expect(result.meta.status).toBe('error');
    expect(result.meta.reason).toContain('Failed to parse');
  });
});

describe('analyzeDuplication — exec invocation', () => {
  it('passes correct arguments to execTool (no --format, uses --config)', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecToolWithReport(EMPTY_REPORT);

    const index = makeMockIndex({ root: '/my/project' });
    index.config = makeConfig({ root: '/my/project' });
    await analyzeDuplication(index);

    expect(mockExecTool).toHaveBeenCalledWith(
      'jscpd',
      [
        '--reporters', 'json',
        '--output', expect.stringContaining('jscpd-report-'),
        '--min-lines', '5',
        '--min-tokens', '50',
        '--config', expect.stringContaining('.jscpd.json'),
      ],
      expect.objectContaining({
        timeout: expect.any(Number),
        cwd: '/my/project',
      }),
    );

    // Verify --format is NOT in the args (it would restrict language detection)
    const args = mockExecTool.mock.calls[0]![1] as string[];
    expect(args).not.toContain('--format');
  });

  it('does not pass index.root as a positional argument', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecToolWithReport(EMPTY_REPORT);

    const index = makeMockIndex({ root: '/my/project' });
    index.config = makeConfig({ root: '/my/project' });
    await analyzeDuplication(index);

    const args = mockExecTool.mock.calls[0]![1] as string[];
    // The last arg should be the config path, not index.root
    expect(args[args.length - 1]).toContain('.jscpd.json');
    expect(args).not.toContain('/my/project');
  });

  it('writes a .jscpd.json config with non-binary file paths from index', async () => {
    mockCheckTool.mockResolvedValue(true);

    // Track what config file was written
    let writtenConfigPath: string | null = null;
    let writtenConfigContent: string | null = null;

    mockExecTool.mockImplementation(
      async (_tool: string, args: string[], _opts?: unknown) => {
        const configIdx = args.indexOf('--config');
        if (configIdx !== -1 && configIdx + 1 < args.length) {
          writtenConfigPath = args[configIdx + 1]!;
          writtenConfigContent = await fs.readFile(writtenConfigPath, 'utf-8');
        }
        // Also write the report file
        const outputIdx = args.indexOf('--output');
        if (outputIdx !== -1 && outputIdx + 1 < args.length) {
          const outputDir = args[outputIdx + 1]!;
          await fs.mkdir(outputDir, { recursive: true });
          await fs.writeFile(
            path.join(outputDir, 'jscpd-report.json'),
            JSON.stringify(EMPTY_REPORT),
            'utf-8',
          );
        }
        return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
      },
    );

    const index = makeMockIndex({
      root: '/my/project',
      files: [
        { path: 'src/foo.ts', language: 'TypeScript', extension: '.ts', size: 100, isTest: false, isBinary: false },
        { path: 'src/bar.ts', language: 'TypeScript', extension: '.ts', size: 200, isTest: false, isBinary: false },
        { path: 'assets/logo.png', language: 'Binary', extension: '.png', size: 5000, isTest: false, isBinary: true },
      ],
    });
    index.config = makeConfig({ root: '/my/project' });
    await analyzeDuplication(index);

    expect(writtenConfigPath).not.toBeNull();
    expect(writtenConfigContent).not.toBeNull();

    const config = JSON.parse(writtenConfigContent!);
    // Should include non-binary files only
    expect(config.path).toHaveLength(2);
    expect(config.path).toContain('/my/project/src/foo.ts');
    expect(config.path).toContain('/my/project/src/bar.ts');
    // Binary file should be excluded
    expect(config.path).not.toContain('/my/project/assets/logo.png');
  });

  it('respects the configured timeout', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecToolWithReport(EMPTY_REPORT);

    const customTimeout = 120_000;
    const index = makeMockIndex({
      config: makeConfig({ timeout: customTimeout }),
    });
    await analyzeDuplication(index);

    expect(mockExecTool).toHaveBeenCalledWith(
      'jscpd',
      expect.any(Array),
      expect.objectContaining({ timeout: customTimeout }),
    );
  });
});

describe('analyzeDuplication — timing', () => {
  it('always reports durationMs >= 0', async () => {
    mockCheckTool.mockResolvedValue(false);
    const index = makeMockIndex();

    const result = await analyzeDuplication(index);
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Integration test — runs against the real codebase_analysis project
// ---------------------------------------------------------------------------

describe('analyzeDuplication — integration', () => {
  it('runs jscpd on the codebase_analysis repo (if jscpd is installed)', async () => {
    // For the integration test, restore mocks so the real exec module is used
    vi.restoreAllMocks();

    const realExec = await import('../core/exec.js');
    const realCheckTool = realExec.checkTool;

    const isInstalled = await realCheckTool('jscpd');
    if (!isInstalled) {
      // If jscpd isn't installed, just verify the skipped path works
      mockCheckTool.mockResolvedValue(false);
      const { buildRepositoryIndex } = await import('../core/repo-index.js');
      const root = path.resolve(import.meta.dirname, '../..');
      const config = makeConfig({ root });
      const index = await buildRepositoryIndex(root, config);

      const result = await analyzeDuplication(index);
      expect(result.meta.status).toBe('skipped');
      return;
    }

    // jscpd is installed — override mocks with real implementations
    mockCheckTool.mockImplementation(realExec.checkTool);
    mockExecTool.mockImplementation(realExec.execTool);

    const { buildRepositoryIndex } = await import('../core/repo-index.js');
    const root = path.resolve(import.meta.dirname, '../..');
    const config = makeConfig({ root });
    const index = await buildRepositoryIndex(root, config);

    const result = await analyzeDuplication(index);

    expect(result.meta.status).toBe('computed');
    expect(result.meta.durationMs).toBeGreaterThan(0);
    expect(typeof result.duplicateLines).toBe('number');
    expect(typeof result.duplicatePercentage).toBe('number');
    expect(typeof result.totalClones).toBe('number');
    expect(Array.isArray(result.clones)).toBe(true);

    // Verify clone pair shape (if any)
    for (const clone of result.clones) {
      expect(typeof clone.firstFile).toBe('string');
      expect(typeof clone.firstStartLine).toBe('number');
      expect(typeof clone.firstEndLine).toBe('number');
      expect(typeof clone.secondFile).toBe('string');
      expect(typeof clone.secondStartLine).toBe('number');
      expect(typeof clone.secondEndLine).toBe('number');
      expect(typeof clone.lines).toBe('number');
      expect(typeof clone.tokens).toBe('number');

      // All paths should be relative (no leading slash)
      expect(clone.firstFile).not.toMatch(/^\//);
      expect(clone.secondFile).not.toMatch(/^\//);
    }

    // Clones should be sorted by lines descending
    for (let i = 1; i < result.clones.length; i++) {
      expect(result.clones[i - 1]!.lines).toBeGreaterThanOrEqual(result.clones[i]!.lines);
    }
  }, 30_000); // jscpd can be slow on larger codebases
});
