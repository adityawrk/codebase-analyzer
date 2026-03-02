import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { buildRepositoryIndex } from './repo-index.js';
import type { AnalysisConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

function makeConfig(root: string): AnalysisConfig {
  return { ...DEFAULT_CONFIG, root };
}

describe('buildRepositoryIndex', () => {
  it('builds an index for the current project', async () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const index = await buildRepositoryIndex(root, makeConfig(root));

    expect(index.root).toBe(root);
    expect(index.files.length).toBeGreaterThan(0);
    expect(index.gitMeta.isRepo).toBe(true);

    // Should have some TypeScript files
    const tsFiles = index.filesByLanguage.get('TypeScript');
    expect(tsFiles).toBeDefined();
    expect(tsFiles!.length).toBeGreaterThan(0);

    // Should detect package.json
    const npmManifest = index.manifests.find((m) => m.type === 'npm');
    expect(npmManifest).toBeDefined();
  });

  it('groups files by language correctly', async () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const index = await buildRepositoryIndex(root, makeConfig(root));

    // Every file should appear in exactly one language group
    let totalInGroups = 0;
    for (const [, files] of index.filesByLanguage) {
      totalInGroups += files.length;
    }
    const nonBinaryFiles = index.files.filter((f) => !f.isBinary);
    expect(totalInGroups).toBe(nonBinaryFiles.length);
  });

  it('marks test files correctly', async () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const index = await buildRepositoryIndex(root, makeConfig(root));

    const testFiles = index.files.filter((f) => f.isTest);
    expect(testFiles.length).toBeGreaterThan(0);

    // All test files should match one of the isTestFile patterns
    for (const f of testFiles) {
      const basename = f.path.split('/').pop() ?? '';
      const normalized = f.path.replace(/\\/g, '/');
      const isTest =
        normalized.includes('.test.') ||
        normalized.includes('.spec.') ||
        normalized.includes('_test.') ||
        normalized.includes('_spec.') ||
        normalized.includes('__tests__') ||
        normalized.includes('/test/') ||
        normalized.includes('/tests/') ||
        normalized.includes('/spec/') ||
        normalized.startsWith('spec/') ||
        normalized.startsWith('test/') ||
        normalized.startsWith('tests/') ||
        basename === 'conftest.py' ||
        basename.startsWith('test_');
      expect(isTest, `Expected ${f.path} to match a test pattern`).toBe(true);
    }
  });
});
