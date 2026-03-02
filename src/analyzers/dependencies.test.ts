import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { analyzeDependencies } from './dependencies.js';
import { buildRepositoryIndex } from '../core/repo-index.js';
import type { AnalysisConfig } from '../core/types.js';

/**
 * Build a RepositoryIndex for the codebase_analysis project itself.
 * This is used as a real-world test fixture.
 */
async function buildTestIndex() {
  const root = path.resolve(__dirname, '../..');
  const config: AnalysisConfig = {
    root,
    format: 'markdown',
    outputPath: null,
    include: [],
    exclude: [],
    timeout: 60_000,
    offline: false,
    followSymlinks: false,
    maxFileSize: 1_048_576,
  };
  return buildRepositoryIndex(root, config);
}

describe('analyzeDependencies', () => {
  it('returns meta.status = computed', async () => {
    const index = await buildTestIndex();
    const result = await analyzeDependencies(index);

    expect(result.meta.status).toBe('computed');
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('detects npm ecosystem', async () => {
    const index = await buildTestIndex();
    const result = await analyzeDependencies(index);

    expect(result.ecosystems).toContain('npm');
  });

  it('finds direct dependencies (commander, yaml, web-tree-sitter)', async () => {
    const index = await buildTestIndex();
    const result = await analyzeDependencies(index);

    const directDeps = result.dependencies.filter((d) => d.type === 'direct');
    const names = directDeps.map((d) => d.name);

    expect(names).toContain('commander');
    expect(names).toContain('yaml');
    expect(names).toContain('web-tree-sitter');
  });

  it('finds devDependencies (typescript, vitest)', async () => {
    const index = await buildTestIndex();
    const result = await analyzeDependencies(index);

    const devDeps = result.dependencies.filter((d) => d.type === 'dev');
    const names = devDeps.map((d) => d.name);

    expect(names).toContain('typescript');
    expect(names).toContain('vitest');
  });

  it('totalDependencies equals the sum of all types', async () => {
    const index = await buildTestIndex();
    const result = await analyzeDependencies(index);

    const directCount = result.dependencies.filter((d) => d.type === 'direct').length;
    const devCount = result.dependencies.filter((d) => d.type === 'dev').length;
    const peerCount = result.dependencies.filter((d) => d.type === 'peer').length;
    const optionalCount = result.dependencies.filter((d) => d.type === 'optional').length;

    expect(result.totalDependencies).toBe(directCount + devCount + peerCount + optionalCount);
  });

  it('directDependencies and devDependencies counts match filtered arrays', async () => {
    const index = await buildTestIndex();
    const result = await analyzeDependencies(index);

    const directCount = result.dependencies.filter((d) => d.type === 'direct').length;
    const devCount = result.dependencies.filter((d) => d.type === 'dev').length;

    expect(result.directDependencies).toBe(directCount);
    expect(result.devDependencies).toBe(devCount);
  });

  it('detects bun as the package manager', async () => {
    const index = await buildTestIndex();
    const result = await analyzeDependencies(index);

    expect(result.packageManager).toBe('bun');
  });

  it('every dependency has a name and version', async () => {
    const index = await buildTestIndex();
    const result = await analyzeDependencies(index);

    expect(result.dependencies.length).toBeGreaterThan(0);

    for (const dep of result.dependencies) {
      expect(typeof dep.name).toBe('string');
      expect(dep.name.length).toBeGreaterThan(0);
      expect(typeof dep.version).toBe('string');
      expect(dep.version.length).toBeGreaterThan(0);
    }
  });

  it('every dependency has ecosystem = npm for this project', async () => {
    const index = await buildTestIndex();
    const result = await analyzeDependencies(index);

    for (const dep of result.dependencies) {
      expect(dep.ecosystem).toBe('npm');
    }
  });

  it('every dependency has a valid type', async () => {
    const index = await buildTestIndex();
    const result = await analyzeDependencies(index);

    const validTypes = new Set(['direct', 'dev', 'peer', 'optional']);
    for (const dep of result.dependencies) {
      expect(validTypes.has(dep.type)).toBe(true);
    }
  });

  it('totalDependencies > 0 for a project with package.json', async () => {
    const index = await buildTestIndex();
    const result = await analyzeDependencies(index);

    expect(result.totalDependencies).toBeGreaterThan(0);
    expect(result.directDependencies).toBeGreaterThan(0);
    expect(result.devDependencies).toBeGreaterThan(0);
  });
});
