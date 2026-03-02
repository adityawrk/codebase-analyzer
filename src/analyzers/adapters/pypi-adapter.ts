/**
 * Python ecosystem adapter — parses requirements.txt and pyproject.toml
 * manifests into DependencyEntry[].
 *
 * Handles two manifest formats:
 *   - requirements.txt (and variants like requirements-dev.txt)
 *   - pyproject.toml (PEP 621 project.dependencies AND Poetry dependency layouts)
 *
 * Poetry layouts supported:
 *   - [tool.poetry.dependencies] — mapped to type 'direct' (skips `python` entry)
 *   - [tool.poetry.group.dev.dependencies] — mapped to type 'dev'
 *   - [tool.poetry.group.*.dependencies] — other groups mapped to type 'optional'
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
 * Regex to match Poetry section headers and classify them.
 * Matches:
 *   [tool.poetry.dependencies]                → 'direct'
 *   [tool.poetry.group.dev.dependencies]      → 'dev'
 *   [tool.poetry.group.<name>.dependencies]   → 'optional' (any non-dev group)
 *   [tool.poetry.dev-dependencies]            → 'dev' (legacy Poetry 1.x format)
 *
 * Capture group 1: the group name (if present), undefined for top-level deps.
 * Capture group 2: 'dev-' prefix (if present), undefined otherwise.
 */
const POETRY_SECTION_RE = /^\[tool\.poetry(?:\.group\.(\S+))?\.(dev-)?dependencies\]$/;

/**
 * Parse pyproject.toml content into dependency entries.
 * Extracts dependencies from:
 *   - [project] dependencies array (PEP 621)
 *   - [project.optional-dependencies] sections (PEP 621)
 *   - [tool.poetry.dependencies] (Poetry)
 *   - [tool.poetry.group.*.dependencies] (Poetry groups)
 *   - [tool.poetry.dev-dependencies] (Poetry 1.x legacy)
 */
function parsePyprojectToml(content: string): DependencyEntry[] {
  const entries: DependencyEntry[] = [];
  const lines = content.split('\n');

  let currentSection: 'dependencies' | 'optional' | 'poetry-direct' | 'poetry-dev' | 'poetry-optional' | null = null;
  let inArray = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();

    // Skip empty lines and comments (but don't reset section)
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Detect section headers
    if (trimmed.startsWith('[')) {
      const lower = trimmed.toLowerCase();
      inArray = false;

      if (lower === '[project]') {
        // Not directly a dependency section, but contains `dependencies = [...]`
        currentSection = null;
      } else if (lower.startsWith('[project.optional-dependencies')) {
        currentSection = 'optional';
      } else {
        // Check for Poetry dependency sections
        const poetryMatch = POETRY_SECTION_RE.exec(lower);
        if (poetryMatch) {
          const groupName = poetryMatch[1]; // undefined for [tool.poetry.dependencies] / [tool.poetry.dev-dependencies]
          const devPrefix = poetryMatch[2]; // 'dev-' for [tool.poetry.dev-dependencies], undefined otherwise
          if (groupName === undefined && devPrefix === undefined) {
            // [tool.poetry.dependencies] — top-level direct deps
            currentSection = 'poetry-direct';
          } else if (groupName === 'dev' || devPrefix !== undefined) {
            // [tool.poetry.group.dev.dependencies] or [tool.poetry.dev-dependencies]
            currentSection = 'poetry-dev';
          } else {
            // [tool.poetry.group.<other>.dependencies]
            currentSection = 'poetry-optional';
          }
        } else {
          currentSection = null;
        }
      }
      continue;
    }

    // --- Poetry key=value dependency parsing ---
    if (
      (currentSection === 'poetry-direct' || currentSection === 'poetry-dev' || currentSection === 'poetry-optional')
      && !inArray
    ) {
      parsePoetryDepLine(trimmed, currentSection, entries);
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
 * Parse a single Poetry dependency line (TOML key=value pair) and push
 * the resulting entry. Skips the `python` key (version constraint, not a dep).
 *
 * Supported formats:
 *   requests = "^2.28"
 *   requests = {version = "^2.28", optional = true}
 *   requests = {version = "^2.28", extras = ["security"]}
 *   python = "^3.9"  (skipped)
 */
function parsePoetryDepLine(
  trimmed: string,
  section: 'poetry-direct' | 'poetry-dev' | 'poetry-optional',
  entries: DependencyEntry[],
): void {
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex === -1) return;

  const name = trimmed.slice(0, eqIndex).trim();
  if (name === '' || name.includes(' ')) return;

  // Skip the python version constraint — it's not a real dependency
  if (name.toLowerCase() === 'python') return;

  const valueStr = trimmed.slice(eqIndex + 1).trim();

  let version = '*';

  if (valueStr.startsWith('"') || valueStr.startsWith("'")) {
    // Simple form: package = "^2.28"
    const quote = valueStr[0]!;
    const endQuote = valueStr.indexOf(quote, 1);
    if (endQuote > 1) {
      version = valueStr.slice(1, endQuote);
    }
  } else if (valueStr.startsWith('{')) {
    // Table form: package = {version = "^2.28", ...}
    const versionMatch = valueStr.match(/version\s*=\s*["']([^"']*)["']/);
    if (versionMatch) {
      version = versionMatch[1] ?? '*';
    }
  }

  const depType: DependencyEntry['type'] =
    section === 'poetry-dev' ? 'dev' :
    section === 'poetry-optional' ? 'optional' :
    'direct';

  entries.push({
    name,
    version,
    type: depType,
    ecosystem: 'pypi',
  });
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
