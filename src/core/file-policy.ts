/**
 * file-policy.ts — Canonical file include/exclude authority.
 *
 * Single source of truth for which files enter the analysis pipeline.
 * All analyzers consume the FileEntry[] produced here; none scan the
 * filesystem independently.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execTool } from './exec.js';
import type { AnalysisConfig, FileEntry } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directories always excluded unless overridden via config.include. */
const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules',
  'vendor',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.next',
  '.nuxt',
  'coverage',
  '.gradle',
  'out',
  'target',
  'bin',
  'obj',
]);

/** Directory prefixes always excluded (e.g. dist-*, build-*). */
const DEFAULT_EXCLUDE_DIR_PREFIXES = ['dist-', 'build-'];

/** File-name patterns always excluded (exact match on basename). */
const DEFAULT_EXCLUDE_FILES = new Set([
  'package-lock.json',
  'bun.lock',
]);

/** Extension patterns always excluded. */
const DEFAULT_EXCLUDE_EXTENSIONS = new Set([
  '.min.js',
  '.min.css',
  '.map',
  '.lock',
]);

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TSX',
  '.js': 'JavaScript',
  '.jsx': 'JSX',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.swift': 'Swift',
  '.c': 'C',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.h': 'C Header',
  '.hpp': 'C++ Header',
  '.cs': 'C#',
  '.php': 'PHP',
  '.dart': 'Dart',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.xml': 'XML',
  '.md': 'Markdown',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sass': 'SCSS',
  '.less': 'LESS',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.sql': 'SQL',
  '.graphql': 'GraphQL',
  '.gql': 'GraphQL',
  '.dockerfile': 'Dockerfile',
  '.proto': 'Protobuf',
  '.lua': 'Lua',
  '.r': 'R',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.erl': 'Erlang',
  '.hs': 'Haskell',
  '.scala': 'Scala',
  '.clj': 'Clojure',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
};

/** Map a file extension (with leading dot) to a language name. */
export function detectLanguage(ext: string): string {
  // Handle Dockerfile special case (no extension, filename-based)
  return EXTENSION_TO_LANGUAGE[ext.toLowerCase()] ?? 'Other';
}

/**
 * Detect language considering the full filename for edge cases like
 * `Dockerfile`, `Makefile`, etc.
 */
function detectLanguageForFile(relativePath: string): string {
  const basename = path.basename(relativePath).toLowerCase();

  // Filename-based detection (no extension or special names)
  if (basename === 'dockerfile' || basename.startsWith('dockerfile.')) {
    return 'Dockerfile';
  }
  if (basename === 'makefile') return 'Makefile';
  if (basename === 'cmakelists.txt') return 'CMake';

  const ext = path.extname(relativePath);
  return detectLanguage(ext);
}

// ---------------------------------------------------------------------------
// Test file detection
// ---------------------------------------------------------------------------

/** Extensions considered "code" for directory-based test detection. */
export const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.rb', '.swift',
  '.c', '.cpp', '.cc', '.h', '.hpp', '.cs', '.php', '.dart',
  '.scala', '.clj', '.ex', '.exs', '.erl', '.hs', '.lua', '.r',
  '.vue', '.svelte',
]);

/** Return true if the file path looks like a test file. */
export function isTestFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  const normalized = filePath.replace(/\\/g, '/');
  const ext = path.extname(basename).toLowerCase();

  // Directory-based detection — only for code files (not .md, .json, .yaml, etc.)
  if (CODE_EXTENSIONS.has(ext)) {
    const testDirPatterns = [
      '/__tests__/',
      '/test/',
      '/tests/',
      '/spec/',
    ];
    for (const pattern of testDirPatterns) {
      if (normalized.includes(pattern)) return true;
    }
    // Also match if the path STARTS with a test directory (no leading /)
    if (
      normalized.startsWith('__tests__/') ||
      normalized.startsWith('test/') ||
      normalized.startsWith('tests/') ||
      normalized.startsWith('spec/')
    ) {
      return true;
    }
  }

  // File-name pattern detection (any extension)
  // *.test.*, *.spec.*, *_test.*, *_spec.*
  const nameWithoutExt = basename.replace(/\.[^.]+$/, '');
  if (
    nameWithoutExt.endsWith('.test') ||
    nameWithoutExt.endsWith('.spec') ||
    nameWithoutExt.endsWith('_test') ||
    nameWithoutExt.endsWith('_spec')
  ) {
    return true;
  }

  // Python-specific: conftest.py, test_*.py
  if (basename === 'conftest.py') return true;
  if (basename.startsWith('test_') && basename.endsWith('.py')) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

/**
 * Read the first 8KB of a file and check for null bytes.
 * Returns true if the file appears to be binary.
 */
export async function isBinary(filePath: string): Promise<boolean> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, 8192, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0x00) return true;
    }
    return false;
  } catch {
    // If we can't read it, treat as binary (skip it)
    return true;
  } finally {
    await handle?.close();
  }
}

// ---------------------------------------------------------------------------
// Glob matching (minimal, no external deps)
// ---------------------------------------------------------------------------

/**
 * Convert a simple glob pattern to a RegExp.
 *
 * Supported syntax:
 *   `*`  — any characters except `/`
 *   `**` — any characters including `/` (directory wildcard)
 *   `?`  — single character except `/`
 *
 * The pattern is matched against the full relative path (forward slashes).
 */
function globToRegex(pattern: string): RegExp {
  // Normalize to forward slashes
  const p = pattern.replace(/\\/g, '/');

  // Escape regex-special characters except * and ?
  let regex = '';
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === '*') {
      if (p[i + 1] === '*') {
        // ** — match anything including /
        // If surrounded by slashes, consume them:  a/**/b
        if (p[i + 2] === '/') {
          regex += '(?:.*/)?';
          i += 3;
        } else {
          regex += '.*';
          i += 2;
        }
      } else {
        // * — match anything except /
        regex += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      regex += '[^/]';
      i += 1;
    } else if ('^$.|+()[]{}\\'.includes(ch!)) {
      regex += '\\' + ch;
      i += 1;
    } else {
      regex += ch;
      i += 1;
    }
  }

  return new RegExp('^' + regex + '$');
}

/**
 * Test whether a relative file path matches a glob pattern.
 * The path should use forward slashes.
 */
function matchesGlob(filePath: string, pattern: string): boolean {
  // Shortcut: if pattern has no wildcard characters, do prefix/suffix match
  const normalized = pattern.replace(/\\/g, '/');

  // Directory pattern ending with / — match as prefix
  if (normalized.endsWith('/')) {
    const dir = normalized.slice(0, -1);
    return (
      filePath.startsWith(dir + '/') ||
      filePath.includes('/' + dir + '/') ||
      filePath === dir
    );
  }

  const re = globToRegex(normalized);
  return re.test(filePath);
}

// ---------------------------------------------------------------------------
// Default exclude filter
// ---------------------------------------------------------------------------

/**
 * Check whether a relative path (forward slashes) matches the default
 * excludes. Returns a reason string if excluded, or null if allowed.
 */
function matchesDefaultExclude(relativePath: string): string | null {
  const parts = relativePath.split('/');
  const basename = parts[parts.length - 1]!;

  // Check each path segment against excluded directories
  for (const part of parts) {
    if (DEFAULT_EXCLUDE_DIRS.has(part)) {
      return `default-exclude-dir:${part}`;
    }
    // Prefix-based excludes (dist-*, build-*, etc.)
    for (const prefix of DEFAULT_EXCLUDE_DIR_PREFIXES) {
      if (part.startsWith(prefix)) {
        return `default-exclude-dir:${part}`;
      }
    }
  }

  // Exact filename match
  if (DEFAULT_EXCLUDE_FILES.has(basename)) {
    return `default-exclude-file:${basename}`;
  }

  // Extension-based excludes (compound extensions like .min.js)
  for (const ext of DEFAULT_EXCLUDE_EXTENSIONS) {
    if (basename.endsWith(ext)) {
      return `default-exclude-ext:${ext}`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// File list builders (git vs readdir)
// ---------------------------------------------------------------------------

async function getGitFileList(root: string, timeout: number): Promise<string[] | null> {
  const result = await execTool(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: root, timeout },
  );

  if (result.exitCode !== 0) {
    return null; // not a git repo or git not available
  }

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function getReaddirFileList(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, {
    recursive: true,
    withFileTypes: true,
  });

  const files: string[] = [];
  for (const entry of entries) {
    // Include regular files AND symlinks (symlink safety is checked later)
    if (entry.isFile() || entry.isSymbolicLink()) {
      const parent = entry.parentPath;
      const fullPath = path.join(parent, entry.name);
      const rel = path.relative(root, fullPath);
      files.push(rel);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Symlink safety
// ---------------------------------------------------------------------------

interface SymlinkContext {
  root: string;
  visitedInodes: Set<string>;
}

/**
 * Resolve a path and verify it stays within the repo root.
 * Returns the resolved absolute path or null if unsafe.
 */
async function resolveSymlinkSafe(
  filePath: string,
  ctx: SymlinkContext,
): Promise<string | null> {
  try {
    const resolved = await fs.realpath(filePath);
    const resolvedNorm = path.resolve(resolved);
    const rootNorm = path.resolve(ctx.root);

    // Must stay within repo root
    if (!resolvedNorm.startsWith(rootNorm + path.sep) && resolvedNorm !== rootNorm) {
      return null; // escapes repo root
    }

    // Cycle detection via inode
    const stat = await fs.stat(resolved);
    const inodeKey = `${stat.dev}:${stat.ino}`;
    if (ctx.visitedInodes.has(inodeKey)) {
      return null; // cycle detected
    }
    ctx.visitedInodes.add(inodeKey);

    return resolved;
  } catch {
    return null; // broken symlink or access error
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Build the canonical file list for analysis.
 *
 * 1. Get raw file list (git ls-files or recursive readdir)
 * 2. Apply default excludes
 * 3. Apply config.exclude patterns
 * 4. Apply config.include patterns (if any — acts as allowlist)
 * 5. Check file size, binary status, symlink safety
 * 6. Return populated FileEntry[]
 */
export async function buildFileList(
  root: string,
  config: AnalysisConfig,
): Promise<FileEntry[]> {
  // Resolve through realpath so symlink safety checks work on systems
  // where /tmp → /private/tmp (macOS) or similar indirections.
  let absRoot: string;
  try {
    absRoot = await fs.realpath(path.resolve(root));
  } catch {
    absRoot = path.resolve(root);
  }

  // Step 1: Get raw file list
  let rawFiles = await getGitFileList(absRoot, config.timeout);
  if (rawFiles === null) {
    rawFiles = await getReaddirFileList(absRoot);
  }

  // Normalize all paths to forward slashes
  rawFiles = rawFiles.map((f) => f.replace(/\\/g, '/'));

  // Step 2: Apply default excludes
  let filtered = rawFiles.filter((f) => matchesDefaultExclude(f) === null);

  // Step 3: Apply config.exclude patterns
  if (config.exclude.length > 0) {
    filtered = filtered.filter((f) => {
      for (const pattern of config.exclude) {
        if (matchesGlob(f, pattern)) return false;
      }
      return true;
    });
  }

  // Step 4: Apply config.include patterns (allowlist — if specified, ONLY matching files pass)
  if (config.include.length > 0) {
    filtered = filtered.filter((f) => {
      for (const pattern of config.include) {
        if (matchesGlob(f, pattern)) return true;
      }
      return false;
    });
  }

  // Step 5: Build FileEntry[] with metadata
  const symlinkCtx: SymlinkContext = {
    root: absRoot,
    visitedInodes: new Set(),
  };

  const entries: FileEntry[] = [];

  for (const relativePath of filtered) {
    const absPath = path.join(absRoot, relativePath);

    // Symlink check
    try {
      const lstat = await fs.lstat(absPath);
      if (lstat.isSymbolicLink()) {
        if (!config.followSymlinks) {
          continue; // skip symlinks by default
        }
        const resolved = await resolveSymlinkSafe(absPath, symlinkCtx);
        if (resolved === null) {
          continue; // unsafe symlink — escapes root or cycle
        }
      }
    } catch {
      continue; // stat failed — skip
    }

    // File size check
    let size: number;
    try {
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) continue;
      size = stat.size;
    } catch {
      continue;
    }

    if (size > config.maxFileSize) {
      continue;
    }

    // Binary detection
    const binary = await isBinary(absPath);

    // Build entry
    const ext = path.extname(relativePath);
    const language = detectLanguageForFile(relativePath);
    const test = isTestFile(relativePath);

    entries.push({
      path: relativePath,
      language,
      extension: ext,
      size,
      isTest: test,
      isBinary: binary,
    });
  }

  return entries;
}
