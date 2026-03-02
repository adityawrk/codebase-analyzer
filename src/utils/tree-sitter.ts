/**
 * tree-sitter parser wrapper for web-tree-sitter (WASM-based).
 *
 * Provides cached parser instances per language and a simple parse API.
 * Uses web-tree-sitter (WASM) instead of node-tree-sitter (native bindings)
 * because native bindings fail to compile with Node 25.
 *
 * WASM grammar files are loaded from tree-sitter-wasms/out/.
 */

import Parser from 'web-tree-sitter';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Re-export types that callers will need.
export type { Parser };
export type SyntaxNode = Parser.SyntaxNode;
export type Tree = Parser.Tree;

// ── State ──────────────────────────────────────────────────────────

let initialized = false;
const parserCache = new Map<string, Parser>();
const languageCache = new Map<string, Parser.Language>();

// ── Supported languages ────────────────────────────────────────────

const SUPPORTED_LANGUAGES = new Set([
  'typescript',
  'tsx',
  'javascript',
  'python',
  'go',
]);

const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
};

// ── Public API ─────────────────────────────────────────────────────

/**
 * Initialize the web-tree-sitter WASM runtime.
 * Must be called once before any other tree-sitter operations.
 * Safe to call multiple times (no-ops after the first).
 */
export async function initTreeSitter(): Promise<void> {
  if (initialized) return;

  const treeSitterWasmPath = path.join(
    path.dirname(require.resolve('web-tree-sitter/package.json')),
    'tree-sitter.wasm',
  );

  await Parser.init({
    locateFile: () => treeSitterWasmPath,
  });

  initialized = true;
}

/**
 * Get or create a cached Parser instance for the given language.
 *
 * @param language - tree-sitter language name (e.g. 'typescript', 'python')
 * @returns A ready-to-use Parser, or null if the language is unsupported.
 */
export async function createParser(language: string): Promise<Parser | null> {
  if (!SUPPORTED_LANGUAGES.has(language)) {
    return null;
  }

  const cached = parserCache.get(language);
  if (cached) return cached;

  await initTreeSitter();

  const lang = await loadLanguage(language);
  if (!lang) return null;

  const parser = new Parser();
  parser.setLanguage(lang);
  parserCache.set(language, parser);
  return parser;
}

/**
 * Parse a source string using the tree-sitter grammar for the given language.
 *
 * @param source   - The source code to parse.
 * @param language - tree-sitter language name (e.g. 'typescript', 'go').
 * @returns The parsed syntax tree, or null if the language is unsupported.
 */
export async function parseSource(
  source: string,
  language: string,
): Promise<Parser.Tree | null> {
  const parser = await createParser(language);
  if (!parser) return null;
  return parser.parse(source);
}

/**
 * Map a file extension (with leading dot) to a tree-sitter language name.
 *
 * @param ext - File extension including the dot (e.g. '.ts', '.py').
 * @returns The tree-sitter language name, or null if unmapped.
 */
export function getLanguageForExtension(ext: string): string | null {
  return EXTENSION_MAP[ext] ?? null;
}

// ── Internal helpers ───────────────────────────────────────────────

/**
 * Load and cache a Language WASM binary.
 */
async function loadLanguage(language: string): Promise<Parser.Language | null> {
  const cached = languageCache.get(language);
  if (cached) return cached;

  try {
    const wasmPath = path.join(
      path.dirname(require.resolve('tree-sitter-wasms/package.json')),
      'out',
      `tree-sitter-${language}.wasm`,
    );

    const lang = await Parser.Language.load(wasmPath);
    languageCache.set(language, lang);
    return lang;
  } catch {
    return null;
  }
}
