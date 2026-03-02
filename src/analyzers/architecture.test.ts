/**
 * Tests for the architecture analyzer.
 *
 * Two test suites:
 * 1. Unit tests using synthetic source strings to verify import extraction.
 * 2. Integration tests running against the codebase_analysis project itself.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import { analyzeArchitecture, extractImports } from './architecture.js';
import { buildRepositoryIndex } from '../core/repo-index.js';
import { initTreeSitter } from '../utils/tree-sitter.js';
import type { AnalysisConfig } from '../core/types.js';

beforeAll(async () => {
  await initTreeSitter();
});

// ── Helper ──────────────────────────────────────────────────────────

/**
 * Build a RepositoryIndex for the codebase_analysis project itself.
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

// ── Unit Tests: extractImports ──────────────────────────────────────

describe('extractImports', () => {
  describe('TypeScript / JavaScript', () => {
    it('extracts a named import from a relative path', async () => {
      const source = `import { foo } from './bar.js';`;
      const imports = await extractImports(source, 'typescript', 'src/test.ts');

      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('./bar.js');
      expect(imports[0]!.isRelative).toBe(true);
    });

    it('extracts a namespace import from a node built-in', async () => {
      const source = `import * as fs from 'node:fs';`;
      const imports = await extractImports(source, 'typescript', 'src/test.ts');

      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('node:fs');
      expect(imports[0]!.isRelative).toBe(false);
    });

    it('extracts a default import', async () => {
      const source = `import Parser from 'web-tree-sitter';`;
      const imports = await extractImports(source, 'typescript', 'src/test.ts');

      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('web-tree-sitter');
      expect(imports[0]!.isRelative).toBe(false);
    });

    it('extracts multiple imports from the same file', async () => {
      const source = `
import { a } from './module-a.js';
import { b } from '../shared/module-b.js';
import { c } from 'external-package';
`;
      const imports = await extractImports(source, 'typescript', 'src/test.ts');

      expect(imports).toHaveLength(3);
      expect(imports[0]!.specifier).toBe('./module-a.js');
      expect(imports[0]!.isRelative).toBe(true);
      expect(imports[1]!.specifier).toBe('../shared/module-b.js');
      expect(imports[1]!.isRelative).toBe(true);
      expect(imports[2]!.specifier).toBe('external-package');
      expect(imports[2]!.isRelative).toBe(false);
    });

    it('extracts type-only imports', async () => {
      const source = `import type { Foo } from './types.js';`;
      const imports = await extractImports(source, 'typescript', 'src/test.ts');

      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('./types.js');
      expect(imports[0]!.isRelative).toBe(true);
    });

    it('extracts require() calls', async () => {
      const source = `const path = require('node:path');`;
      const imports = await extractImports(source, 'javascript', 'src/test.js');

      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('node:path');
      expect(imports[0]!.isRelative).toBe(false);
    });

    it('extracts relative require() calls', async () => {
      const source = `const helper = require('./helper');`;
      const imports = await extractImports(source, 'javascript', 'src/test.js');

      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('./helper');
      expect(imports[0]!.isRelative).toBe(true);
    });

    it('returns empty array for files with no imports', async () => {
      const source = `const x = 42;\nconsole.log(x);\n`;
      const imports = await extractImports(source, 'typescript', 'src/test.ts');

      expect(imports).toHaveLength(0);
    });
  });

  describe('Python', () => {
    it('extracts a relative from-import', async () => {
      const source = `from .module import something`;
      const imports = await extractImports(source, 'python', 'pkg/test.py');

      expect(imports).toHaveLength(1);
      expect(imports[0]!.isRelative).toBe(true);
    });

    it('extracts an absolute from-import', async () => {
      const source = `from os.path import join`;
      const imports = await extractImports(source, 'python', 'pkg/test.py');

      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('os.path');
      expect(imports[0]!.isRelative).toBe(false);
    });

    it('extracts a bare import', async () => {
      const source = `import json`;
      const imports = await extractImports(source, 'python', 'test.py');

      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('json');
      expect(imports[0]!.isRelative).toBe(false);
    });
  });

  describe('Go', () => {
    it('extracts imports from an import declaration', async () => {
      const source = `
package main

import (
  "fmt"
  "os"
)
`;
      const imports = await extractImports(source, 'go', 'main.go');

      expect(imports).toHaveLength(2);
      expect(imports[0]!.specifier).toBe('fmt');
      expect(imports[1]!.specifier).toBe('os');
      // Go imports are always treated as external
      expect(imports[0]!.isRelative).toBe(false);
      expect(imports[1]!.isRelative).toBe(false);
    });

    it('extracts a single-line import', async () => {
      const source = `
package main

import "fmt"
`;
      const imports = await extractImports(source, 'go', 'main.go');

      expect(imports).toHaveLength(1);
      expect(imports[0]!.specifier).toBe('fmt');
    });
  });
});

// ── Integration Tests: analyzeArchitecture ──────────────────────────

describe('analyzeArchitecture (integration)', () => {
  it('returns computed status', async () => {
    const index = await buildTestIndex();
    const result = await analyzeArchitecture(index);

    expect(result.meta.status).toBe('computed');
    expect(result.meta.durationMs).toBeGreaterThan(0);
  });

  it('finds totalImports > 0 (project has many imports)', async () => {
    const index = await buildTestIndex();
    const result = await analyzeArchitecture(index);

    expect(result.totalImports).toBeGreaterThan(0);
  });

  it('finds uniqueModules > 0', async () => {
    const index = await buildTestIndex();
    const result = await analyzeArchitecture(index);

    expect(result.uniqueModules).toBeGreaterThan(0);
  });

  it('importGraph has entries with from/to as relative paths', async () => {
    const index = await buildTestIndex();
    const result = await analyzeArchitecture(index);

    expect(result.importGraph.length).toBeGreaterThan(0);

    for (const edge of result.importGraph) {
      expect(typeof edge.from).toBe('string');
      expect(typeof edge.to).toBe('string');
      // Relative paths should not start with /
      expect(edge.from.startsWith('/')).toBe(false);
      expect(edge.to.startsWith('/')).toBe(false);
      // Should have file extensions
      expect(edge.from).toMatch(/\.\w+$/);
      expect(edge.to).toMatch(/\.\w+$/);
    }
  });

  it('circularDependencies is an array (may be empty)', async () => {
    const index = await buildTestIndex();
    const result = await analyzeArchitecture(index);

    expect(Array.isArray(result.circularDependencies)).toBe(true);

    // Each circular dependency should have a cycle array with >1 element
    for (const cd of result.circularDependencies) {
      expect(Array.isArray(cd.cycle)).toBe(true);
      expect(cd.cycle.length).toBeGreaterThan(1);
    }
  });

  it('moduleCohesion has entries for core, analyzers, utils modules', async () => {
    const index = await buildTestIndex();
    const result = await analyzeArchitecture(index);

    const moduleNames = result.moduleCohesion.map((m) => m.module);

    expect(moduleNames).toContain('core');
    expect(moduleNames).toContain('analyzers');
    expect(moduleNames).toContain('utils');
  });

  it('cohesionRatio is between 0 and 1 for each module', async () => {
    const index = await buildTestIndex();
    const result = await analyzeArchitecture(index);

    for (const mc of result.moduleCohesion) {
      expect(mc.cohesionRatio).toBeGreaterThanOrEqual(0);
      expect(mc.cohesionRatio).toBeLessThanOrEqual(1);
      expect(mc.intraImports).toBeLessThanOrEqual(mc.totalImports);
    }
  });

  it('has no self-imports (from !== to in edges)', async () => {
    const index = await buildTestIndex();
    const result = await analyzeArchitecture(index);

    for (const edge of result.importGraph) {
      expect(edge.from).not.toBe(edge.to);
    }
  });

  it('has no duplicate edges', async () => {
    const index = await buildTestIndex();
    const result = await analyzeArchitecture(index);

    const edgeKeys = result.importGraph.map((e) => `${e.from}\0${e.to}`);
    const uniqueKeys = new Set(edgeKeys);
    expect(uniqueKeys.size).toBe(edgeKeys.length);
  });
});
