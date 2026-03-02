/**
 * Duplication analyzer — wraps `jscpd` for code clone detection.
 *
 * Scans the repository for duplicated code blocks using jscpd and returns
 * structured clone pair information with statistics.
 *
 * Graceful degradation:
 * - If jscpd is not installed, returns a skipped result.
 * - jscpd works offline (no network), so no need to skip in offline mode.
 * - Temp output directory is always cleaned up after reading.
 */

import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { RepositoryIndex, DuplicationResult, ClonePair } from '../core/types.js';
import { execTool, checkTool } from '../core/exec.js';

// ---------------------------------------------------------------------------
// jscpd JSON report shape (external tool — typed loosely on purpose)
// ---------------------------------------------------------------------------

interface JscpdFileRef {
  name: string;
  start: number;
  end: number;
  startLoc?: { line: number; column: number };
  endLoc?: { line: number; column: number };
  [key: string]: unknown;
}

interface JscpdDuplicate {
  format: string;
  lines: number;
  tokens: number;
  firstFile: JscpdFileRef;
  secondFile: JscpdFileRef;
  fragment?: string;
  [key: string]: unknown;
}

interface JscpdReport {
  duplicates: JscpdDuplicate[];
  statistics: {
    duplicatedLines: number;
    percentage: string | number;
    total: { lines: number };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a unique temporary directory for jscpd output.
 * Returns the absolute path to the created directory.
 */
async function createTempDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `jscpd-report-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Remove a temporary directory and its contents.
 * Silently ignores errors (cleanup is best-effort).
 */
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup — do not propagate errors
  }
}

/**
 * Parse jscpd JSON report string into ClonePair[] and statistics.
 *
 * Exported for unit testing. Takes raw JSON string and repo root.
 * Returns null if the JSON is invalid.
 */
export function parseJscpdReportJson(
  json: string,
  repoRoot: string,
): { clones: ClonePair[]; duplicateLines: number; duplicatePercentage: number } | null {
  let report: JscpdReport;
  try {
    report = JSON.parse(json) as JscpdReport;
  } catch {
    return null;
  }
  return parseJscpdReport(report, repoRoot);
}

/**
 * Parse jscpd JSON report into ClonePair[] and statistics.
 *
 * File paths are made relative to the repo root.
 * Clones are sorted by lines descending (largest clones first).
 */
function parseJscpdReport(
  report: JscpdReport,
  repoRoot: string,
): { clones: ClonePair[]; duplicateLines: number; duplicatePercentage: number } {
  const duplicateLines = report.statistics?.duplicatedLines ?? 0;
  const duplicatePercentage =
    typeof report.statistics?.percentage === 'string'
      ? parseFloat(report.statistics.percentage)
      : typeof report.statistics?.percentage === 'number'
        ? report.statistics.percentage
        : 0;

  const clones: ClonePair[] = (report.duplicates ?? []).map((dup) => {
    const firstFilePath = makeRelative(dup.firstFile.name, repoRoot);
    const secondFilePath = makeRelative(dup.secondFile.name, repoRoot);

    return {
      firstFile: firstFilePath,
      firstStartLine: dup.firstFile.start,
      firstEndLine: dup.firstFile.end,
      secondFile: secondFilePath,
      secondStartLine: dup.secondFile.start,
      secondEndLine: dup.secondFile.end,
      lines: dup.lines,
      tokens: dup.tokens,
    };
  });

  // Sort by lines descending — largest clones first
  clones.sort((a, b) => b.lines - a.lines);

  return { clones, duplicateLines, duplicatePercentage };
}

/**
 * Make a file path relative to the repo root.
 * Handles both absolute paths and paths already relative.
 */
function makeRelative(filePath: string, repoRoot: string): string {
  if (path.isAbsolute(filePath)) {
    return path.relative(repoRoot, filePath) || filePath;
  }
  return filePath;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze the repository for code duplication using jscpd.
 *
 * - Skips if jscpd is not installed.
 * - jscpd works offline, so no need to skip in offline mode.
 * - Uses a unique temp directory for jscpd output, cleaned up after reading.
 * - Never throws — returns error meta on failure.
 */
export async function analyzeDuplication(
  index: RepositoryIndex,
): Promise<DuplicationResult> {
  const start = performance.now();

  // Check if jscpd is available
  const available = await checkTool('jscpd');
  if (!available) {
    return {
      meta: {
        status: 'skipped',
        reason: 'jscpd not installed',
        durationMs: performance.now() - start,
      },
      duplicateLines: 0,
      duplicatePercentage: 0,
      totalClones: 0,
      clones: [],
    };
  }

  // Create a unique temp directory for jscpd output
  let tempDir: string;
  try {
    tempDir = await createTempDir();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      meta: {
        status: 'error',
        reason: `Failed to create temp directory: ${message}`,
        durationMs: performance.now() - start,
      },
      duplicateLines: 0,
      duplicatePercentage: 0,
      totalClones: 0,
      clones: [],
    };
  }

  try {
    // Run jscpd
    const result = await execTool(
      'jscpd',
      [
        '--format', 'json',
        '--reporters', 'json',
        '--output', tempDir,
        '--min-lines', '5',
        '--min-tokens', '50',
        index.root,
      ],
      { timeout: index.config.timeout, cwd: index.root },
    );

    // Check timeout
    if (result.timedOut) {
      return {
        meta: {
          status: 'error',
          reason: 'jscpd timed out',
          durationMs: performance.now() - start,
        },
        duplicateLines: 0,
        duplicatePercentage: 0,
        totalClones: 0,
        clones: [],
      };
    }

    // jscpd exit code 0 = success (may or may not have duplicates)
    // Non-zero = error
    if (result.exitCode !== 0) {
      return {
        meta: {
          status: 'error',
          reason: `jscpd exited with code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
          durationMs: performance.now() - start,
        },
        duplicateLines: 0,
        duplicatePercentage: 0,
        totalClones: 0,
        clones: [],
      };
    }

    // Read the JSON report file
    const reportPath = path.join(tempDir, 'jscpd-report.json');
    let reportJson: string;
    try {
      reportJson = await fs.readFile(reportPath, 'utf-8');
    } catch {
      // Report file may not exist if no files were analyzed
      return {
        meta: {
          status: 'computed',
          durationMs: performance.now() - start,
        },
        duplicateLines: 0,
        duplicatePercentage: 0,
        totalClones: 0,
        clones: [],
      };
    }

    // Parse the report
    let report: JscpdReport;
    try {
      report = JSON.parse(reportJson) as JscpdReport;
    } catch {
      return {
        meta: {
          status: 'error',
          reason: 'Failed to parse jscpd JSON report',
          durationMs: performance.now() - start,
        },
        duplicateLines: 0,
        duplicatePercentage: 0,
        totalClones: 0,
        clones: [],
      };
    }

    const { clones, duplicateLines, duplicatePercentage } = parseJscpdReport(
      report,
      index.root,
    );

    return {
      meta: {
        status: 'computed',
        durationMs: performance.now() - start,
      },
      duplicateLines,
      duplicatePercentage,
      totalClones: clones.length,
      clones,
    };
  } finally {
    // Always clean up the temp directory
    await cleanupTempDir(tempDir);
  }
}
