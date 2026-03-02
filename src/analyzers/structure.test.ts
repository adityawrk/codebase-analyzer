import { describe, it, expect } from 'vitest';
import { analyzeStructure } from './structure.js';
import type { RepositoryIndex, AnalysisConfig, FileEntry, GitMeta } from '../core/types.js';
import { DEFAULT_CONFIG } from '../core/types.js';

/** Create a minimal FileEntry from just a path. */
function file(filePath: string): FileEntry {
  return {
    path: filePath,
    language: 'TypeScript',
    extension: '.ts',
    size: 100,
    isTest: false,
    isBinary: false,
  };
}

/** Create a mock RepositoryIndex with the given file paths. */
function mockIndex(root: string, paths: string[]): RepositoryIndex {
  const files = paths.map(file);
  const config: AnalysisConfig = { ...DEFAULT_CONFIG, root };
  const gitMeta: GitMeta = {
    isRepo: false,
    remotes: [],
    headCommit: null,
    defaultBranch: null,
    totalCommits: null,
    firstCommitDate: null,
    lastCommitDate: null,
  };
  return {
    root,
    files,
    filesByLanguage: new Map(),
    filesByExtension: new Map(),
    manifests: [],
    gitMeta,
    config,
  };
}

describe('analyzeStructure', () => {
  it('builds correct tree from known paths', async () => {
    const index = mockIndex('/repo/my-project', [
      'src/index.ts',
      'src/utils/helpers.ts',
      'src/utils/format.ts',
      'src/components/App.tsx',
      'src/components/Header.tsx',
      'src/components/Footer.tsx',
      'README.md',
      'package.json',
    ]);

    const result = await analyzeStructure(index);

    expect(result.meta.status).toBe('computed');
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);

    // Root node
    expect(result.tree.name).toBe('my-project');
    expect(result.tree.fileCount).toBe(2); // README.md, package.json

    // src/ folder
    const src = result.tree.children.find((c) => c.name === 'src');
    expect(src).toBeDefined();
    expect(src!.fileCount).toBe(1); // index.ts
    expect(src!.children).toHaveLength(2); // components, utils

    // src/components/
    const components = src!.children.find((c) => c.name === 'components');
    expect(components).toBeDefined();
    expect(components!.fileCount).toBe(3);
    expect(components!.children).toHaveLength(0);

    // src/utils/
    const utils = src!.children.find((c) => c.name === 'utils');
    expect(utils).toBeDefined();
    expect(utils!.fileCount).toBe(2);
    expect(utils!.children).toHaveLength(0);
  });

  it('produces correctly formatted tree string', async () => {
    const index = mockIndex('/repo/my-project', [
      'src/index.ts',
      'src/utils/helpers.ts',
      'src/components/App.tsx',
      'docs/guide.md',
      'README.md',
    ]);

    const result = await analyzeStructure(index);
    const lines = result.treeString.split('\n');

    // First line is the repo name
    expect(lines[0]).toBe('my-project/');

    // docs/ comes before src/ (alphabetical)
    const docsLine = lines.findIndex((l) => l.includes('docs/'));
    const srcLine = lines.findIndex((l) => l.includes('src/'));
    expect(docsLine).toBeLessThan(srcLine);

    // docs/ uses ├── (not last)
    expect(lines[docsLine]).toMatch(/^├── docs\/ \(1 file\)$/);

    // src/ uses └── (last top-level folder)
    expect(lines[srcLine]).toMatch(/^└── src\/ \(1 file\)$/);

    // components and utils are children of src
    const componentsLine = lines.findIndex((l) => l.includes('components/'));
    const utilsLine = lines.findIndex((l) => l.includes('utils/'));
    expect(componentsLine).toBeGreaterThan(srcLine);
    expect(utilsLine).toBeGreaterThan(srcLine);

    // components uses │   ├── (not last child of src, src is last top-level)
    expect(lines[componentsLine]).toMatch(/^ {4}├── components\/ \(1 file\)$/);

    // utils uses │   └── (last child of src, src is last top-level)
    expect(lines[utilsLine]).toMatch(/^ {4}└── utils\/ \(1 file\)$/);
  });

  it('shows correct tree connectors for nested folders', async () => {
    const index = mockIndex('/repo/test-repo', [
      'a/b/c/file.ts',
      'a/b/other.ts',
      'a/x/file.ts',
      'z/file.ts',
    ]);

    const result = await analyzeStructure(index);
    const lines = result.treeString.split('\n');

    // Expected output:
    // test-repo/
    // ├── a/ (0 files)
    // │   ├── b/ (1 file)
    // │   │   └── c/ (1 file)
    // │   └── x/ (1 file)
    // └── z/ (1 file)

    expect(lines[0]).toBe('test-repo/');
    expect(lines[1]).toBe('├── a/ (0 files)');
    expect(lines[2]).toBe('│   ├── b/ (1 file)');
    expect(lines[3]).toBe('│   │   └── c/ (1 file)');
    expect(lines[4]).toBe('│   └── x/ (1 file)');
    expect(lines[5]).toBe('└── z/ (1 file)');
    expect(lines).toHaveLength(6);
  });

  it('handles empty file list', async () => {
    const index = mockIndex('/repo/empty-project', []);

    const result = await analyzeStructure(index);

    expect(result.meta.status).toBe('computed');
    expect(result.tree.name).toBe('empty-project');
    expect(result.tree.fileCount).toBe(0);
    expect(result.tree.children).toHaveLength(0);

    // Tree string is just the root folder
    expect(result.treeString).toBe('empty-project/');
  });

  it('handles all files in root (no subdirectories)', async () => {
    const index = mockIndex('/repo/flat-project', [
      'index.ts',
      'README.md',
      'package.json',
      'tsconfig.json',
    ]);

    const result = await analyzeStructure(index);

    expect(result.tree.name).toBe('flat-project');
    expect(result.tree.fileCount).toBe(4);
    expect(result.tree.children).toHaveLength(0);

    // Tree string is just the root folder — no subdirectories to show
    expect(result.treeString).toBe('flat-project/');
  });

  it('counts files per folder correctly (direct only, not recursive)', async () => {
    const index = mockIndex('/repo/counter', [
      'root1.ts',
      'root2.ts',
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
      'src/lib/x.ts',
      'src/lib/y.ts',
      'src/lib/deep/z.ts',
    ]);

    const result = await analyzeStructure(index);

    // Root has 2 direct files
    expect(result.tree.fileCount).toBe(2);

    // src/ has 3 direct files
    const src = result.tree.children.find((c) => c.name === 'src');
    expect(src).toBeDefined();
    expect(src!.fileCount).toBe(3);

    // src/lib/ has 2 direct files
    const lib = src!.children.find((c) => c.name === 'lib');
    expect(lib).toBeDefined();
    expect(lib!.fileCount).toBe(2);

    // src/lib/deep/ has 1 direct file
    const deep = lib!.children.find((c) => c.name === 'deep');
    expect(deep).toBeDefined();
    expect(deep!.fileCount).toBe(1);
  });

  it('sorts folders alphabetically at each level', async () => {
    const index = mockIndex('/repo/sorted', [
      'zebra/file.ts',
      'alpha/file.ts',
      'middle/file.ts',
      'src/zoo/file.ts',
      'src/app/file.ts',
      'src/core/file.ts',
    ]);

    const result = await analyzeStructure(index);

    // Top-level folders should be sorted
    const topNames = result.tree.children.map((c) => c.name);
    expect(topNames).toEqual(['alpha', 'middle', 'src', 'zebra']);

    // src/ children should be sorted
    const src = result.tree.children.find((c) => c.name === 'src');
    const srcChildNames = src!.children.map((c) => c.name);
    expect(srcChildNames).toEqual(['app', 'core', 'zoo']);
  });

  it('handles dot-prefixed folders', async () => {
    const index = mockIndex('/repo/dotfiles', [
      '.github/workflows/ci.yml',
      '.github/CODEOWNERS',
      '.husky/pre-commit',
      'src/index.ts',
    ]);

    const result = await analyzeStructure(index);

    const topNames = result.tree.children.map((c) => c.name);
    // Dot-prefixed folders sort before regular ones (by localeCompare)
    expect(topNames).toContain('.github');
    expect(topNames).toContain('.husky');
    expect(topNames).toContain('src');

    // .github should have 1 direct file and 1 child folder
    const github = result.tree.children.find((c) => c.name === '.github');
    expect(github).toBeDefined();
    expect(github!.fileCount).toBe(1); // CODEOWNERS
    expect(github!.children).toHaveLength(1); // workflows/
    expect(github!.children[0]!.name).toBe('workflows');
    expect(github!.children[0]!.fileCount).toBe(1); // ci.yml
  });

  it('uses singular "file" for count of 1', async () => {
    const index = mockIndex('/repo/singular', [
      'src/index.ts',
      'docs/a.md',
      'docs/b.md',
    ]);

    const result = await analyzeStructure(index);

    // src has 1 file -> "(1 file)" (singular)
    expect(result.treeString).toContain('src/ (1 file)');
    // docs has 2 files -> "(2 files)" (plural)
    expect(result.treeString).toContain('docs/ (2 files)');
  });
});
