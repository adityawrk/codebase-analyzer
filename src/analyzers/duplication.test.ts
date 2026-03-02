/**
 * Unit and integration tests for the duplication analyzer (jscpd wrapper).
 *
 * Uses vi.mock to stub exec.ts and node:fs/promises for isolated unit tests,
 * and runs a real integration test against the codebase_analysis repo itself.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import type { AnalysisConfig, FileEntry, GitMeta, RepositoryIndex } from '../core/types.js';
import { DEFAULT_CONFIG } from '../core/types.js';

// ---------------------------------------------------------------------------
// Mock exec.ts — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../core/exec.js', () => ({
  checkTool: vi.fn(),
  execTool: vi.fn(),
}));

// Mock node:fs/promises for controlling temp dir behavior in unit tests
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    rm: vi.fn().mockResolvedValue(undefined),
  };
});

// Import the mocked functions so we can control their return values
import { checkTool, execTool } from '../core/exec.js';
import * as fs from 'node:fs/promises';
import { analyzeDuplication } from './duplication.js';

// Cast to vi.Mock for type-safe stubbing
const mockCheckTool = checkTool as unknown as ReturnType<typeof vi.fn>;
const mockExecTool = execTool as unknown as ReturnType<typeof vi.fn>;
const mockReadFile = fs.readFile as unknown as ReturnType<typeof vi.fn>;
const mockMkdir = fs.mkdir as unknown as ReturnType<typeof vi.fn>;
const mockRm = fs.rm as unknown as ReturnType<typeof vi.fn>;

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

/** Sample jscpd JSON report with 2 clone pairs. */
function makeSampleReport(repoRoot: string = '/mock/repo') {
  return JSON.stringify({
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
  });
}

/** Sample jscpd JSON report with no duplicates. */
const EMPTY_REPORT = JSON.stringify({
  duplicates: [],
  statistics: {
    duplicatedLines: 0,
    percentage: '0',
    total: { lines: 500 },
  },
});

// ---------------------------------------------------------------------------
// Unit tests with mocked exec
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: mkdir and rm succeed silently
  mockMkdir.mockResolvedValue(undefined);
  mockRm.mockResolvedValue(undefined);
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
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    mockReadFile.mockResolvedValue(makeSampleReport());

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
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    mockReadFile.mockResolvedValue(makeSampleReport());

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
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    mockReadFile.mockResolvedValue(makeSampleReport());

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
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    mockReadFile.mockResolvedValue(makeSampleReport('/mock/repo'));

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
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    mockReadFile.mockResolvedValue(EMPTY_REPORT);

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
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    mockReadFile.mockRejectedValue(new Error('ENOENT: no such file'));

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
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    mockReadFile.mockResolvedValue('this is not valid json');

    const index = makeMockIndex();
    const result = await analyzeDuplication(index);

    expect(result.meta.status).toBe('error');
    expect(result.meta.reason).toContain('Failed to parse');
  });

  it('returns error when temp directory creation fails', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockMkdir.mockRejectedValue(new Error('EACCES: permission denied'));

    const index = makeMockIndex();
    const result = await analyzeDuplication(index);

    expect(result.meta.status).toBe('error');
    expect(result.meta.reason).toContain('Failed to create temp directory');
    expect(mockExecTool).not.toHaveBeenCalled();
  });
});

describe('analyzeDuplication — exec invocation', () => {
  it('passes correct arguments to execTool', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    mockReadFile.mockResolvedValue(EMPTY_REPORT);

    const index = makeMockIndex({ root: '/my/project' });
    index.config = makeConfig({ root: '/my/project' });
    await analyzeDuplication(index);

    expect(mockExecTool).toHaveBeenCalledWith(
      'jscpd',
      [
        '--format', 'json',
        '--reporters', 'json',
        '--output', expect.stringContaining('jscpd-report-'),
        '--min-lines', '5',
        '--min-tokens', '50',
        '/my/project',
      ],
      expect.objectContaining({
        timeout: expect.any(Number),
        cwd: '/my/project',
      }),
    );
  });

  it('respects the configured timeout', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    mockReadFile.mockResolvedValue(EMPTY_REPORT);

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

describe('analyzeDuplication — cleanup', () => {
  it('cleans up temp directory after successful analysis', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    mockReadFile.mockResolvedValue(EMPTY_REPORT);

    const index = makeMockIndex();
    await analyzeDuplication(index);

    expect(mockRm).toHaveBeenCalledWith(
      expect.stringContaining('jscpd-report-'),
      { recursive: true, force: true },
    );
  });

  it('cleans up temp directory even after jscpd error', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: 'error',
      exitCode: 1,
      timedOut: false,
    });

    const index = makeMockIndex();
    await analyzeDuplication(index);

    expect(mockRm).toHaveBeenCalledWith(
      expect.stringContaining('jscpd-report-'),
      { recursive: true, force: true },
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

describe('analyzeDuplication — statistics parsing edge cases', () => {
  it('handles percentage as a number', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });

    const report = {
      duplicates: [],
      statistics: {
        duplicatedLines: 0,
        percentage: 4.5,
        total: { lines: 200 },
      },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(report));

    const index = makeMockIndex();
    const result = await analyzeDuplication(index);

    expect(result.meta.status).toBe('computed');
    expect(result.duplicatePercentage).toBe(4.5);
  });

  it('handles missing statistics gracefully', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });

    const report = {
      duplicates: [],
      statistics: {},
    };
    mockReadFile.mockResolvedValue(JSON.stringify(report));

    const index = makeMockIndex();
    const result = await analyzeDuplication(index);

    expect(result.meta.status).toBe('computed');
    expect(result.duplicateLines).toBe(0);
    expect(result.duplicatePercentage).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration test — runs against the real codebase_analysis project
// ---------------------------------------------------------------------------

describe('analyzeDuplication — integration', () => {
  it('runs jscpd on the codebase_analysis repo (if jscpd is installed)', async () => {
    // Wire mocks to real implementations for the integration test.
    // We import the real modules via importActual to bypass vi.mock.
    const realExec = await vi.importActual<typeof import('../core/exec.js')>('../core/exec.js');
    const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

    const isInstalled = await realExec.checkTool('jscpd');
    if (!isInstalled) {
      // jscpd not installed — verify skipped path with a real index
      mockCheckTool.mockResolvedValue(false);
      const { buildRepositoryIndex } = await import('../core/repo-index.js');
      const root = path.resolve(import.meta.dirname, '../..');
      const config = makeConfig({ root });
      const index = await buildRepositoryIndex(root, config);

      const result = await analyzeDuplication(index);
      expect(result.meta.status).toBe('skipped');
      return;
    }

    // jscpd is installed — passthrough to real implementations
    mockCheckTool.mockImplementation(realExec.checkTool);
    mockExecTool.mockImplementation(realExec.execTool);
    mockMkdir.mockImplementation(realFs.mkdir as any);
    mockReadFile.mockImplementation(realFs.readFile as any);
    mockRm.mockImplementation(realFs.rm as any);

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
  }, 30_000);
});
