/**
 * Go ecosystem adapter — parses go.mod manifests into DependencyEntry[].
 *
 * Handles both block-style `require (...)` and single-line `require` directives.
 * Indirect dependencies (marked with `// indirect` comment) are reported as
 * type 'optional'. Malformed or missing files are handled gracefully (empty array).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DependencyEntry } from '../../core/types.js';

/**
 * Parse a go.mod manifest and return its dependency entries.
 *
 * @param root         Absolute path to the repository root.
 * @param manifestPath Relative path from root to the go.mod file.
 * @returns Array of DependencyEntry with ecosystem = 'go'. Empty on any error.
 */
export async function parseGoMod(
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
  const lines = raw.split('\n');

  let inRequireBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('//')) continue;

    // Detect start of a require block
    if (trimmed.startsWith('require') && trimmed.includes('(')) {
      inRequireBlock = true;
      continue;
    }

    // Detect end of require block
    if (inRequireBlock && trimmed === ')') {
      inRequireBlock = false;
      continue;
    }

    if (inRequireBlock) {
      // Lines inside require (...) block: `module/path v1.2.3` or `module/path v1.2.3 // indirect`
      const entry = parseRequireLine(trimmed);
      if (entry) {
        entries.push(entry);
      }
      continue;
    }

    // Single-line require: `require module/path v1.2.3`
    if (trimmed.startsWith('require ') && !trimmed.includes('(')) {
      const rest = trimmed.slice('require '.length).trim();
      const entry = parseRequireLine(rest);
      if (entry) {
        entries.push(entry);
      }
    }
  }

  return entries;
}

/**
 * Parse a single require line (without the "require" keyword).
 * Expects format: `module/path v1.2.3` or `module/path v1.2.3 // indirect`
 */
function parseRequireLine(line: string): DependencyEntry | null {
  // Strip inline comments but check for indirect marker first
  const isIndirect = line.includes('// indirect');

  // Remove inline comment
  const commentIndex = line.indexOf('//');
  const cleaned = commentIndex >= 0 ? line.slice(0, commentIndex).trim() : line.trim();

  if (cleaned === '') return null;

  // Split into module path and version
  const parts = cleaned.split(/\s+/);
  if (parts.length < 2) return null;

  const modulePath = parts[0];
  const version = parts[1];

  if (!modulePath || !version) return null;

  return {
    name: modulePath,
    version,
    type: isIndirect ? 'optional' : 'direct',
    ecosystem: 'go',
  };
}
