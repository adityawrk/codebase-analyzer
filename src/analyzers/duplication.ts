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
 * Returns null if the JSON is invalid or has an unexpected structure.
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
 * Coerce a value to a finite number, returning `fallback` for NaN / Infinity / non-numbers.
 */
function safeNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/**
 * Parse jscpd JSON report into ClonePair[] and statistics.
 *
 * Includes runtime guards against unexpected report structure:
 * - Missing or non-object `statistics` / `duplicates` fields
 * - Non-numeric or NaN values coerced to 0
 * - Malformed clone entries silently skipped
 *
 * File paths are made relative to the repo root.
 * Clones are sorted by lines descending (largest clones first).
 */
function parseJscpdReport(
  report: JscpdReport,
  repoRoot: string,
): { clones: ClonePair[]; duplicateLines: number; duplicatePercentage: number } | null {
  // Guard: report must be a non-null, non-array object
  if (report == null || typeof report !== 'object' || Array.isArray(report)) {
    return null;
  }

  const stats = report.statistics;
  const duplicateLines = safeNumber(stats?.duplicatedLines, 0);
  const duplicatePercentage = safeNumber(stats?.percentage, 0);

  // Guard: duplicates must be an array (or absent → empty)
  const rawDuplicates = Array.isArray(report.duplicates) ? report.duplicates : [];

  const clones: ClonePair[] = [];
  for (const dup of rawDuplicates) {
    // Skip malformed entries — require both file refs with string name + numeric start/end
    if (
      typeof dup?.firstFile?.name !== 'string' ||
      typeof dup?.secondFile?.name !== 'string' ||
      typeof dup.firstFile.start !== 'number' ||
      typeof dup.firstFile.end !== 'number' ||
      typeof dup.secondFile.start !== 'number' ||
      typeof dup.secondFile.end !== 'number'
    ) {
      continue;
    }

    // Skip clones with invalid lines/tokens (schema requires >= 1)
    const lines = safeNumber(dup.lines, 0);
    const tokens = safeNumber(dup.tokens, 0);
    if (lines < 1 || tokens < 1) continue;

    const firstFilePath = makeRelative(dup.firstFile.name, repoRoot);
    const secondFilePath = makeRelative(dup.secondFile.name, repoRoot);

    clones.push({
      firstFile: firstFilePath,
      firstStartLine: dup.firstFile.start,
      firstEndLine: dup.firstFile.end,
      secondFile: secondFilePath,
      secondStartLine: dup.secondFile.start,
      secondEndLine: dup.secondFile.end,
      lines,
      tokens,
    });
  }

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
    // Write the indexed non-binary file list to a temp config file.
    // jscpd does not support a --files-list option, but its config file
    // accepts a `path` array. By pointing each entry at the individual files
    // from index.files, we honour file-policy without importing it directly.
    // We write a .jscpd.json config with the file list to the temp dir.
    const nonBinaryFiles = index.files.filter((f) => !f.isBinary);
    const configPath = path.join(tempDir, '.jscpd.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        path: nonBinaryFiles.map((f) => path.join(index.root, f.path)),
      }),
      'utf-8',
    );

    // Run jscpd
    // NOTE: --format is intentionally omitted. It controls which *language
    // formats* jscpd analyzes (e.g. "php,javascript"). Passing --format json
    // would restrict analysis to JSON files only. --reporters json controls
    // the *output* reporter format.
    const result = await execTool(
      'jscpd',
      [
        '--reporters', 'json',
        '--output', tempDir,
        '--min-lines', '5',
        '--min-tokens', '50',
        '--config', configPath,
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
    const parsed = parseJscpdReportJson(reportJson, index.root);
    if (parsed == null) {
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

    const { clones, duplicateLines, duplicatePercentage } = parsed;

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
