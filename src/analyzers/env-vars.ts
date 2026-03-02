/**
 * Environment variable analyzer.
 *
 * Scans source files from the RepositoryIndex for env var access patterns
 * across multiple languages. Reports variable names, file locations, and
 * prefix categorization — NEVER includes values.
 *
 * Supported patterns:
 * - JS/TS: process.env.VAR, process.env['VAR'], process.env["VAR"]
 * - Python: os.environ['VAR'], os.environ.get('VAR'), os.getenv('VAR')
 * - Go: os.Getenv("VAR")
 * - .env files: VAR=value lines (ignoring comments)
 * - Docker/docker-compose: ENV VAR, environment: sections
 * - Shell: $VAR, ${VAR}
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RepositoryIndex, EnvVarsResult, EnvVarEntry } from '../core/types.js';

// ── Constants ────────────────────────────────────────────────────────

/** Extensions we scan for env var access patterns. */
const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx',
  '.py',
  '.go',
  '.rs',
  '.java', '.kt',
  '.rb',
  '.php',
  '.env',
  '.yaml', '.yml',
  '.toml',
  '.sh',
]);

/** Map file extensions to language identifiers for pattern matching. */
function getLanguageGroup(ext: string, filePath: string): string {
  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
    return 'javascript';
  }
  if (ext === '.py') return 'python';
  if (ext === '.go') return 'go';
  if (ext === '.rs') return 'rust';
  if (ext === '.java' || ext === '.kt') return 'jvm';
  if (ext === '.rb') return 'ruby';
  if (ext === '.php') return 'php';
  if (ext === '.sh') return 'shell';
  if (ext === '.env') return 'dotenv';
  if (ext === '.yaml' || ext === '.yml') {
    const basename = path.basename(filePath).toLowerCase();
    if (basename.startsWith('docker-compose')) return 'docker-compose';
    return 'yaml';
  }
  if (ext === '.toml') return 'toml';
  return 'unknown';
}

// ── Regex Patterns ───────────────────────────────────────────────────

/**
 * Valid env var name: uppercase letters, digits, and underscores.
 * Must start with a letter or underscore.
 */
const ENV_VAR_NAME = '[A-Z][A-Z0-9_]*';

/** Pattern definitions per language group. Each regex must have a named capture group `name`. */
function getPatternsForLanguage(lang: string): RegExp[] {
  switch (lang) {
    case 'javascript':
      return [
        // process.env.VARIABLE_NAME
        new RegExp(`process\\.env\\.(?<name>${ENV_VAR_NAME})`, 'g'),
        // process.env['VARIABLE_NAME'] or process.env["VARIABLE_NAME"]
        new RegExp(`process\\.env\\[['"](?<name>${ENV_VAR_NAME})['"]\\]`, 'g'),
      ];

    case 'python':
      return [
        // os.environ['VARIABLE_NAME'] or os.environ["VARIABLE_NAME"]
        new RegExp(`os\\.environ\\[['"](?<name>${ENV_VAR_NAME})['"]\\]`, 'g'),
        // os.environ.get('VARIABLE_NAME') or os.environ.get("VARIABLE_NAME")
        new RegExp(`os\\.environ\\.get\\(\\s*['"](?<name>${ENV_VAR_NAME})['"]`, 'g'),
        // os.getenv('VARIABLE_NAME') or os.getenv("VARIABLE_NAME")
        new RegExp(`os\\.getenv\\(\\s*['"](?<name>${ENV_VAR_NAME})['"]`, 'g'),
      ];

    case 'go':
      return [
        // os.Getenv("VARIABLE_NAME")
        new RegExp(`os\\.Getenv\\(\\s*"(?<name>${ENV_VAR_NAME})"`, 'g'),
      ];

    case 'rust':
      return [
        // std::env::var("VARIABLE_NAME") or env::var("VARIABLE_NAME")
        new RegExp(`env::var\\(\\s*"(?<name>${ENV_VAR_NAME})"`, 'g'),
      ];

    case 'jvm':
      return [
        // System.getenv("VARIABLE_NAME")
        new RegExp(`System\\.getenv\\(\\s*"(?<name>${ENV_VAR_NAME})"`, 'g'),
      ];

    case 'ruby':
      return [
        // ENV['VARIABLE_NAME'] or ENV["VARIABLE_NAME"]
        new RegExp(`ENV\\[['"](?<name>${ENV_VAR_NAME})['"]\\]`, 'g'),
        // ENV.fetch('VARIABLE_NAME')
        new RegExp(`ENV\\.fetch\\(\\s*['"](?<name>${ENV_VAR_NAME})['"]`, 'g'),
      ];

    case 'php':
      return [
        // getenv('VARIABLE_NAME') or getenv("VARIABLE_NAME")
        new RegExp(`getenv\\(\\s*['"](?<name>${ENV_VAR_NAME})['"]`, 'g'),
        // $_ENV['VARIABLE_NAME'] or $_ENV["VARIABLE_NAME"]
        new RegExp(`\\$_ENV\\[['"](?<name>${ENV_VAR_NAME})['"]\\]`, 'g'),
      ];

    case 'shell':
      return [
        // ${VARIABLE_NAME}
        new RegExp(`\\$\\{(?<name>${ENV_VAR_NAME})\\}`, 'g'),
        // $VARIABLE_NAME (standalone — not inside ${})
        new RegExp(`(?<!\\$\\{)\\$(?<name>${ENV_VAR_NAME})(?![A-Z0-9_}])`, 'g'),
      ];

    case 'dotenv':
      return [
        // VARIABLE_NAME=value (lines not starting with #)
        new RegExp(`^(?<name>${ENV_VAR_NAME})\\s*=`, 'gm'),
      ];

    case 'docker-compose':
      return [
        // environment: section values: VARIABLE_NAME: value or - VARIABLE_NAME=value
        new RegExp(`^\\s*-?\\s*(?<name>${ENV_VAR_NAME})[:=]`, 'gm'),
        // ENV VARIABLE_NAME (Dockerfile-style, sometimes in compose files)
        new RegExp(`^\\s*ENV\\s+(?<name>${ENV_VAR_NAME})`, 'gm'),
      ];

    case 'yaml':
      return [
        // ENV VARIABLE_NAME (Dockerfile-style commands in yaml)
        new RegExp(`ENV\\s+(?<name>${ENV_VAR_NAME})`, 'g'),
      ];

    default:
      return [];
  }
}

// ── Extraction ───────────────────────────────────────────────────────

/**
 * Extract the prefix from a variable name — everything before the first underscore.
 * If there is no underscore, the prefix is the whole name.
 */
export function extractPrefix(name: string): string {
  const idx = name.indexOf('_');
  return idx === -1 ? name : name.substring(0, idx);
}

/**
 * Extract env var entries from a source string.
 * Exported for direct use in tests without filesystem access.
 *
 * @param content - File content to scan
 * @param languageGroup - Language group identifier (e.g. 'javascript', 'python')
 * @param filePath - Relative file path for the entries
 * @returns Array of deduplicated EnvVarEntry objects
 */
export function extractEnvVarsFromSource(
  content: string,
  languageGroup: string,
  filePath: string,
): EnvVarEntry[] {
  const patterns = getPatternsForLanguage(languageGroup);
  if (patterns.length === 0) return [];

  // Track (name -> first line number) for deduplication within a file
  const seen = new Map<string, number>();
  const lines = content.split('\n');

  for (const pattern of patterns) {
    // Reset lastIndex in case of reuse
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const name = match.groups?.name;
      if (!name) continue;

      // Compute 1-based line number from character offset
      const charOffset = match.index;
      let line = 1;
      let pos = 0;
      for (let i = 0; i < lines.length; i++) {
        if (pos + lines[i]!.length >= charOffset) {
          line = i + 1;
          break;
        }
        pos += lines[i]!.length + 1; // +1 for the newline
      }

      // Deduplicate: keep first occurrence per variable name per file
      if (!seen.has(name)) {
        seen.set(name, line);
      }
    }
  }

  // Convert map to sorted entries
  const entries: EnvVarEntry[] = [];
  for (const [name, line] of seen) {
    entries.push({
      name,
      file: filePath,
      line,
      prefix: extractPrefix(name),
    });
  }

  // Sort by line number for deterministic output
  entries.sort((a, b) => a.line - b.line);

  return entries;
}

// ── Main Analyzer ────────────────────────────────────────────────────

/**
 * Analyze environment variable usage across all files in the repository.
 */
export async function analyzeEnvVars(
  index: RepositoryIndex,
): Promise<EnvVarsResult> {
  const start = performance.now();

  const allVariables: EnvVarEntry[] = [];

  for (const file of index.files) {
    // Skip binary files
    if (file.isBinary) continue;

    // Skip files larger than the configured max
    if (file.size > index.config.maxFileSize) continue;

    // Only process supported extensions
    if (!SUPPORTED_EXTENSIONS.has(file.extension)) continue;

    const languageGroup = getLanguageGroup(file.extension, file.path);
    if (languageGroup === 'unknown') continue;

    const absPath = path.join(index.root, file.path);

    let content: string;
    try {
      content = await fs.readFile(absPath, 'utf-8');
    } catch {
      // File unreadable — skip silently (degradation, not crash)
      continue;
    }

    const entries = extractEnvVarsFromSource(content, languageGroup, file.path);
    allVariables.push(...entries);
  }

  // Build prefix counts
  const byPrefix: Record<string, number> = {};
  for (const entry of allVariables) {
    byPrefix[entry.prefix] = (byPrefix[entry.prefix] ?? 0) + 1;
  }

  const durationMs = performance.now() - start;

  return {
    meta: {
      status: 'computed',
      durationMs,
    },
    totalVars: allVariables.length,
    variables: allVariables,
    byPrefix,
  };
}
