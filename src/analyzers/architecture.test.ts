/**
 * Tests for the architecture analyzer.
 *
 * Two test suites:
 * 1. Unit tests using synthetic source strings to verify import extraction.
 * 2. Integration tests running against the codebase_analysis project itself.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import { analyzeArchitecture, extractImports, parseGoModulePath } from './architecture.js';
import { buildRepositoryIndex } from '../core/repo-index.js';
import { initTreeSitter } from '../utils/tree-sitter.js';
import type { AnalysisConfig, RepositoryIndex, FileEntry, ManifestEntry, GitMeta } from '../core/types.js';
import { SKIP_NON_VITEST } from '../test-utils.js';

beforeAll(async () => {
  if (process.env.VITEST === 'true') {
    await initTreeSitter();
  }
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

describe.skipIf(SKIP_NON_VITEST)('extractImports', () => {
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

// ── Unit Tests: parseGoModulePath ────────────────────────────────────

describe('parseGoModulePath', () => {
  it('parses a standard go.mod module directive', () => {
    const content = `module github.com/user/project\n\ngo 1.21\n`;
    expect(parseGoModulePath(content)).toBe('github.com/user/project');
  });

  it('parses module path with sub-path', () => {
    const content = `module github.com/org/repo/v2\n\ngo 1.22\n`;
    expect(parseGoModulePath(content)).toBe('github.com/org/repo/v2');
  });

  it('returns null for empty content', () => {
    expect(parseGoModulePath('')).toBeNull();
  });

  it('returns null for content without module directive', () => {
    const content = `go 1.21\nrequire (\n\tgithub.com/foo/bar v1.0.0\n)\n`;
    expect(parseGoModulePath(content)).toBeNull();
  });

  it('handles leading whitespace before module directive', () => {
    const content = `  module example.com/mymod\n`;
    expect(parseGoModulePath(content)).toBe('example.com/mymod');
  });
});

// ── Synthetic Integration Tests: Go internal imports ────────────────

describe.skipIf(SKIP_NON_VITEST)('analyzeArchitecture — Go internal imports', () => {
  /**
   * Build a minimal synthetic RepositoryIndex that simulates a Go project.
   */
  function buildGoIndex(
    goModContent: string,
    goFiles: { path: string; content: string }[],
  ): { index: RepositoryIndex; fileContents: Map<string, string> } {
    const files: FileEntry[] = [
      {
        path: 'go.mod',
        language: 'unknown',
        extension: '.mod',
        size: goModContent.length,
        isTest: false,
        isBinary: false,
      },
      ...goFiles.map((f) => ({
        path: f.path,
        language: 'Go',
        extension: '.go',
        size: f.content.length,
        isTest: false,
        isBinary: false,
      })),
    ];

    const manifests: ManifestEntry[] = [{ type: 'go' as const, path: 'go.mod' }];

    const fileContents = new Map<string, string>();
    fileContents.set('go.mod', goModContent);
    for (const f of goFiles) {
      fileContents.set(f.path, f.content);
    }

    const gitMeta: GitMeta = {
      isRepo: false,
      remotes: [],
      headCommit: null,
      defaultBranch: null,
      totalCommits: null,
      firstCommitDate: null,
      lastCommitDate: null,
    };

    const index: RepositoryIndex = {
      root: '/fake/go-project',
      files,
      filesByLanguage: new Map([['Go', files.filter((f) => f.extension === '.go')]]),
      filesByExtension: new Map([
        ['.go', files.filter((f) => f.extension === '.go')],
        ['.mod', files.filter((f) => f.extension === '.mod')],
      ]),
      manifests,
      gitMeta,
      config: {
        root: '/fake/go-project',
        format: 'markdown',
        outputPath: null,
        include: [],
        exclude: [],
        timeout: 60_000,
        offline: false,
        followSymlinks: false,
        maxFileSize: 1_048_576,
      },
    };

    return { index, fileContents };
  }

  it('resolves Go internal imports using the module path from go.mod', async () => {
    const goModContent = `module github.com/user/myproject\n\ngo 1.21\n`;
    const mainGo = `package main

import (
  "fmt"
  "github.com/user/myproject/internal/db"
)

func main() {
  fmt.Println("hello")
  db.Connect()
}
`;
    const dbGo = `package db

func Connect() {}
`;

    const { index, fileContents } = buildGoIndex(goModContent, [
      { path: 'main.go', content: mainGo },
      { path: 'internal/db/db.go', content: dbGo },
    ]);

    // Monkey-patch fs.readFile for this test by using analyzeArchitecture with a
    // modified index that has a real temp directory. Instead, we test the exported
    // parseGoModulePath and extractImports directly, then verify the resolution logic.
    const imports = await extractImports(mainGo, 'go', 'main.go');

    expect(imports).toHaveLength(2);
    // "fmt" is stdlib, "github.com/user/myproject/internal/db" is internal
    const fmtImport = imports.find((i) => i.specifier === 'fmt');
    const dbImport = imports.find((i) => i.specifier === 'github.com/user/myproject/internal/db');

    expect(fmtImport).toBeDefined();
    expect(dbImport).toBeDefined();
    // Both are non-relative (Go imports are always absolute paths)
    expect(fmtImport!.isRelative).toBe(false);
    expect(dbImport!.isRelative).toBe(false);

    // Verify the module path parsing
    const modulePath = parseGoModulePath(goModContent);
    expect(modulePath).toBe('github.com/user/myproject');

    // Verify internal import starts with module path
    expect(dbImport!.specifier.startsWith(modulePath!)).toBe(true);
  });

  it('correctly distinguishes internal vs external Go imports', async () => {
    const source = `package main

import (
  "fmt"
  "github.com/user/myproject/pkg/utils"
  "github.com/external/library"
)
`;
    const imports = await extractImports(source, 'go', 'cmd/main.go');
    const modulePath = 'github.com/user/myproject';

    const internal = imports.filter((i) => i.specifier.startsWith(modulePath));
    const external = imports.filter((i) => !i.specifier.startsWith(modulePath));

    expect(internal).toHaveLength(1);
    expect(internal[0]!.specifier).toBe('github.com/user/myproject/pkg/utils');
    expect(external).toHaveLength(2); // "fmt" and "github.com/external/library"
  });
});

// ── Synthetic Integration Tests: Python relative imports ────────────

describe.skipIf(SKIP_NON_VITEST)('analyzeArchitecture — Python relative imports', () => {
  it('extracts relative import specifiers correctly from Python', async () => {
    const source = `from .utils import helper
from ..models import User
from . import config
`;
    const imports = await extractImports(source, 'python', 'src/pkg/main.py');

    expect(imports).toHaveLength(3);

    // .utils → relative
    expect(imports[0]!.isRelative).toBe(true);
    expect(imports[0]!.specifier).toMatch(/^\.utils/);

    // ..models → relative
    expect(imports[1]!.isRelative).toBe(true);
    expect(imports[1]!.specifier).toMatch(/^\.\.models/);

    // . → relative (bare package import)
    expect(imports[2]!.isRelative).toBe(true);
  });

  it('handles single-dot relative import (.module)', async () => {
    const source = `from .utils import helper`;
    const imports = await extractImports(source, 'python', 'src/pkg/main.py');

    expect(imports).toHaveLength(1);
    expect(imports[0]!.isRelative).toBe(true);
    // The specifier includes the dot prefix
    expect(imports[0]!.specifier).toContain('utils');
  });

  it('handles double-dot relative import (..module)', async () => {
    const source = `from ..utils import helper`;
    const imports = await extractImports(source, 'python', 'src/pkg/sub/main.py');

    expect(imports).toHaveLength(1);
    expect(imports[0]!.isRelative).toBe(true);
  });

  it('handles triple-dot relative import (...module)', async () => {
    const source = `from ...core import base`;
    const imports = await extractImports(source, 'python', 'src/a/b/c.py');

    expect(imports).toHaveLength(1);
    expect(imports[0]!.isRelative).toBe(true);
  });

  it('handles dotted module segments in relative import (.utils.helper)', async () => {
    const source = `from .utils.helper import do_thing`;
    const imports = await extractImports(source, 'python', 'src/pkg/main.py');

    expect(imports).toHaveLength(1);
    expect(imports[0]!.isRelative).toBe(true);
  });
});

// ── Full Resolution Tests via analyzeArchitecture with temp files ────

describe.skipIf(SKIP_NON_VITEST)('analyzeArchitecture — Go + Python resolution (filesystem)', () => {
  const os = require('node:os');
  const fsSync = require('node:fs');
  const fsp = require('node:fs/promises');

  async function createTempProject(
    files: Record<string, string>,
  ): Promise<string> {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'arch-test-'));
    for (const [filePath, content] of Object.entries(files)) {
      const absPath = path.join(tmpDir, filePath);
      await fsp.mkdir(path.dirname(absPath), { recursive: true });
      await fsp.writeFile(absPath, content, 'utf-8');
    }
    return tmpDir;
  }

  async function buildIndexForTempDir(tmpDir: string): Promise<RepositoryIndex> {
    const config: AnalysisConfig = {
      root: tmpDir,
      format: 'markdown',
      outputPath: null,
      include: [],
      exclude: [],
      timeout: 60_000,
      offline: false,
      followSymlinks: false,
      maxFileSize: 1_048_576,
    };
    return buildRepositoryIndex(tmpDir, config);
  }

  it('resolves Go internal imports to actual files via go.mod module path', async () => {
    const tmpDir = await createTempProject({
      'go.mod': 'module github.com/testuser/myapp\n\ngo 1.21\n',
      'main.go': `package main

import (
  "fmt"
  "github.com/testuser/myapp/internal/db"
)

func main() {
  fmt.Println("hello")
  db.Init()
}
`,
      'internal/db/db.go': `package db

func Init() {}
`,
    });

    try {
      const index = await buildIndexForTempDir(tmpDir);
      const result = await analyzeArchitecture(index);

      // Should have at least one import edge (main.go → internal/db/db.go)
      const goEdges = result.importGraph.filter(
        (e) => e.from.endsWith('.go') && e.to.endsWith('.go'),
      );
      expect(goEdges.length).toBeGreaterThanOrEqual(1);

      const dbEdge = goEdges.find(
        (e) => e.from === 'main.go' && e.to === 'internal/db/db.go',
      );
      expect(dbEdge).toBeDefined();
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('does NOT resolve external Go imports to edges', async () => {
    const tmpDir = await createTempProject({
      'go.mod': 'module github.com/testuser/myapp\n\ngo 1.21\n',
      'main.go': `package main

import (
  "fmt"
  "github.com/external/library"
)

func main() {}
`,
    });

    try {
      const index = await buildIndexForTempDir(tmpDir);
      const result = await analyzeArchitecture(index);

      // No edges — "fmt" is stdlib and "github.com/external/library" is external
      const goEdges = result.importGraph.filter(
        (e) => e.from.endsWith('.go'),
      );
      expect(goEdges).toHaveLength(0);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolves Python single-dot relative import (.utils) to a .py file', async () => {
    const tmpDir = await createTempProject({
      'src/pkg/__init__.py': '',
      'src/pkg/main.py': `from .utils import helper\n`,
      'src/pkg/utils.py': `def helper(): pass\n`,
    });

    try {
      const index = await buildIndexForTempDir(tmpDir);
      const result = await analyzeArchitecture(index);

      const pyEdges = result.importGraph.filter(
        (e) => e.from.endsWith('.py') && e.to.endsWith('.py'),
      );
      expect(pyEdges.length).toBeGreaterThanOrEqual(1);

      const utilsEdge = pyEdges.find(
        (e) => e.from === 'src/pkg/main.py' && e.to === 'src/pkg/utils.py',
      );
      expect(utilsEdge).toBeDefined();
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolves Python double-dot relative import (..models) to parent dir', async () => {
    const tmpDir = await createTempProject({
      'src/__init__.py': '',
      'src/models.py': `class User: pass\n`,
      'src/pkg/__init__.py': '',
      'src/pkg/main.py': `from ..models import User\n`,
    });

    try {
      const index = await buildIndexForTempDir(tmpDir);
      const result = await analyzeArchitecture(index);

      const pyEdges = result.importGraph.filter(
        (e) => e.from.endsWith('.py') && e.to.endsWith('.py'),
      );

      const modelsEdge = pyEdges.find(
        (e) => e.from === 'src/pkg/main.py' && e.to === 'src/models.py',
      );
      expect(modelsEdge).toBeDefined();
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolves Python relative import to __init__.py for package dirs', async () => {
    const tmpDir = await createTempProject({
      'src/pkg/__init__.py': '',
      'src/pkg/sub/__init__.py': 'from .core import Base\n',
      'src/pkg/sub/core/__init__.py': 'class Base: pass\n',
    });

    try {
      const index = await buildIndexForTempDir(tmpDir);
      const result = await analyzeArchitecture(index);

      const pyEdges = result.importGraph.filter(
        (e) => e.from.endsWith('.py') && e.to.endsWith('.py'),
      );

      const coreEdge = pyEdges.find(
        (e) =>
          e.from === 'src/pkg/sub/__init__.py' &&
          e.to === 'src/pkg/sub/core/__init__.py',
      );
      expect(coreEdge).toBeDefined();
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolves bare relative import (from . import x) to __init__.py', async () => {
    const tmpDir = await createTempProject({
      'src/pkg/__init__.py': 'VERSION = "1.0"\n',
      'src/pkg/main.py': `from . import VERSION\n`,
    });

    try {
      const index = await buildIndexForTempDir(tmpDir);
      const result = await analyzeArchitecture(index);

      const pyEdges = result.importGraph.filter(
        (e) => e.from.endsWith('.py') && e.to.endsWith('.py'),
      );

      const initEdge = pyEdges.find(
        (e) =>
          e.from === 'src/pkg/main.py' && e.to === 'src/pkg/__init__.py',
      );
      expect(initEdge).toBeDefined();
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Integration Tests: analyzeArchitecture ──────────────────────────

describe.skipIf(SKIP_NON_VITEST)('analyzeArchitecture (integration)', () => {
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
