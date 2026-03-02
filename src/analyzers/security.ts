/**
 * Security analyzer — wraps `gitleaks` for secret detection.
 *
 * Scans the repository for leaked secrets/credentials using gitleaks and
 * returns structured findings. Raw secret values are NEVER included in output.
 *
 * Graceful degradation:
 * - If gitleaks is not installed, returns a skipped result.
 * - If offline mode is enabled, returns a skipped result.
 * - gitleaks exit code 1 means "leaks found" (not an error).
 * - Other non-zero exit codes are treated as errors.
 */

import * as path from 'node:path';
import type { RepositoryIndex, SecurityResult, SecurityFinding } from '../core/types.js';
import { execTool, checkTool } from '../core/exec.js';

// ---------------------------------------------------------------------------
// gitleaks JSON output shape (external tool — typed loosely on purpose)
// ---------------------------------------------------------------------------

interface GitleaksFinding {
  File: string;
  StartLine: number;
  RuleID: string;
  Description: string;
  // Secret and Match fields exist in gitleaks output but are intentionally
  // excluded from our interface. We never read or propagate raw secret values.
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify a file path into a context category based on directory patterns.
 */
function classifyFindingContext(filePath: string): 'production' | 'test' | 'docs' {
  const lower = filePath.toLowerCase();
  if (/(?:^|\/)(?:tests?|__tests__|spec|__mocks__)\//i.test(lower) || /\.(?:test|spec)\./i.test(lower)) {
    return 'test';
  }
  if (/(?:^|\/)(?:docs?|examples?|tutorials?|samples?)\//i.test(lower)) {
    return 'docs';
  }
  return 'production';
}

/**
 * Parse gitleaks JSON output into SecurityFinding[], stripping all secret values.
 * Returns an empty array if parsing fails.
 */
function parseGitleaksOutput(stdout: string, repoRoot: string): SecurityFinding[] {
  if (!stdout.trim()) {
    return [];
  }

  let raw: GitleaksFinding[];
  try {
    raw = JSON.parse(stdout) as GitleaksFinding[];
  } catch {
    return [];
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((entry) => {
    let relFile = path.relative(repoRoot, entry.File) || entry.File;
    // Prevent leaking operator filesystem paths — if the relative path
    // escapes the repo root (starts with ..), use just the basename.
    if (relFile.startsWith('..')) {
      relFile = path.basename(entry.File);
    }
    return {
      file: relFile,
      line: entry.StartLine,
      ruleId: entry.RuleID,
      description: entry.Description,
      context: classifyFindingContext(relFile),
    };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze the repository for leaked secrets using gitleaks.
 *
 * - Skips if gitleaks is not installed or offline mode is enabled.
 * - gitleaks exit code 0 = no leaks, exit code 1 = leaks found (not an error).
 * - Other exit codes are treated as errors.
 * - Raw secret values are NEVER included in output.
 */
export async function analyzeSecurity(
  index: RepositoryIndex,
): Promise<SecurityResult> {
  const start = performance.now();

  // Offline mode — skip external tool calls
  if (index.config.offline) {
    return {
      meta: {
        status: 'skipped',
        reason: 'Offline mode enabled — skipping gitleaks',
        durationMs: performance.now() - start,
      },
      secretsFound: 0,
      findings: [],
    };
  }

  // Check if gitleaks is available
  const available = await checkTool('gitleaks');
  if (!available) {
    return {
      meta: {
        status: 'skipped',
        reason: 'gitleaks not installed',
        durationMs: performance.now() - start,
      },
      secretsFound: 0,
      findings: [],
    };
  }

  // Run gitleaks
  const result = await execTool(
    'gitleaks',
    [
      'detect',
      '--source', index.root,
      '--report-format', 'json',
      '--report-path', '/dev/stdout',
      '--no-banner',
    ],
    { timeout: index.config.timeout, cwd: index.root },
  );

  // Check timeout first — a timed-out process may also have a non-zero exit code
  if (result.timedOut) {
    return {
      meta: {
        status: 'error',
        reason: 'gitleaks timed out',
        durationMs: performance.now() - start,
      },
      secretsFound: 0,
      findings: [],
    };
  }

  // gitleaks exit codes:
  //   0 = no leaks found
  //   1 = leaks found (this is NOT an error)
  //   other = actual error
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return {
      meta: {
        status: 'error',
        reason: `gitleaks exited with code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
        durationMs: performance.now() - start,
      },
      secretsFound: 0,
      findings: [],
    };
  }

  // Parse findings — exit code 0 means clean (empty output is fine)
  const findings = parseGitleaksOutput(result.stdout, index.root);

  return {
    meta: {
      status: 'computed',
      durationMs: performance.now() - start,
    },
    secretsFound: findings.length,
    findings,
  };
}
