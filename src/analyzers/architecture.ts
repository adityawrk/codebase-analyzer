/**
 * Architecture analyzer — import graph, circular dependency detection, module cohesion.
 *
 * Parses import/require statements from source files via tree-sitter AST,
 * builds a directed import graph, detects cycles using iterative DFS (Tarjan-like),
 * and computes per-module cohesion ratios.
 *
 * Supported languages:
 * - TypeScript/JavaScript: import_statement, require() calls
 * - Python: import_statement, import_from_statement
 * - Go: import_declaration
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  RepositoryIndex,
  ArchitectureResult,
  ImportEdge,
  CircularDependency,
  ModuleCohesion,
} from '../core/types.js';
import {
  parseSource,
  getLanguageForExtension,
  initTreeSitter,
  type SyntaxNode,
} from '../utils/tree-sitter.js';

// ── Types ──────────────────────────────────────────────────────────

export interface RawImport {
  /** The raw specifier string from the source (e.g. './bar.js', 'node:fs') */
  specifier: string;
  /** Whether this is a relative import (starts with . or ..) */
  isRelative: boolean;
}

// ── Constants ──────────────────────────────────────────────────────

/** Extensions to try when resolving a bare relative import. */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go'];

/** Index filenames to try when an import resolves to a directory. */
const INDEX_FILENAMES = ['index.ts', 'index.js'];

/** Python package init files to try when resolving a module as a package. */
const PYTHON_INIT_FILENAMES = ['__init__.py'];

// ── Import Extraction ──────────────────────────────────────────────

/**
 * Extract import specifiers from a parsed AST.
 * Exported for direct unit testing without filesystem access.
 *
 * @param source   - The source code string.
 * @param language - tree-sitter language name (e.g. 'typescript', 'python', 'go').
 * @param filePath - Relative file path (for context, not used in parsing).
 * @returns Array of raw imports found in the source.
 */
export async function extractImports(
  source: string,
  language: string,
  _filePath: string,
): Promise<RawImport[]> {
  const tree = await parseSource(source, language);
  if (!tree) return [];

  const imports: RawImport[] = [];

  if (language === 'typescript' || language === 'tsx' || language === 'javascript') {
    collectJSImports(tree.rootNode, imports);
  } else if (language === 'python') {
    collectPythonImports(tree.rootNode, imports);
  } else if (language === 'go') {
    collectGoImports(tree.rootNode, imports);
  }

  return imports;
}

/**
 * Collect ES module imports and CommonJS require() calls from JS/TS AST.
 */
function collectJSImports(root: SyntaxNode, out: RawImport[]): void {
  walkAST(root, (node) => {
    // ES import: import_statement → source child is a string node
    if (node.type === 'import_statement') {
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        const specifier = stripQuotes(sourceNode.text);
        out.push({
          specifier,
          isRelative: specifier.startsWith('.'),
        });
      }
      return false; // no need to descend further
    }

    // Dynamic import: import('...')
    // tree-sitter parses this as call_expression with function = "import"
    // We also handle require('...')
    if (node.type === 'call_expression') {
      const fn = node.child(0);
      if (!fn) return true;

      const isRequire = fn.type === 'identifier' && fn.text === 'require';
      const isImportCall = fn.type === 'import';

      if (isRequire || isImportCall) {
        const args = node.childForFieldName('arguments');
        if (args && args.childCount >= 2) {
          // arguments node: ( string_literal )
          // child(0) = '(', child(1) = string_literal, child(2) = ')'
          const firstArg = args.child(1);
          if (firstArg && (firstArg.type === 'string' || firstArg.type === 'template_string')) {
            const specifier = stripQuotes(firstArg.text);
            out.push({
              specifier,
              isRelative: specifier.startsWith('.'),
            });
          }
        }
      }
    }

    return true; // continue walking
  });
}

/**
 * Collect imports from Python AST.
 * - import_statement: `import foo`
 * - import_from_statement: `from .bar import baz` or `from package import x`
 */
function collectPythonImports(root: SyntaxNode, out: RawImport[]): void {
  walkAST(root, (node) => {
    if (node.type === 'import_statement') {
      // `import foo.bar` — child is dotted_name
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type === 'dotted_name') {
          const specifier = child.text;
          out.push({
            specifier,
            isRelative: false, // bare `import x` is never relative in Python
          });
        }
      }
      return false;
    }

    if (node.type === 'import_from_statement') {
      // `from .module import something` or `from package import something`
      // The module name is in a dotted_name or relative_import child
      let specifier: string | null = null;
      let isRelative = false;

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (child.type === 'relative_import') {
          specifier = child.text;
          isRelative = true;
          break;
        }
        if (child.type === 'dotted_name' && specifier === null) {
          // The first dotted_name after "from" is the module name
          // (subsequent ones are in the import list)
          const prevSibling = child.previousSibling;
          if (prevSibling && prevSibling.type === 'from') {
            specifier = child.text;
            isRelative = false;
          }
        }
      }

      if (specifier) {
        out.push({ specifier, isRelative });
      }
      return false;
    }

    return true;
  });
}

/**
 * Collect imports from Go AST.
 * - import_declaration contains import_spec nodes with a path child (string literal).
 */
function collectGoImports(root: SyntaxNode, out: RawImport[]): void {
  walkAST(root, (node) => {
    if (node.type === 'import_spec') {
      const pathNode = node.childForFieldName('path');
      if (pathNode) {
        const specifier = stripQuotes(pathNode.text);
        // Go imports are always absolute package paths; treat all as external
        // unless they start with the module path (which we don't resolve here).
        out.push({
          specifier,
          isRelative: false,
        });
      }
      return false;
    }

    return true;
  });
}

// ── AST Walking ────────────────────────────────────────────────────

/**
 * Walk all nodes in the AST. The visitor returns true to continue
 * descending into children, false to skip.
 */
function walkAST(node: SyntaxNode, visitor: (n: SyntaxNode) => boolean): void {
  const shouldDescend = visitor(node);
  if (!shouldDescend) return;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkAST(child, visitor);
  }
}

// ── Import Resolution ──────────────────────────────────────────────

/**
 * Resolve a relative import specifier to an actual file path in the repo.
 *
 * @param specifier   - The import specifier (e.g. './bar.js', '../utils/helper')
 * @param fromFile    - The relative path of the importing file
 * @param filePathSet - Set of all relative file paths in the repo (for fast lookup)
 * @returns The resolved relative path, or null if resolution fails.
 */
function resolveRelativeImport(
  specifier: string,
  fromFile: string,
  filePathSet: Set<string>,
): string | null {
  const fromDir = path.dirname(fromFile);
  // Normalize the resolved path (forward slashes, no leading ./)
  const rawResolved = path.join(fromDir, specifier);
  const resolved = normalizePath(rawResolved);

  // 1. Exact match (specifier already includes extension)
  if (filePathSet.has(resolved)) {
    return resolved;
  }

  // 2. Try appending extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = resolved + ext;
    if (filePathSet.has(candidate)) {
      return candidate;
    }
  }

  // 3. Try as directory with index file
  for (const indexFile of INDEX_FILENAMES) {
    const candidate = normalizePath(path.join(resolved, indexFile));
    if (filePathSet.has(candidate)) {
      return candidate;
    }
  }

  // 4. If specifier has .js extension, try replacing with .ts/.tsx
  if (specifier.endsWith('.js')) {
    const withoutExt = resolved.slice(0, -3);
    for (const ext of ['.ts', '.tsx']) {
      const candidate = withoutExt + ext;
      if (filePathSet.has(candidate)) {
        return candidate;
      }
    }
  }

  // 5. If specifier has .jsx extension, try replacing with .tsx
  if (specifier.endsWith('.jsx')) {
    const withoutExt = resolved.slice(0, -4);
    const candidate = withoutExt + '.tsx';
    if (filePathSet.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

// ── Go Internal Import Resolution ──────────────────────────────────

/**
 * Parse the module path from a go.mod file's content.
 * Extracts the `module` directive value, e.g. "github.com/user/project".
 *
 * @param goModContent - The raw content of go.mod
 * @returns The module path, or null if not found.
 */
export function parseGoModulePath(goModContent: string): string | null {
  // go.mod format: `module github.com/user/project`
  const match = goModContent.match(/^\s*module\s+(\S+)/m);
  return match?.[1] ?? null;
}

/**
 * Resolve a Go import to an internal repo file path.
 *
 * Go imports are always absolute package paths (e.g. "github.com/user/project/pkg/foo").
 * If the import starts with the module path, it is internal. We strip the module prefix
 * and look for matching .go files within the resulting directory.
 *
 * @param specifier    - The Go import path (e.g. "github.com/user/project/internal/db")
 * @param goModulePath - The module path from go.mod (e.g. "github.com/user/project")
 * @param filePathSet  - Set of all relative file paths in the repo (for fast lookup)
 * @returns A resolved relative file path, or null if resolution fails.
 */
function resolveGoInternalImport(
  specifier: string,
  goModulePath: string,
  filePathSet: Set<string>,
): string | null {
  if (specifier !== goModulePath && !specifier.startsWith(goModulePath + '/')) return null;

  // Strip the module prefix: "github.com/user/project/pkg/foo" → "pkg/foo"
  let subPath = specifier.slice(goModulePath.length);
  // Remove leading slash
  if (subPath.startsWith('/')) subPath = subPath.slice(1);

  // If subPath is empty, it refers to the root package
  if (!subPath) subPath = '.';

  // Go packages map to directories. Look for any .go file in that directory.
  // We try to find at least one .go file in the directory to create the edge.
  const prefix = subPath === '.' ? '' : subPath + '/';

  for (const filePath of filePathSet) {
    if (!filePath.endsWith('.go')) continue;
    if (prefix === '') {
      // Root package — match files directly in root (no '/' in path)
      if (!filePath.includes('/')) return filePath;
    } else if (filePath.startsWith(prefix)) {
      // Check that it's directly in this directory, not a subdirectory
      const remainder = filePath.slice(prefix.length);
      if (!remainder.includes('/')) return filePath;
    }
  }

  return null;
}

// ── Python Relative Import Resolution ──────────────────────────────

/**
 * Resolve a Python relative import specifier to an actual file path.
 *
 * Python relative imports use leading dots for package-level traversal:
 * - `.module` from `src/pkg/main.py` → `src/pkg/module.py` or `src/pkg/module/__init__.py`
 * - `..utils` from `src/pkg/sub/main.py` → `src/pkg/utils.py` or `src/pkg/utils/__init__.py`
 * - `...` from `src/a/b/c.py` → `src/__init__.py`
 *
 * @param specifier   - The raw relative import (e.g. ".module", "..utils.helper")
 * @param fromFile    - The relative path of the importing file
 * @param filePathSet - Set of all relative file paths in the repo
 * @returns The resolved relative path, or null if resolution fails.
 */
function resolvePythonRelativeImport(
  specifier: string,
  fromFile: string,
  filePathSet: Set<string>,
): string | null {
  // Count leading dots to determine the level of traversal
  let dots = 0;
  while (dots < specifier.length && specifier[dots] === '.') {
    dots++;
  }

  // The module part after the dots (may be empty for bare `from . import x`)
  const modulePart = specifier.slice(dots);

  // Start from the directory of the importing file
  let baseDir = path.dirname(fromFile);

  // Each dot represents one level up EXCEPT the first dot which means "current package".
  // `.module` → 0 levels up from current dir (1 dot = same dir)
  // `..module` → 1 level up (2 dots = parent dir)
  // `...module` → 2 levels up
  const levelsUp = dots - 1;
  for (let i = 0; i < levelsUp; i++) {
    baseDir = path.dirname(baseDir);
  }

  if (!modulePart) {
    // Bare relative import like `from . import x` — resolves to __init__.py of the package
    for (const initFile of PYTHON_INIT_FILENAMES) {
      const candidate = normalizePath(path.join(baseDir, initFile));
      if (filePathSet.has(candidate)) return candidate;
    }
    return null;
  }

  // Convert dotted module path to directory segments: "utils.helper" → "utils/helper"
  const segments = modulePart.split('.');
  const modulePath = normalizePath(path.join(baseDir, ...segments));

  // 1. Try as a .py file directly
  const pyCandidate = modulePath + '.py';
  if (filePathSet.has(pyCandidate)) return pyCandidate;

  // 2. Try as a package directory with __init__.py
  for (const initFile of PYTHON_INIT_FILENAMES) {
    const candidate = normalizePath(path.join(modulePath, initFile));
    if (filePathSet.has(candidate)) return candidate;
  }

  return null;
}

// ── Circular Dependency Detection ──────────────────────────────────

/**
 * Detect all strongly connected components (SCCs) with >1 node using
 * Tarjan's algorithm (iterative implementation to avoid stack overflow).
 *
 * Each SCC with more than one node represents a circular dependency.
 */
function findCircularDependencies(
  adjacency: Map<string, string[]>,
): CircularDependency[] {
  let indexCounter = 0;
  const nodeIndex = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  // Collect all nodes that appear in the graph (both sources and targets)
  const allNodes = new Set<string>();
  for (const [from, tos] of adjacency) {
    allNodes.add(from);
    for (const to of tos) {
      allNodes.add(to);
    }
  }

  // Iterative Tarjan's using an explicit call stack
  type Frame = {
    node: string;
    neighborIndex: number;
    neighbors: string[];
  };

  function strongConnect(startNode: string): void {
    const callStack: Frame[] = [];

    // Initialize start node
    nodeIndex.set(startNode, indexCounter);
    lowLink.set(startNode, indexCounter);
    indexCounter++;
    stack.push(startNode);
    onStack.add(startNode);

    const neighbors = adjacency.get(startNode) ?? [];
    callStack.push({ node: startNode, neighborIndex: 0, neighbors });

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1]!;

      if (frame.neighborIndex < frame.neighbors.length) {
        const w = frame.neighbors[frame.neighborIndex]!;
        frame.neighborIndex++;

        if (!nodeIndex.has(w)) {
          // w has not been visited; recurse
          nodeIndex.set(w, indexCounter);
          lowLink.set(w, indexCounter);
          indexCounter++;
          stack.push(w);
          onStack.add(w);

          const wNeighbors = adjacency.get(w) ?? [];
          callStack.push({ node: w, neighborIndex: 0, neighbors: wNeighbors });
        } else if (onStack.has(w)) {
          // w is on stack — update lowlink
          const currentLow = lowLink.get(frame.node)!;
          const wIdx = nodeIndex.get(w)!;
          lowLink.set(frame.node, Math.min(currentLow, wIdx));
        }
      } else {
        // All neighbors processed — check if this is a root of an SCC
        const v = frame.node;
        if (lowLink.get(v) === nodeIndex.get(v)) {
          const scc: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            scc.push(w);
          } while (w !== v);

          if (scc.length > 1) {
            // Reverse so the cycle reads in dependency order
            scc.reverse();
            sccs.push(scc);
          }
        }

        // Pop this frame and update parent's lowlink
        callStack.pop();
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1]!;
          const parentLow = lowLink.get(parent.node)!;
          const childLow = lowLink.get(v)!;
          lowLink.set(parent.node, Math.min(parentLow, childLow));
        }
      }
    }
  }

  // Visit all unvisited nodes
  for (const node of allNodes) {
    if (!nodeIndex.has(node)) {
      strongConnect(node);
    }
  }

  return sccs.map((cycle) => ({ cycle }));
}

// ── Module Cohesion ────────────────────────────────────────────────

/**
 * Get the top-level module for a file path.
 * E.g. "src/analyzers/sizing.ts" → "analyzers"
 *      "src/core/types.ts" → "core"
 *      "README.md" → null (top-level files have no module)
 */
function getModule(filePath: string): string | null {
  const parts = filePath.split('/');
  // Skip the first segment if it's "src/" and there's a subdirectory
  if (parts.length >= 3 && parts[0] === 'src') {
    return parts[1] ?? null;
  }
  // If the file is directly in a top-level dir (not src), use that dir
  if (parts.length >= 2) {
    return parts[0] ?? null;
  }
  return null;
}

/**
 * Compute cohesion metrics per module.
 */
function computeModuleCohesion(
  edges: ImportEdge[],
): ModuleCohesion[] {
  // Build a map: module → { intra, total }
  const moduleStats = new Map<string, { intra: number; total: number }>();

  for (const edge of edges) {
    const fromModule = getModule(edge.from);
    if (!fromModule) continue;

    if (!moduleStats.has(fromModule)) {
      moduleStats.set(fromModule, { intra: 0, total: 0 });
    }
    const stats = moduleStats.get(fromModule)!;
    stats.total++;

    const toModule = getModule(edge.to);
    if (toModule === fromModule) {
      stats.intra++;
    }
  }

  const result: ModuleCohesion[] = [];
  for (const [mod, stats] of moduleStats) {
    result.push({
      module: mod,
      intraImports: stats.intra,
      totalImports: stats.total,
      cohesionRatio: stats.total > 0 ? stats.intra / stats.total : 0,
    });
  }

  // Sort by module name for stable output
  result.sort((a, b) => a.module.localeCompare(b.module));
  return result;
}

// ── Utilities ──────────────────────────────────────────────────────

/**
 * Strip surrounding quotes from a string literal.
 * Handles single quotes, double quotes, backticks, and triple quotes.
 */
function stripQuotes(s: string): string {
  // Triple quotes (Python)
  if (s.startsWith('"""') && s.endsWith('"""')) return s.slice(3, -3);
  if (s.startsWith("'''") && s.endsWith("'''")) return s.slice(3, -3);
  // Single/double/backtick
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('`') && s.endsWith('`'))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Normalize a file path: forward slashes, remove leading './' if present.
 */
function normalizePath(p: string): string {
  const normalized = p.split(path.sep).join('/');
  if (normalized.startsWith('./')) return normalized.slice(2);
  return normalized;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Analyze the architecture of the repository: build import graph,
 * detect circular dependencies, compute module cohesion.
 */
export async function analyzeArchitecture(
  index: RepositoryIndex,
): Promise<ArchitectureResult> {
  const start = performance.now();

  try {
    await initTreeSitter();

    // Build a set of all file paths for fast resolution lookups
    const filePathSet = new Set<string>();
    for (const file of index.files) {
      filePathSet.add(file.path);
    }

    // Read Go module path from go.mod if present
    let goModulePath: string | null = null;
    const goManifest = index.manifests.find((m) => m.type === 'go');
    if (goManifest) {
      const goModAbsPath = path.join(index.root, goManifest.path);
      try {
        const goModContent = await fs.readFile(goModAbsPath, 'utf-8');
        goModulePath = parseGoModulePath(goModContent);
      } catch {
        // go.mod unreadable — degrade gracefully, Go imports stay unresolved
      }
    }

    // Extract imports from all parseable files
    const allEdges: ImportEdge[] = [];
    const adjacency = new Map<string, string[]>();

    for (const file of index.files) {
      if (file.isBinary) continue;
      if (file.size > index.config.maxFileSize) continue;

      const language = getLanguageForExtension(file.extension);
      if (!language) continue;

      const absPath = path.join(index.root, file.path);

      let content: string;
      try {
        content = await fs.readFile(absPath, 'utf-8');
      } catch {
        // File unreadable — skip silently (degradation, not crash)
        continue;
      }

      const rawImports = await extractImports(content, language, file.path);

      for (const raw of rawImports) {
        let resolved: string | null = null;

        if (language === 'go' && !raw.isRelative && goModulePath) {
          // Go: all imports are non-relative, but internal ones start with the module path
          resolved = resolveGoInternalImport(raw.specifier, goModulePath, filePathSet);
        } else if (language === 'python' && raw.isRelative) {
          // Python: relative imports use leading dots, not filesystem paths
          resolved = resolvePythonRelativeImport(raw.specifier, file.path, filePathSet);
        } else if (raw.isRelative) {
          // JS/TS and other languages with filesystem-style relative imports
          resolved = resolveRelativeImport(raw.specifier, file.path, filePathSet);
        }

        if (!resolved) continue;

        // Skip self-imports
        if (resolved === file.path) continue;

        const edge: ImportEdge = { from: file.path, to: resolved };
        allEdges.push(edge);

        if (!adjacency.has(file.path)) {
          adjacency.set(file.path, []);
        }
        adjacency.get(file.path)!.push(resolved);
      }
    }

    // Deduplicate edges (same from→to can appear if a file imports the same thing twice)
    const edgeSet = new Set<string>();
    const uniqueEdges: ImportEdge[] = [];
    for (const edge of allEdges) {
      const key = `${edge.from}\0${edge.to}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        uniqueEdges.push(edge);
      }
    }

    // Find all unique modules
    const moduleSet = new Set<string>();
    for (const file of index.files) {
      const mod = getModule(file.path);
      if (mod) moduleSet.add(mod);
    }

    // Detect circular dependencies
    const circularDependencies = findCircularDependencies(adjacency);

    // Compute module cohesion
    const moduleCohesion = computeModuleCohesion(uniqueEdges);

    const durationMs = performance.now() - start;

    return {
      meta: {
        status: uniqueEdges.length > 0 ? 'computed' : 'skipped',
        reason: uniqueEdges.length > 0 ? undefined : 'No internal imports found',
        durationMs,
      },
      totalImports: uniqueEdges.length,
      uniqueModules: moduleSet.size,
      importGraph: uniqueEdges,
      circularDependencies,
      moduleCohesion,
    };
  } catch (err) {
    const durationMs = performance.now() - start;
    return {
      meta: {
        status: 'error',
        reason: err instanceof Error ? err.message : String(err),
        durationMs,
      },
      totalImports: 0,
      uniqueModules: 0,
      importGraph: [],
      circularDependencies: [],
      moduleCohesion: [],
    };
  }
}
