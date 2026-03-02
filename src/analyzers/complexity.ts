/**
 * McCabe cyclomatic complexity analyzer using tree-sitter AST parsing.
 *
 * Walks the AST of each parseable source file, detects function boundaries,
 * and counts decision points per the McCabe standard (see spec/metrics-v1.md).
 *
 * Key invariants:
 * - `else` does NOT increment. Only the `if` inside an `else if` increments.
 * - `switch` itself does NOT increment. Each `case` increments. `default` does NOT.
 * - Logical operators (&&, ||, ??) each increment by 1.
 * - Nested functions are separate — inner decision points do NOT count toward outer.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ComplexityResult,
  FileComplexity,
  FunctionComplexity,
  RepositoryIndex,
} from '../core/types.js';
import {
  parseSource,
  getLanguageForExtension,
  type SyntaxNode,
} from '../utils/tree-sitter.js';

// ── Constants ────────────────────────────────────────────────────────

/** Node types that represent function boundaries. */
const FUNCTION_NODE_TYPES = new Set([
  // TypeScript / JavaScript
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'generator_function',
  'arrow_function',
  'method_definition',
  // Python
  'function_definition',
  'lambda',
  // Go
  'method_declaration',
  'func_literal',
  // Note: 'function_declaration' is shared by JS/TS and Go
]);

/** Node types that are always a +1 decision point. */
const DECISION_POINT_TYPES = new Set([
  // Shared / TypeScript / JavaScript
  'if_statement',
  'for_statement',
  'for_in_statement', // covers both for...in and for...of in tree-sitter
  'while_statement',
  'do_statement',
  'switch_case', // each case label; switch_default is excluded
  'catch_clause',
  'ternary_expression',
  // Python
  'except_clause',
  'elif_clause', // Python elif — each elif is a separate clause in the AST
  'conditional_expression', // Python ternary: x if cond else y
  'list_comprehension',
  'set_comprehension',
  'dictionary_comprehension',
  'generator_expression',
  // Go
  'expression_case', // case in switch/select
  'communication_case', // case in select statement
  'type_case', // case in type switch
]);

/** Binary expression operators that increment complexity. */
const COMPLEXITY_OPERATORS = new Set(['&&', '||', '??']);

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Check whether a node type represents a function boundary.
 */
function isFunctionNode(type: string): boolean {
  return FUNCTION_NODE_TYPES.has(type);
}

/**
 * Return 1 if the node is a decision point, 0 otherwise.
 */
function getDecisionPointScore(node: SyntaxNode): number {
  if (DECISION_POINT_TYPES.has(node.type)) {
    return 1;
  }

  // Logical operators: binary_expression with &&, ||, or ?? (JS/TS/Go)
  if (node.type === 'binary_expression') {
    const operator = node.child(1);
    if (operator && COMPLEXITY_OPERATORS.has(operator.type)) {
      return 1;
    }
  }

  // Python logical operators: boolean_operator with 'and' or 'or'
  if (node.type === 'boolean_operator') {
    const operator = node.child(1);
    if (operator && (operator.type === 'and' || operator.type === 'or')) {
      return 1;
    }
  }

  return 0;
}

/**
 * Count decision points in a function's subtree, skipping nested functions.
 * Each nested function is a separate entity with its own base complexity.
 */
function countComplexity(node: SyntaxNode): number {
  let count = 0;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    // Do not descend into nested function nodes — they are separate.
    if (isFunctionNode(child.type)) continue;

    count += getDecisionPointScore(child);
    count += countComplexity(child);
  }

  return count;
}

/**
 * Extract the name for a function node. Falls back to `<anonymous>`.
 *
 * Strategy:
 * - function_declaration / generator_function_declaration: look for `identifier` child
 * - method_definition: look for `property_identifier` child
 * - arrow_function / function_expression: walk up to parent `variable_declarator`,
 *   `pair`, or `public_field_definition` and grab the identifier there
 */
function extractFunctionName(node: SyntaxNode): string {
  const type = node.type;

  // Named function or generator function declaration (JS/TS/Go)
  // Also handles Python function_definition (same child structure: identifier child)
  if (
    type === 'function_declaration' ||
    type === 'generator_function_declaration' ||
    type === 'function_definition'
  ) {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'identifier') {
        return child.text;
      }
    }
    return '<anonymous>';
  }

  // Python lambda — always unnamed
  if (type === 'lambda') {
    return '<lambda>';
  }

  // Go method declaration — name is a field_identifier child
  if (type === 'method_declaration') {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'field_identifier') {
        return child.text;
      }
    }
    return '<anonymous>';
  }

  // Go func literal — check parent chain for short_var_declaration, var_spec, or assignment_statement.
  // In Go's AST, func_literal is wrapped in expression_list, so the actual declaration is the grandparent.
  if (type === 'func_literal') {
    // Walk up through expression_list wrappers to find the declaration node
    let ancestor = node.parent;
    if (ancestor?.type === 'expression_list') {
      ancestor = ancestor.parent;
    }

    // x := func() {} (short_var_declaration)
    if (ancestor?.type === 'short_var_declaration') {
      const left = ancestor.child(0);
      if (left?.type === 'expression_list') {
        const ident = left.child(0);
        if (ident?.type === 'identifier') {
          return ident.text;
        }
      }
    }

    // var x = func() {} (var_spec)
    if (ancestor?.type === 'var_spec') {
      for (let i = 0; i < ancestor.childCount; i++) {
        const child = ancestor.child(i);
        if (child?.type === 'identifier') {
          return child.text;
        }
      }
    }

    // x = func() {} (assignment_statement)
    if (ancestor?.type === 'assignment_statement') {
      const left = ancestor.child(0);
      if (left?.type === 'expression_list') {
        const ident = left.child(0);
        if (ident?.type === 'identifier') {
          return ident.text;
        }
      }
    }

    return '<anonymous>';
  }

  // Class or object method
  if (type === 'method_definition') {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'property_identifier') {
        return child.text;
      }
    }
    return '<anonymous>';
  }

  // Arrow function or function expression — check parent context
  if (type === 'arrow_function' || type === 'function_expression' || type === 'generator_function') {
    const parent = node.parent;

    // const foo = () => {}  OR  const foo = function() {}
    if (parent?.type === 'variable_declarator') {
      for (let i = 0; i < parent.childCount; i++) {
        const child = parent.child(i);
        if (child?.type === 'identifier') {
          return child.text;
        }
      }
    }

    // { key: () => {} }  (pair in an object literal)
    if (parent?.type === 'pair') {
      for (let i = 0; i < parent.childCount; i++) {
        const child = parent.child(i);
        if (child?.type === 'property_identifier' || child?.type === 'string') {
          return child.text;
        }
      }
    }

    // static foo = () => {}  (public_field_definition in a class)
    if (parent?.type === 'public_field_definition') {
      for (let i = 0; i < parent.childCount; i++) {
        const child = parent.child(i);
        if (child?.type === 'property_identifier') {
          return child.text;
        }
      }
    }

    // Assigned via = inside an assignment_expression: foo = () => {}
    if (parent?.type === 'assignment_expression') {
      const left = parent.child(0);
      if (left?.type === 'identifier') {
        return left.text;
      }
    }

    return '<anonymous>';
  }

  return '<anonymous>';
}

/**
 * Recursively collect all function nodes from the AST.
 * Returns a flat list — nested functions are discovered as we walk deeper.
 *
 * Filters out anonymous (keyword) nodes: in the Python grammar, the `lambda`
 * keyword token shares the same type string as the `lambda` expression node.
 * Only named (non-keyword) nodes are actual function boundaries.
 */
function collectFunctions(node: SyntaxNode): SyntaxNode[] {
  const functions: SyntaxNode[] = [];

  function walk(n: SyntaxNode): void {
    if (isFunctionNode(n.type) && n.isNamed()) {
      functions.push(n);
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i);
      if (child) walk(child);
    }
  }

  walk(node);
  return functions;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Compute complexity metrics for a single source string.
 * Exported for direct use in tests without filesystem access.
 */
export async function computeFileComplexity(
  source: string,
  language: string,
  filePath: string,
): Promise<FileComplexity> {
  const tree = await parseSource(source, language);
  if (!tree) {
    return {
      file: filePath,
      avgComplexity: 0,
      maxComplexity: 0,
      functionCount: 0,
      functions: [],
    };
  }

  const functionNodes = collectFunctions(tree.rootNode);
  const functions: FunctionComplexity[] = [];

  for (const fnNode of functionNodes) {
    const name = extractFunctionName(fnNode);
    // line is 0-indexed in tree-sitter; spec requires 1-indexed
    const line = fnNode.startPosition.row + 1;
    const decisionPoints = countComplexity(fnNode);
    const complexity = 1 + decisionPoints; // base complexity = 1

    functions.push({ name, file: filePath, line, complexity });
  }

  const complexities = functions.map((f) => f.complexity);
  const avgComplexity =
    complexities.length > 0
      ? complexities.reduce((sum, c) => sum + c, 0) / complexities.length
      : 0;
  const maxComplexity =
    complexities.length > 0 ? Math.max(...complexities) : 0;

  return {
    file: filePath,
    avgComplexity,
    maxComplexity,
    functionCount: functions.length,
    functions,
  };
}

/**
 * Analyze cyclomatic complexity across all parseable files in the repository.
 */
export async function analyzeComplexity(
  index: RepositoryIndex,
): Promise<ComplexityResult> {
  const start = performance.now();

  const fileComplexities: FileComplexity[] = [];

  for (const file of index.files) {
    // Skip binary files
    if (file.isBinary) continue;

    // Skip files larger than the configured max
    if (file.size > index.config.maxFileSize) continue;

    // Only process files with supported tree-sitter languages
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

    // Skip minified/bundled files — avg line length > 500 chars is not human-written
    if (content.length > 0) {
      const lineCount = content.split('\n').length;
      if (lineCount > 0 && content.length / lineCount > 500) continue;
    }

    const fileResult = await computeFileComplexity(content, language, file.path);

    // Only include files that have at least one function
    if (fileResult.functionCount > 0) {
      fileComplexities.push(fileResult);
    }
  }

  // Aggregate repo-level metrics
  const allFunctions = fileComplexities.flatMap((fc) => fc.functions);
  const allComplexities = allFunctions.map((f) => f.complexity);

  const repoAvgComplexity =
    allComplexities.length > 0
      ? allComplexities.reduce((sum, c) => sum + c, 0) / allComplexities.length
      : 0;
  const repoMaxComplexity =
    allComplexities.length > 0 ? Math.max(...allComplexities) : 0;

  // Top 10 hotspots — descending by complexity, tie-break by file then line
  const hotspots = [...allFunctions]
    .sort((a, b) => {
      if (b.complexity !== a.complexity) return b.complexity - a.complexity;
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      return a.line - b.line;
    })
    .slice(0, 10);

  const durationMs = performance.now() - start;

  return {
    meta: {
      status: allFunctions.length > 0 ? 'computed' : 'skipped',
      reason: allFunctions.length > 0 ? undefined : 'No functions found in parseable files',
      durationMs,
    },
    repoAvgComplexity,
    repoMaxComplexity,
    totalFunctions: allFunctions.length,
    fileComplexities,
    hotspots,
  };
}
