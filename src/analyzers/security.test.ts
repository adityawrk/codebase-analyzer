/**
 * Unit and integration tests for the security analyzer (gitleaks wrapper).
 *
 * Uses vi.mock to stub exec.ts for isolated unit tests, and runs a real
 * integration test against the codebase_analysis repo itself.
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

// Import the mocked functions so we can control their return values
import { checkTool, execTool } from '../core/exec.js';
import { analyzeSecurity } from './security.js';

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

/** Sample gitleaks JSON output with 2 findings. */
const SAMPLE_GITLEAKS_OUTPUT = JSON.stringify([
  {
    Description: 'AWS Access Key',
    File: '/mock/repo/src/config.ts',
    StartLine: 15,
    EndLine: 15,
    StartColumn: 1,
    EndColumn: 40,
    Match: 'AKIAIOSFODNN7EXAMPLE',
    Secret: 'AKIAIOSFODNN7EXAMPLE',
    RuleID: 'aws-access-key-id',
    Entropy: 3.5,
    Commit: 'abc123',
    Author: 'dev',
    Email: 'dev@example.com',
    Date: '2025-01-01',
    Message: 'add config',
    Fingerprint: 'abc123:src/config.ts:aws-access-key-id:15',
  },
  {
    Description: 'Generic API Key',
    File: '/mock/repo/.env.example',
    StartLine: 3,
    EndLine: 3,
    StartColumn: 1,
    EndColumn: 50,
    Match: 'sk-proj-abc123def456',
    Secret: 'sk-proj-abc123def456',
    RuleID: 'generic-api-key',
    Entropy: 4.2,
    Commit: 'def456',
    Author: 'dev',
    Email: 'dev@example.com',
    Date: '2025-01-02',
    Message: 'add env example',
    Fingerprint: 'def456:.env.example:generic-api-key:3',
  },
]);

// ---------------------------------------------------------------------------
// Unit tests with mocked exec
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('analyzeSecurity — tool availability', () => {
  it('returns skipped if gitleaks is not installed', async () => {
    mockCheckTool.mockResolvedValue(false);
    const index = makeMockIndex();

    const result = await analyzeSecurity(index);

    expect(result.meta.status).toBe('skipped');
    expect(result.meta.reason).toContain('gitleaks not installed');
    expect(result.secretsFound).toBe(0);
    expect(result.findings).toEqual([]);
    expect(mockExecTool).not.toHaveBeenCalled();
  });

  it('returns skipped when offline mode is true', async () => {
    // checkTool should not even be called in offline mode
    const index = makeMockIndex({
      config: makeConfig({ offline: true }),
    });

    const result = await analyzeSecurity(index);

    expect(result.meta.status).toBe('skipped');
    expect(result.meta.reason).toContain('Offline mode');
    expect(result.secretsFound).toBe(0);
    expect(result.findings).toEqual([]);
    expect(mockCheckTool).not.toHaveBeenCalled();
    expect(mockExecTool).not.toHaveBeenCalled();
  });
});

describe('analyzeSecurity — clean repo', () => {
  it('returns computed with 0 findings when gitleaks exits 0', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });

    const index = makeMockIndex();
    const result = await analyzeSecurity(index);

    expect(result.meta.status).toBe('computed');
    expect(result.secretsFound).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('analyzeSecurity — findings parsing', () => {
  it('parses gitleaks JSON output correctly', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: SAMPLE_GITLEAKS_OUTPUT,
      stderr: '',
      exitCode: 1, // exit code 1 = leaks found
      timedOut: false,
    });

    const index = makeMockIndex();
    const result = await analyzeSecurity(index);

    expect(result.meta.status).toBe('computed');
    expect(result.secretsFound).toBe(2);
    expect(result.findings).toHaveLength(2);

    // First finding
    expect(result.findings[0]).toEqual({
      file: 'src/config.ts',
      line: 15,
      ruleId: 'aws-access-key-id',
      description: 'AWS Access Key',
    });

    // Second finding
    expect(result.findings[1]).toEqual({
      file: '.env.example',
      line: 3,
      ruleId: 'generic-api-key',
      description: 'Generic API Key',
    });
  });

  it('never includes raw secret values in findings', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: SAMPLE_GITLEAKS_OUTPUT,
      stderr: '',
      exitCode: 1,
      timedOut: false,
    });

    const index = makeMockIndex();
    const result = await analyzeSecurity(index);

    // Serialize the entire result to a string and verify no secret values leak
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(serialized).not.toContain('sk-proj-abc123def456');

    // Verify that each finding only has the allowed fields
    for (const finding of result.findings) {
      const keys = Object.keys(finding);
      expect(keys).toEqual(['file', 'line', 'ruleId', 'description']);
    }
  });

  it('handles gitleaks exit code 1 (leaks found) without treating it as error', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: SAMPLE_GITLEAKS_OUTPUT,
      stderr: '',
      exitCode: 1,
      timedOut: false,
    });

    const index = makeMockIndex();
    const result = await analyzeSecurity(index);

    // Exit code 1 means "leaks found" — this is a successful analysis, not an error
    expect(result.meta.status).toBe('computed');
    expect(result.meta.reason).toBeUndefined();
    expect(result.secretsFound).toBe(2);
  });
});

describe('analyzeSecurity — error handling', () => {
  it('returns error status for unexpected exit codes', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: 'gitleaks: unknown flag --bad-flag',
      exitCode: 2,
      timedOut: false,
    });

    const index = makeMockIndex();
    const result = await analyzeSecurity(index);

    expect(result.meta.status).toBe('error');
    expect(result.meta.reason).toContain('exited with code 2');
    expect(result.meta.reason).toContain('unknown flag');
    expect(result.secretsFound).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('returns error status when gitleaks times out', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: -1,
      timedOut: true,
    });

    const index = makeMockIndex();
    const result = await analyzeSecurity(index);

    expect(result.meta.status).toBe('error');
    expect(result.meta.reason).toContain('timed out');
    expect(result.secretsFound).toBe(0);
  });

  it('returns computed with 0 findings when stdout is malformed JSON', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: 'not valid json at all',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });

    const index = makeMockIndex();
    const result = await analyzeSecurity(index);

    // Malformed output from a clean run (exit 0) is still computed, just empty
    expect(result.meta.status).toBe('computed');
    expect(result.secretsFound).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('returns computed with 0 findings for empty JSON array output', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: '[]',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });

    const index = makeMockIndex();
    const result = await analyzeSecurity(index);

    expect(result.meta.status).toBe('computed');
    expect(result.secretsFound).toBe(0);
    expect(result.findings).toEqual([]);
  });
});

describe('analyzeSecurity — exec invocation', () => {
  it('passes correct arguments to execTool', async () => {
    mockCheckTool.mockResolvedValue(true);
    mockExecTool.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });

    const index = makeMockIndex({ root: '/my/project' });
    index.config = makeConfig({ root: '/my/project' });
    await analyzeSecurity(index);

    expect(mockExecTool).toHaveBeenCalledWith(
      'gitleaks',
      [
        'detect',
        '--source', '/my/project',
        '--report-format', 'json',
        '--report-path', '/dev/stdout',
        '--no-banner',
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

    const customTimeout = 120_000;
    const index = makeMockIndex({
      config: makeConfig({ timeout: customTimeout }),
    });
    await analyzeSecurity(index);

    expect(mockExecTool).toHaveBeenCalledWith(
      'gitleaks',
      expect.any(Array),
      expect.objectContaining({ timeout: customTimeout }),
    );
  });
});

describe('analyzeSecurity — timing', () => {
  it('always reports durationMs >= 0', async () => {
    mockCheckTool.mockResolvedValue(false);
    const index = makeMockIndex();

    const result = await analyzeSecurity(index);
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Integration test — runs against the real codebase_analysis project
// ---------------------------------------------------------------------------

describe('analyzeSecurity — integration', () => {
  // Reset mocks so the real exec module is used
  // Note: this describe block still uses the mocked module, but for the
  // integration test we need real behavior. We use vi.mocked to override.
  it('runs gitleaks on the codebase_analysis repo (if gitleaks is installed)', async () => {
    // For the integration test, we need to dynamically import the real modules
    // since the top-level import uses mocked exec.
    vi.restoreAllMocks();

    // Re-import the real modules fresh (bypass the mock)
    const realExec = await import('../core/exec.js');
    const realCheckTool = realExec.checkTool;

    const isInstalled = await realCheckTool('gitleaks');
    if (!isInstalled) {
      // If gitleaks isn't installed, just verify the skipped path works
      mockCheckTool.mockResolvedValue(false);
      const { buildRepositoryIndex } = await import('../core/repo-index.js');
      const root = path.resolve(import.meta.dirname, '../..');
      const config = makeConfig({ root });
      const index = await buildRepositoryIndex(root, config);

      const result = await analyzeSecurity(index);
      expect(result.meta.status).toBe('skipped');
      return;
    }

    // gitleaks is installed — run for real
    // Override mocks with real implementations for this test
    mockCheckTool.mockImplementation(realExec.checkTool);
    mockExecTool.mockImplementation(realExec.execTool);

    const { buildRepositoryIndex } = await import('../core/repo-index.js');
    const root = path.resolve(import.meta.dirname, '../..');
    const config = makeConfig({ root });
    const index = await buildRepositoryIndex(root, config);

    const result = await analyzeSecurity(index);

    expect(result.meta.status).toBe('computed');
    expect(result.meta.durationMs).toBeGreaterThan(0);
    expect(typeof result.secretsFound).toBe('number');
    expect(Array.isArray(result.findings)).toBe(true);

    // Verify findings shape (if any)
    for (const finding of result.findings) {
      expect(typeof finding.file).toBe('string');
      expect(typeof finding.line).toBe('number');
      expect(typeof finding.ruleId).toBe('string');
      expect(typeof finding.description).toBe('string');

      // Most importantly: no raw secret values in the output
      const keys = Object.keys(finding);
      expect(keys).not.toContain('Secret');
      expect(keys).not.toContain('Match');
      expect(keys).not.toContain('secret');
      expect(keys).not.toContain('match');
    }
  });
});
