/**
 * Python ecosystem adapter — parses requirements.txt and pyproject.toml
 * manifests into DependencyEntry[].
 *
 * Handles two manifest formats:
 *   - requirements.txt (and variants like requirements-dev.txt)
 *   - pyproject.toml (PEP 621 project.dependencies)
 *
 * Uses line-based parsing — no TOML library dependency. Malformed or missing
 * files are handled gracefully (empty array returned).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DependencyEntry } from '../../core/types.js';

/**
 * Regex to split a requirements.txt line into package name and version specifier.
 * Matches: `package==1.0`, `package>=1.0,<2`, `package~=1.0`, `package[extra]>=1.0`, `package`
 */
const REQUIREMENTS_LINE_RE = /^([A-Za-z0-9][\w.-]*(?:\[[^\]]*\])?)\s*([<>=~!]+.+)?$/;

/**
 * Regex to extract package name and optional version spec from a PEP 508 string.
 * Matches: `"requests>=2.0"`, `"flask"`, `"numpy>=1.0,<2.0"`, `"boto3[crt]>=1.0"`
 */
const PEP508_RE = /^([A-Za-z0-9][\w.-]*(?:\[[^\]]*\])?)\s*([<>=~!]+.+)?$/;

/**
 * Parse a Python manifest (requirements.txt or pyproject.toml) and return
 * its dependency entries.
 *
 * @param root         Absolute path to the repository root.
 * @param manifestPath Relative path from root to the manifest file.
 * @returns Array of DependencyEntry with ecosystem = 'pypi'. Empty on any error.
 */
export async function parsePythonRequirements(
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

  // Dispatch based on filename
  const basename = path.basename(manifestPath);
  if (basename === 'pyproject.toml') {
    return parsePyprojectToml(raw);
  }

  return parseRequirementsTxt(raw);
}

// ---------------------------------------------------------------------------
// requirements.txt parser
// ---------------------------------------------------------------------------

/**
 * Parse requirements.txt content into dependency entries.
 * Skips comments, blank lines, -r references, and -e editable installs.
 */
function parseRequirementsTxt(content: string): DependencyEntry[] {
  const entries: DependencyEntry[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (trimmed === '') continue;

    // Skip comments
    if (trimmed.startsWith('#')) continue;

    // Skip -r (recursive) references
    if (trimmed.startsWith('-r ') || trimmed.startsWith('-r\t')) continue;

    // Skip -e (editable) installs
    if (trimmed.startsWith('-e ') || trimmed.startsWith('-e\t')) continue;

    // Skip other pip flags (--index-url, --find-links, etc.)
    if (trimmed.startsWith('-') || trimmed.startsWith('--')) continue;

    // Strip inline comments
    const commentIndex = trimmed.indexOf('#');
    const cleaned = commentIndex >= 0 ? trimmed.slice(0, commentIndex).trim() : trimmed;
    if (cleaned === '') continue;

    // Strip environment markers (e.g. `; python_version >= "3.6"`)
    const markerIndex = cleaned.indexOf(';');
    const withoutMarker = markerIndex >= 0 ? cleaned.slice(0, markerIndex).trim() : cleaned;
    if (withoutMarker === '') continue;

    const match = REQUIREMENTS_LINE_RE.exec(withoutMarker);
    if (!match) continue;

    const name = stripExtras(match[1] ?? '');
    const versionSpec = match[2] ?? '*';

    entries.push({
      name,
      version: versionSpec,
      type: 'direct',
      ecosystem: 'pypi',
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// pyproject.toml parser (line-based, no TOML library)
// ---------------------------------------------------------------------------

/**
 * Parse pyproject.toml content into dependency entries.
 * Extracts dependencies from [project] dependencies array and
 * [project.optional-dependencies] sections.
 */
function parsePyprojectToml(content: string): DependencyEntry[] {
  const entries: DependencyEntry[] = [];
  const lines = content.split('\n');

  let currentSection: 'dependencies' | 'optional' | null = null;
  let inArray = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();

    // Skip empty lines and comments (but don't reset section)
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Detect section headers
    if (trimmed.startsWith('[')) {
      const lower = trimmed.toLowerCase();
      if (lower === '[project]') {
        // Not directly a dependency section, but contains `dependencies = [...]`
        currentSection = null;
        inArray = false;
      } else if (lower.startsWith('[project.optional-dependencies')) {
        currentSection = 'optional';
        inArray = false;
      } else {
        currentSection = null;
        inArray = false;
      }
      continue;
    }

    // Detect `dependencies = [` inside [project] section or at top level
    if (!inArray && trimmed.startsWith('dependencies') && trimmed.includes('=')) {
      const afterEq = trimmed.slice(trimmed.indexOf('=') + 1).trim();
      if (afterEq.startsWith('[')) {
        inArray = true;
        currentSection = 'dependencies';

        // Handle inline array on same line: dependencies = ["pkg1", "pkg2"]
        if (afterEq.includes(']')) {
          const arrayContent = afterEq.slice(1, afterEq.indexOf(']'));
          extractPep508Entries(arrayContent, 'direct', entries);
          inArray = false;
          currentSection = null;
        } else {
          // Array items start on next line; parse items from rest of this line
          const partial = afterEq.slice(1).trim();
          if (partial) {
            extractPep508Entries(partial, 'direct', entries);
          }
        }
        continue;
      }
    }

    // Detect optional-dependency group key: `test = [`, `dev = [`
    if (currentSection === 'optional' && !inArray && trimmed.includes('=')) {
      const afterEq = trimmed.slice(trimmed.indexOf('=') + 1).trim();
      if (afterEq.startsWith('[')) {
        inArray = true;
        if (afterEq.includes(']')) {
          const arrayContent = afterEq.slice(1, afterEq.indexOf(']'));
          extractPep508Entries(arrayContent, 'optional', entries);
          inArray = false;
        } else {
          const partial = afterEq.slice(1).trim();
          if (partial) {
            extractPep508Entries(partial, 'optional', entries);
          }
        }
        continue;
      }
    }

    // Inside an array — parse quoted dependency strings
    if (inArray) {
      if (trimmed === ']' || trimmed.startsWith(']')) {
        inArray = false;
        if (currentSection === 'dependencies') currentSection = null;
        continue;
      }

      const depType = currentSection === 'optional' ? 'optional' : 'direct';
      extractPep508Entries(trimmed, depType, entries);
    }
  }

  return entries;
}

/**
 * Extract PEP 508 dependency entries from a line that may contain
 * one or more quoted strings like `"requests>=2.0", "flask"`.
 */
function extractPep508Entries(
  line: string,
  type: DependencyEntry['type'],
  entries: DependencyEntry[],
): void {
  // Match all quoted strings (single or double)
  const stringRe = /["']([^"']+)["']/g;
  let match: RegExpExecArray | null;

  while ((match = stringRe.exec(line)) !== null) {
    const specStr = match[1]!.trim();
    const parsed = PEP508_RE.exec(specStr);
    if (!parsed) continue;

    const name = stripExtras(parsed[1] ?? '');
    const versionSpec = parsed[2] ?? '*';

    entries.push({
      name,
      version: versionSpec,
      type,
      ecosystem: 'pypi',
    });
  }
}

/**
 * Strip extras bracket from a package name. E.g. `boto3[crt]` -> `boto3`.
 */
function stripExtras(name: string): string {
  const bracketIndex = name.indexOf('[');
  return bracketIndex >= 0 ? name.slice(0, bracketIndex) : name;
}
