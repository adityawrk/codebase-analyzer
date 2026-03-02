/**
 * Sizing analyzer — wraps `scc` for LOC counting, language breakdown, and god-file detection.
 *
 * If scc is not available on $PATH, falls back to a slower line-counting approach
 * that reads files from the RepositoryIndex.
 */

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { execTool, checkTool } from '../core/exec.js';
import type {
  GodFile,
  LanguageBreakdown,
  RepositoryIndex,
  SizingResult,
} from '../core/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Files exceeding this many code lines are flagged as god files. */
const GOD_FILE_THRESHOLD = 500;

/**
 * Map scc language names to a canonical primary extension.
 * scc uses title-cased language names; we store the most common extension.
 */
const LANGUAGE_TO_EXTENSION: Record<string, string> = {
  TypeScript: '.ts',
  'TypeScript Typings': '.d.ts',
  TSX: '.tsx',
  JavaScript: '.js',
  JSX: '.jsx',
  Python: '.py',
  Go: '.go',
  Rust: '.rs',
  Java: '.java',
  Kotlin: '.kt',
  Ruby: '.rb',
  Swift: '.swift',
  C: '.c',
  'C Header': '.h',
  'C++': '.cpp',
  'C++ Header': '.hpp',
  'C#': '.cs',
  PHP: '.php',
  Dart: '.dart',
  JSON: '.json',
  YAML: '.yaml',
  TOML: '.toml',
  XML: '.xml',
  Markdown: '.md',
  HTML: '.html',
  CSS: '.css',
  SCSS: '.scss',
  SASS: '.sass',
  LESS: '.less',
  Shell: '.sh',
  Bash: '.sh',
  Zsh: '.zsh',
  SQL: '.sql',
  GraphQL: '.graphql',
  Dockerfile: '.dockerfile',
  Protobuf: '.proto',
  Lua: '.lua',
  R: '.r',
  Elixir: '.ex',
  Erlang: '.erl',
  Haskell: '.hs',
  Scala: '.scala',
  Clojure: '.clj',
  Vue: '.vue',
  Svelte: '.svelte',
  Makefile: '',
  Plain: '.txt',
  Text: '.txt',
  License: '',
  gitignore: '',
};

// ---------------------------------------------------------------------------
// scc JSON types (external tool output — typed loosely on purpose)
// ---------------------------------------------------------------------------

interface SccFileEntry {
  Filename: string;
  Location: string;
  Lines: number;
  Code: number;
  Comment: number;
  Blank: number;
}

interface SccLanguageEntry {
  Name: string;
  Count: number;
  Lines: number;
  Code: number;
  Comment: number;
  Blank: number;
  Files: SccFileEntry[];
}

// ---------------------------------------------------------------------------
// Extension lookup helper
// ---------------------------------------------------------------------------

function extensionForLanguage(languageName: string): string {
  return LANGUAGE_TO_EXTENSION[languageName] ?? '';
}

// ---------------------------------------------------------------------------
// scc-based analysis
// ---------------------------------------------------------------------------

async function analyzeSizingWithScc(index: RepositoryIndex): Promise<SizingResult> {
  const start = performance.now();

  const result = await execTool(
    'scc',
    ['--format', 'json', '--no-cocomo', '--by-file', index.root],
    { timeout: index.config.timeout, cwd: index.root },
  );

  if (result.exitCode !== 0) {
    const elapsed = performance.now() - start;
    return {
      meta: {
        status: 'error',
        reason: `scc exited with code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
        durationMs: elapsed,
      },
      totalFiles: 0,
      totalLines: 0,
      totalCodeLines: 0,
      totalBlankLines: 0,
      totalCommentLines: 0,
      languages: [],
      godFiles: [],
      largestFiles: [],
    };
  }

  let sccData: SccLanguageEntry[];
  try {
    sccData = JSON.parse(result.stdout) as SccLanguageEntry[];
  } catch {
    const elapsed = performance.now() - start;
    return {
      meta: {
        status: 'error',
        reason: 'Failed to parse scc JSON output',
        durationMs: elapsed,
      },
      totalFiles: 0,
      totalLines: 0,
      totalCodeLines: 0,
      totalBlankLines: 0,
      totalCommentLines: 0,
      languages: [],
      godFiles: [],
      largestFiles: [],
    };
  }

  // Accumulate totals
  let totalFiles = 0;
  let totalLines = 0;
  let totalCodeLines = 0;
  let totalBlankLines = 0;
  let totalCommentLines = 0;

  for (const lang of sccData) {
    totalFiles += lang.Count;
    totalLines += lang.Lines;
    totalCodeLines += lang.Code;
    totalBlankLines += lang.Blank;
    totalCommentLines += lang.Comment;
  }

  // Build language breakdown
  const languages: LanguageBreakdown[] = sccData.map((lang) => ({
    language: lang.Name,
    extension: extensionForLanguage(lang.Name),
    files: lang.Count,
    lines: lang.Lines,
    codeLines: lang.Code,
    blankLines: lang.Blank,
    commentLines: lang.Comment,
    percentOfCode: totalCodeLines > 0
      ? Math.round((lang.Code / totalCodeLines) * 10000) / 100
      : 0,
  }));

  // Sort by code lines descending
  languages.sort((a, b) => b.codeLines - a.codeLines);

  // Collect all files with their line counts
  const allFiles: GodFile[] = [];
  const godFiles: GodFile[] = [];
  for (const lang of sccData) {
    if (!lang.Files) continue;
    for (const file of lang.Files) {
      // scc --by-file puts absolute paths in Location; compute relative path
      const relPath = file.Location
        ? path.relative(index.root, file.Location)
        : file.Filename;
      const entry: GodFile = {
        path: relPath,
        lines: file.Lines,
        language: lang.Name,
      };
      allFiles.push(entry);
      if (file.Code > GOD_FILE_THRESHOLD) {
        godFiles.push({
          path: relPath,
          lines: file.Code,
          language: lang.Name,
        });
      }
    }
  }

  // Sort god files by lines descending
  godFiles.sort((a, b) => b.lines - a.lines);

  // Top 15 largest files by total line count
  allFiles.sort((a, b) => b.lines - a.lines);
  const largestFiles = allFiles.slice(0, 15);

  const elapsed = performance.now() - start;
  return {
    meta: { status: 'computed', durationMs: elapsed },
    totalFiles,
    totalLines,
    totalCodeLines,
    totalBlankLines,
    totalCommentLines,
    languages,
    godFiles,
    largestFiles,
  };
}

// ---------------------------------------------------------------------------
// Fallback analysis (no scc)
// ---------------------------------------------------------------------------

async function countFileLines(absPath: string): Promise<number> {
  try {
    const content = await readFile(absPath, 'utf-8');
    if (content.length === 0) return 0;
    // Count newlines; a file ending without newline still has at least 1 line
    let count = 0;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n') count++;
    }
    // If the file doesn't end with a newline, count the last line
    if (content[content.length - 1] !== '\n') count++;
    return count;
  } catch {
    return 0;
  }
}

async function analyzeSizingFallback(index: RepositoryIndex): Promise<SizingResult> {
  const start = performance.now();

  const languageMap = new Map<string, { files: number; lines: number; extension: string }>();
  const allFiles: GodFile[] = [];
  const godFiles: GodFile[] = [];

  let totalFiles = 0;
  let totalLines = 0;

  for (const file of index.files) {
    if (file.isBinary) continue;

    const absPath = path.join(index.root, file.path);
    const lines = await countFileLines(absPath);

    totalFiles++;
    totalLines += lines;

    // Track all files for largest-files list
    allFiles.push({
      path: file.path,
      lines,
      language: file.language,
    });

    // Accumulate per-language
    const entry = languageMap.get(file.language);
    if (entry) {
      entry.files++;
      entry.lines += lines;
    } else {
      languageMap.set(file.language, {
        files: 1,
        lines,
        extension: file.extension,
      });
    }

    // God file detection (using total lines since we can't distinguish code/comment without scc)
    if (lines > GOD_FILE_THRESHOLD) {
      godFiles.push({
        path: file.path,
        lines,
        language: file.language,
      });
    }
  }

  // Build language breakdown — without scc, we cannot distinguish code/blank/comment
  const languages: LanguageBreakdown[] = [];
  for (const [language, data] of languageMap) {
    languages.push({
      language,
      extension: data.extension,
      files: data.files,
      lines: data.lines,
      codeLines: data.lines, // best estimate without scc
      blankLines: 0,
      commentLines: 0,
      percentOfCode: totalLines > 0
        ? Math.round((data.lines / totalLines) * 10000) / 100
        : 0,
    });
  }

  languages.sort((a, b) => b.codeLines - a.codeLines);
  godFiles.sort((a, b) => b.lines - a.lines);

  // Top 15 largest files by total line count
  allFiles.sort((a, b) => b.lines - a.lines);
  const largestFiles = allFiles.slice(0, 15);

  const elapsed = performance.now() - start;
  return {
    meta: {
      status: 'computed',
      reason: 'scc not available — used fallback line counting (no code/blank/comment breakdown)',
      durationMs: elapsed,
    },
    totalFiles,
    totalLines,
    totalCodeLines: totalLines, // best estimate
    totalBlankLines: 0,
    totalCommentLines: 0,
    languages,
    godFiles,
    largestFiles,
  };
}

// ---------------------------------------------------------------------------
// Public API: analyzeSizing
// ---------------------------------------------------------------------------

/**
 * Analyze codebase sizing: LOC, language breakdown, god files.
 *
 * Prefers `scc` for accurate code/blank/comment counting.
 * Falls back to raw line counting from the RepositoryIndex if scc is unavailable.
 */
export async function analyzeSizing(index: RepositoryIndex): Promise<SizingResult> {
  const sccAvailable = await checkTool('scc');

  if (sccAvailable) {
    return analyzeSizingWithScc(index);
  }

  return analyzeSizingFallback(index);
}

