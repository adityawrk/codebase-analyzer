/**
 * Folder structure analyzer.
 * Builds a folder tree from RepositoryIndex files (no filesystem re-traversal)
 * and produces a formatted tree string for the report.
 */

import * as path from 'node:path';
import type { FolderNode, RepositoryIndex, StructureResult } from '../core/types.js';

/**
 * Build a FolderNode tree from an array of file paths.
 * Each node tracks only its direct file count (not recursive).
 */
function buildFolderTree(repoName: string, filePaths: readonly string[]): FolderNode {
  const root: FolderNode = { name: repoName, fileCount: 0, children: [] };

  for (const filePath of filePaths) {
    const parts = filePath.split('/');
    // The last part is the filename; everything before is folders.
    const folderParts = parts.slice(0, -1);

    let current = root;

    for (const folderName of folderParts) {
      let child = current.children.find((c) => c.name === folderName);
      if (!child) {
        child = { name: folderName, fileCount: 0, children: [] };
        current.children.push(child);
      }
      current = child;
    }

    // The file lives directly in `current`
    current.fileCount++;
  }

  return root;
}

/**
 * Recursively sort all children of a FolderNode alphabetically.
 */
function sortTree(node: FolderNode): void {
  node.children.sort((a, b) => a.name.localeCompare(b.name));
  for (const child of node.children) {
    sortTree(child);
  }
}

/** Maximum depth for tree rendering. Deeper folders are summarized. */
const MAX_TREE_DEPTH = 4;

/** Maximum total lines in the rendered tree. Exceeding this triggers truncation. */
const MAX_TREE_LINES = 80;

/**
 * Render a FolderNode tree into a formatted string using standard tree characters.
 *
 * Output format:
 * ```
 * repo-name/
 * ├── src/ (4 files)
 * │   ├── components/ (12 files)
 * │   └── utils/ (3 files)
 * └── docs/ (8 files)
 * ```
 *
 * Tree is capped at MAX_TREE_DEPTH levels and MAX_TREE_LINES total lines.
 */
function renderTree(root: FolderNode): string {
  const lines: string[] = [];
  lines.push(`${root.name}/`);
  const truncated = { value: false };
  renderChildren(root.children, '', lines, 1, truncated);
  if (truncated.value) {
    lines.push('... (truncated)');
  }
  return lines.join('\n');
}

function renderChildren(
  children: FolderNode[],
  prefix: string,
  lines: string[],
  depth: number,
  truncated: { value: boolean },
): void {
  for (let i = 0; i < children.length; i++) {
    if (lines.length >= MAX_TREE_LINES) {
      truncated.value = true;
      return;
    }

    const child = children[i]!;
    const isLast = i === children.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const fileCountLabel = `(${child.fileCount} file${child.fileCount === 1 ? '' : 's'})`;
    lines.push(`${prefix}${connector}${child.name}/ ${fileCountLabel}`);

    if (child.children.length > 0) {
      if (depth >= MAX_TREE_DEPTH) {
        // Summarize deeper levels instead of recursing
        const subfolderCount = countSubfolders(child);
        if (subfolderCount > 0) {
          const summaryPrefix = prefix + (isLast ? '    ' : '│   ');
          lines.push(`${summaryPrefix}└── ... (${subfolderCount} more subfolder${subfolderCount === 1 ? '' : 's'})`);
        }
      } else {
        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        renderChildren(child.children, childPrefix, lines, depth + 1, truncated);
      }
    }
  }
}

/** Count total subfolders recursively. */
function countSubfolders(node: FolderNode): number {
  let count = node.children.length;
  for (const child of node.children) {
    count += countSubfolders(child);
  }
  return count;
}

/**
 * Analyze the folder structure of a repository.
 * Builds a tree from index.files paths (no filesystem access).
 */
export function analyzeStructure(index: RepositoryIndex): StructureResult {
  const start = performance.now();

  const repoName = path.basename(index.root);
  const filePaths = index.files.map((f) => f.path);

  const tree = buildFolderTree(repoName, filePaths);
  sortTree(tree);

  const treeString = renderTree(tree);

  const durationMs = performance.now() - start;

  return {
    meta: {
      status: 'computed',
      durationMs,
    },
    tree,
    treeString,
  };
}
