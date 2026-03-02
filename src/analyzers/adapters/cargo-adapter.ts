/**
 * Cargo ecosystem adapter — parses Cargo.toml manifests into DependencyEntry[].
 *
 * Uses a simple line-based parser (no TOML library dependency) to extract
 * dependencies from:
 *   - [dependencies], [dev-dependencies], [build-dependencies]
 *   - [workspace.dependencies]
 *   - [target.'...'.dependencies], [target.'...'.dev-dependencies],
 *     [target.'...'.build-dependencies]
 *
 * Malformed or missing files are handled gracefully (empty array returned).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DependencyEntry } from '../../core/types.js';

/** Maps Cargo.toml section headers to DependencyEntry type. */
const SECTION_TYPE_MAP: Record<string, DependencyEntry['type']> = {
  '[dependencies]': 'direct',
  '[dev-dependencies]': 'dev',
  '[build-dependencies]': 'dev',
  '[workspace.dependencies]': 'direct',
};

/**
 * Regex to match target-specific dependency sections like:
 *   [target.'cfg(...)'.dependencies]
 *   [target.'cfg(...)'.dev-dependencies]
 *   [target.'cfg(...)'.build-dependencies]
 *   [target.x86_64-unknown-linux-gnu.dependencies]
 *
 * Uses greedy `.+` with backtracking to handle dots inside quoted cfg expressions
 * (e.g. target.'cfg(feature = "foo.bar")'.dependencies).
 *
 * Capture group 1: the dependency section suffix (dependencies, dev-dependencies, build-dependencies)
 */
const TARGET_SECTION_RE = /^\[target\..+\.((?:dev-|build-)?dependencies)\]$/;

/**
 * Classify a Cargo.toml section header as a dependency type or null.
 * Handles standard sections, workspace.dependencies, and target.*.dependencies.
 */
function classifySection(headerLower: string): DependencyEntry['type'] | null {
  // Check static map first (handles standard sections + workspace)
  const staticType = SECTION_TYPE_MAP[headerLower];
  if (staticType !== undefined) return staticType;

  // Check target-specific sections: [target.'cfg(...)'.dependencies]
  const targetMatch = TARGET_SECTION_RE.exec(headerLower);
  if (targetMatch) {
    const suffix = targetMatch[1]!;
    if (suffix === 'dependencies') return 'direct';
    if (suffix === 'dev-dependencies' || suffix === 'build-dependencies') return 'dev';
  }

  return null;
}

/**
 * Parse a Cargo.toml manifest and return its dependency entries.
 *
 * @param root         Absolute path to the repository root.
 * @param manifestPath Relative path from root to the Cargo.toml file.
 * @returns Array of DependencyEntry with ecosystem = 'cargo'. Empty on any error.
 */
export async function parseCargoManifest(
  root: string,
  manifestPath: string,
): Promise<DependencyEntry[]> {
  const absPath = path.join(root, manifestPath);

  let raw: string;
  try {
    raw = await fs.readFile(absPath, 'utf-8');
  } catch {
    return [];
  }

  const entries: DependencyEntry[] = [];
  let currentType: DependencyEntry['type'] | null = null;

  const lines = raw.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Check for section headers
    if (trimmed.startsWith('[')) {
      const lower = trimmed.toLowerCase();
      currentType = classifySection(lower);
      continue;
    }

    // Only parse lines when we are inside a known dependency section
    if (currentType === null) continue;

    // Parse dependency lines:
    //   package_name = "version"
    //   package_name = { version = "x.y.z", ... }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const name = trimmed.slice(0, eqIndex).trim();
    if (name === '' || name.includes(' ')) continue;

    const valueStr = trimmed.slice(eqIndex + 1).trim();

    let version = '';

    if (valueStr.startsWith('"') || valueStr.startsWith("'")) {
      // Simple form: package = "version"
      const quote = valueStr[0]!;
      const endQuote = valueStr.indexOf(quote, 1);
      if (endQuote > 1) {
        version = valueStr.slice(1, endQuote);
      }
    } else if (valueStr.startsWith('{')) {
      // Table form: package = { version = "x.y.z", ... }
      const versionMatch = valueStr.match(/version\s*=\s*["']([^"']*)["']/);
      if (versionMatch) {
        version = versionMatch[1] ?? '';
      } else {
        // Dependency without explicit version (e.g. path or git dependency)
        version = '*';
      }
    } else {
      // Unknown format — skip
      continue;
    }

    entries.push({
      name,
      version: version || '*',
      type: currentType,
      ecosystem: 'cargo',
    });
  }

  return entries;
}
