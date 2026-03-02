/**
 * file-policy.test.ts — Tests for the canonical file include/exclude authority.
 *
 * Pure function tests (detectLanguage, isTestFile, isBinary) plus
 * integration-style tests using temp directories for buildFileList.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildFileList,
  CODE_EXTENSIONS,
  detectLanguage,
  isBinary,
  isTestFile,
} from './file-policy.js';
import type { AnalysisConfig } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<AnalysisConfig> = {}): AnalysisConfig {
  return {
    root: overrides.root ?? '/tmp/test-repo',
    format: 'markdown',
    outputPath: null,
    include: [],
    exclude: [],
    timeout: 10_000,
    offline: false,
    followSymlinks: false,
    maxFileSize: 1_048_576,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------

describe('detectLanguage', () => {
  it('maps TypeScript extensions', () => {
    expect(detectLanguage('.ts')).toBe('TypeScript');
    expect(detectLanguage('.tsx')).toBe('TSX');
  });

  it('maps JavaScript extensions', () => {
    expect(detectLanguage('.js')).toBe('JavaScript');
    expect(detectLanguage('.jsx')).toBe('JSX');
    expect(detectLanguage('.mjs')).toBe('JavaScript');
    expect(detectLanguage('.cjs')).toBe('JavaScript');
  });

  it('maps Python', () => {
    expect(detectLanguage('.py')).toBe('Python');
  });

  it('maps Go', () => {
    expect(detectLanguage('.go')).toBe('Go');
  });

  it('maps Rust', () => {
    expect(detectLanguage('.rs')).toBe('Rust');
  });

  it('maps Java and Kotlin', () => {
    expect(detectLanguage('.java')).toBe('Java');
    expect(detectLanguage('.kt')).toBe('Kotlin');
  });

  it('maps C family', () => {
    expect(detectLanguage('.c')).toBe('C');
    expect(detectLanguage('.cpp')).toBe('C++');
    expect(detectLanguage('.cc')).toBe('C++');
    expect(detectLanguage('.h')).toBe('C Header');
    expect(detectLanguage('.cs')).toBe('C#');
  });

  it('maps web languages', () => {
    expect(detectLanguage('.html')).toBe('HTML');
    expect(detectLanguage('.css')).toBe('CSS');
    expect(detectLanguage('.scss')).toBe('SCSS');
  });

  it('maps data formats', () => {
    expect(detectLanguage('.json')).toBe('JSON');
    expect(detectLanguage('.yaml')).toBe('YAML');
    expect(detectLanguage('.yml')).toBe('YAML');
    expect(detectLanguage('.toml')).toBe('TOML');
    expect(detectLanguage('.xml')).toBe('XML');
  });

  it('maps shell scripts', () => {
    expect(detectLanguage('.sh')).toBe('Shell');
    expect(detectLanguage('.bash')).toBe('Shell');
  });

  it('maps other languages', () => {
    expect(detectLanguage('.rb')).toBe('Ruby');
    expect(detectLanguage('.swift')).toBe('Swift');
    expect(detectLanguage('.php')).toBe('PHP');
    expect(detectLanguage('.dart')).toBe('Dart');
    expect(detectLanguage('.sql')).toBe('SQL');
    expect(detectLanguage('.graphql')).toBe('GraphQL');
    expect(detectLanguage('.md')).toBe('Markdown');
  });

  it('returns Other for unknown extensions', () => {
    expect(detectLanguage('.xyz')).toBe('Other');
    expect(detectLanguage('.unknown')).toBe('Other');
    expect(detectLanguage('')).toBe('Other');
  });

  it('is case-insensitive', () => {
    expect(detectLanguage('.TS')).toBe('TypeScript');
    expect(detectLanguage('.Py')).toBe('Python');
    expect(detectLanguage('.JSON')).toBe('JSON');
  });
});

// ---------------------------------------------------------------------------
// isTestFile
// ---------------------------------------------------------------------------

describe('isTestFile', () => {
  describe('extension-based patterns', () => {
    it('detects *.test.* files', () => {
      expect(isTestFile('src/utils.test.ts')).toBe(true);
      expect(isTestFile('lib/parser.test.js')).toBe(true);
      expect(isTestFile('app.test.tsx')).toBe(true);
    });

    it('detects *.spec.* files', () => {
      expect(isTestFile('src/utils.spec.ts')).toBe(true);
      expect(isTestFile('lib/parser.spec.js')).toBe(true);
    });

    it('detects *_test.* files', () => {
      expect(isTestFile('src/utils_test.go')).toBe(true);
      expect(isTestFile('pkg/handler_test.go')).toBe(true);
    });

    it('detects *_spec.* files', () => {
      expect(isTestFile('src/utils_spec.rb')).toBe(true);
    });
  });

  describe('directory-based patterns', () => {
    it('detects files in __tests__/', () => {
      expect(isTestFile('src/__tests__/utils.ts')).toBe(true);
      expect(isTestFile('__tests__/index.js')).toBe(true);
    });

    it('detects files in test/ directory', () => {
      expect(isTestFile('test/integration.ts')).toBe(true);
      expect(isTestFile('src/test/helper.ts')).toBe(true);
    });

    it('detects files in tests/ directory', () => {
      expect(isTestFile('tests/unit.ts')).toBe(true);
      expect(isTestFile('src/tests/fixture.ts')).toBe(true);
    });

    it('detects files in spec/ directory', () => {
      expect(isTestFile('spec/app.ts')).toBe(true);
      expect(isTestFile('src/spec/model.ts')).toBe(true);
    });
  });

  describe('Python-specific', () => {
    it('detects conftest.py', () => {
      expect(isTestFile('tests/conftest.py')).toBe(true);
      expect(isTestFile('conftest.py')).toBe(true);
    });

    it('detects test_*.py files', () => {
      expect(isTestFile('test_models.py')).toBe(true);
      expect(isTestFile('src/test_utils.py')).toBe(true);
    });
  });

  describe('non-test files', () => {
    it('does not flag regular source files', () => {
      expect(isTestFile('src/utils.ts')).toBe(false);
      expect(isTestFile('lib/parser.js')).toBe(false);
      expect(isTestFile('main.py')).toBe(false);
      expect(isTestFile('cmd/server.go')).toBe(false);
    });

    it('does not flag files with test in their name but not in pattern', () => {
      expect(isTestFile('src/testing-utils.ts')).toBe(false);
      expect(isTestFile('src/contest.py')).toBe(false);
    });

    it('does not flag non-code files in test directories', () => {
      expect(isTestFile('spec/metrics-v1.md')).toBe(false);
      expect(isTestFile('tests/fixtures/benchmark-manifest.json')).toBe(false);
      expect(isTestFile('tests/README.md')).toBe(false);
      expect(isTestFile('test/data.yaml')).toBe(false);
      expect(isTestFile('__tests__/snapshot.json')).toBe(false);
    });

    it('still flags code files in test directories', () => {
      expect(isTestFile('spec/app.spec.ts')).toBe(true);
      expect(isTestFile('tests/helper.ts')).toBe(true);
      expect(isTestFile('__tests__/util.py')).toBe(true);
    });
  });

  describe('path normalization', () => {
    it('handles backslash paths', () => {
      expect(isTestFile('src\\__tests__\\utils.ts')).toBe(true);
      expect(isTestFile('test\\helper.ts')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// isBinary
// ---------------------------------------------------------------------------

describe('isBinary', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-policy-binary-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns false for a plain text file', async () => {
    const filePath = path.join(tmpDir, 'text.txt');
    await fs.writeFile(filePath, 'Hello, world!\nLine two.\n');
    expect(await isBinary(filePath)).toBe(false);
  });

  it('returns true for a file containing null bytes', async () => {
    const filePath = path.join(tmpDir, 'binary.bin');
    const buf = Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f]); // "Hel\0o"
    await fs.writeFile(filePath, buf);
    expect(await isBinary(filePath)).toBe(true);
  });

  it('returns false for an empty file', async () => {
    const filePath = path.join(tmpDir, 'empty.txt');
    await fs.writeFile(filePath, '');
    expect(await isBinary(filePath)).toBe(false);
  });

  it('returns true for a file that cannot be read', async () => {
    expect(await isBinary('/nonexistent/path/file.bin')).toBe(true);
  });

  it('detects null byte at the very end of the 8KB window', async () => {
    const filePath = path.join(tmpDir, 'edge.bin');
    const buf = Buffer.alloc(8192, 0x41); // all 'A'
    buf[8191] = 0x00; // null byte at position 8191
    await fs.writeFile(filePath, buf);
    expect(await isBinary(filePath)).toBe(true);
  });

  it('returns false for a text file larger than 8KB (no null in first 8KB)', async () => {
    const filePath = path.join(tmpDir, 'large.txt');
    const text = 'A'.repeat(8192);
    const suffix = Buffer.from([0x00]); // null byte after 8KB
    await fs.writeFile(filePath, Buffer.concat([Buffer.from(text), suffix]));
    expect(await isBinary(filePath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildFileList — integration tests with temp directories
// ---------------------------------------------------------------------------

describe('buildFileList', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-policy-build-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeFile(relPath: string, content: string = '// source'): Promise<void> {
    const abs = path.join(tmpDir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }

  it('discovers files in a non-git directory', async () => {
    await writeFile('src/index.ts', 'const x = 1;');
    await writeFile('src/utils.ts', 'export function foo() {}');
    await writeFile('README.md', '# Hello');

    const config = makeConfig({ root: tmpDir });
    const files = await buildFileList(tmpDir, config);

    expect(files.length).toBe(3);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/utils.ts');
    expect(paths).toContain('README.md');
  });

  it('excludes node_modules by default', async () => {
    await writeFile('src/app.ts', 'const x = 1;');
    await writeFile('node_modules/pkg/index.js', 'module.exports = {}');

    const config = makeConfig({ root: tmpDir });
    const files = await buildFileList(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('node_modules/pkg/index.js');
    expect(paths).toContain('src/app.ts');
  });

  it('excludes .git directory by default', async () => {
    await writeFile('src/app.ts', 'const x = 1;');
    await writeFile('.git/HEAD', 'ref: refs/heads/main');

    const config = makeConfig({ root: tmpDir });
    const files = await buildFileList(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths.some((p) => p.startsWith('.git/'))).toBe(false);
    expect(paths).toContain('src/app.ts');
  });

  it('excludes vendor/ and dist/ by default', async () => {
    await writeFile('src/app.ts', 'const x = 1;');
    await writeFile('vendor/lib.go', 'package main');
    await writeFile('dist/bundle.js', 'var a = 1;');

    const config = makeConfig({ root: tmpDir });
    const files = await buildFileList(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('vendor/lib.go');
    expect(paths).not.toContain('dist/bundle.js');
    expect(paths).toContain('src/app.ts');
  });

  it('excludes __pycache__/, .next/, .nuxt/, build/ by default', async () => {
    await writeFile('src/app.py', 'print("hi")');
    await writeFile('__pycache__/app.cpython-311.pyc', 'binary stuff');
    await writeFile('.next/cache/data.json', '{}');
    await writeFile('.nuxt/dist/index.js', 'var x;');
    await writeFile('build/output.js', 'compiled;');

    const config = makeConfig({ root: tmpDir });
    const files = await buildFileList(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('__pycache__/app.cpython-311.pyc');
    expect(paths.some((p) => p.startsWith('.next/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.nuxt/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('build/'))).toBe(false);
    expect(paths).toContain('src/app.py');
  });

  it('excludes minified and map files by default', async () => {
    await writeFile('src/app.ts', 'const x = 1;');
    await writeFile('public/bundle.min.js', 'minified code');
    await writeFile('public/style.min.css', 'minified css');
    await writeFile('public/bundle.js.map', 'sourcemap');

    const config = makeConfig({ root: tmpDir });
    const files = await buildFileList(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('public/bundle.min.js');
    expect(paths).not.toContain('public/style.min.css');
    expect(paths).not.toContain('public/bundle.js.map');
    expect(paths).toContain('src/app.ts');
  });

  it('excludes package-lock.json and bun.lock by default', async () => {
    await writeFile('src/app.ts', 'const x = 1;');
    await writeFile('package-lock.json', '{}');
    await writeFile('bun.lock', 'lockfile content');

    const config = makeConfig({ root: tmpDir });
    const files = await buildFileList(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('package-lock.json');
    expect(paths).not.toContain('bun.lock');
  });

  it('excludes .lock extension files by default', async () => {
    await writeFile('src/app.ts', 'const x = 1;');
    await writeFile('yarn.lock', 'lock content');
    await writeFile('Cargo.lock', 'lock content');

    const config = makeConfig({ root: tmpDir });
    const files = await buildFileList(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('yarn.lock');
    expect(paths).not.toContain('Cargo.lock');
  });

  it('excludes files exceeding maxFileSize', async () => {
    await writeFile('src/small.ts', 'const x = 1;');
    // Create a file just over the limit
    const bigContent = 'x'.repeat(2_000_000); // 2MB
    await writeFile('src/huge.ts', bigContent);

    const config = makeConfig({ root: tmpDir, maxFileSize: 1_048_576 });
    const files = await buildFileList(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).toContain('src/small.ts');
    expect(paths).not.toContain('src/huge.ts');
  });

  it('applies config.exclude patterns', async () => {
    await writeFile('src/app.ts', 'const x = 1;');
    await writeFile('src/generated/schema.ts', 'generated code');
    await writeFile('docs/readme.md', 'docs');

    const config = makeConfig({
      root: tmpDir,
      exclude: ['src/generated/', 'docs/'],
    });
    const files = await buildFileList(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).toContain('src/app.ts');
    expect(paths).not.toContain('src/generated/schema.ts');
    expect(paths).not.toContain('docs/readme.md');
  });

  it('applies config.include as allowlist', async () => {
    await writeFile('src/app.ts', 'const x = 1;');
    await writeFile('src/utils.ts', 'export function foo() {}');
    await writeFile('lib/helper.js', 'function help() {}');

    const config = makeConfig({
      root: tmpDir,
      include: ['src/**'],
    });
    const files = await buildFileList(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).toContain('src/app.ts');
    expect(paths).toContain('src/utils.ts');
    expect(paths).not.toContain('lib/helper.js');
  });

  it('populates FileEntry fields correctly', async () => {
    await writeFile('src/utils.test.ts', 'describe("test", () => {});');
    await writeFile('src/app.ts', 'const x = 1;');

    const config = makeConfig({ root: tmpDir });
    const files = await buildFileList(tmpDir, config);

    const testFile = files.find((f) => f.path === 'src/utils.test.ts');
    expect(testFile).toBeDefined();
    expect(testFile!.language).toBe('TypeScript');
    expect(testFile!.extension).toBe('.ts');
    expect(testFile!.isTest).toBe(true);
    expect(testFile!.isBinary).toBe(false);
    expect(testFile!.size).toBeGreaterThan(0);

    const appFile = files.find((f) => f.path === 'src/app.ts');
    expect(appFile).toBeDefined();
    expect(appFile!.isTest).toBe(false);
  });

  it('detects binary files and marks them', async () => {
    await writeFile('src/app.ts', 'const x = 1;');
    // Write a file with a null byte
    const binaryPath = path.join(tmpDir, 'assets/icon.png');
    await fs.mkdir(path.dirname(binaryPath), { recursive: true });
    await fs.writeFile(binaryPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));

    const config = makeConfig({ root: tmpDir });
    const files = await buildFileList(tmpDir, config);

    const icon = files.find((f) => f.path === 'assets/icon.png');
    expect(icon).toBeDefined();
    expect(icon!.isBinary).toBe(true);

    const app = files.find((f) => f.path === 'src/app.ts');
    expect(app).toBeDefined();
    expect(app!.isBinary).toBe(false);
  });

  it('skips symlinks by default', async () => {
    await writeFile('src/real.ts', 'const x = 1;');
    const linkPath = path.join(tmpDir, 'src/link.ts');
    await fs.symlink(path.join(tmpDir, 'src/real.ts'), linkPath);

    const config = makeConfig({ root: tmpDir, followSymlinks: false });
    const files = await buildFileList(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).toContain('src/real.ts');
    expect(paths).not.toContain('src/link.ts');
  });

  it('follows symlinks within repo root when enabled', async () => {
    await writeFile('src/real.ts', 'const x = 1;');
    const linkPath = path.join(tmpDir, 'src/link.ts');
    await fs.symlink(path.join(tmpDir, 'src/real.ts'), linkPath);

    const config = makeConfig({ root: tmpDir, followSymlinks: true });
    const files = await buildFileList(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).toContain('src/real.ts');
    expect(paths).toContain('src/link.ts');
  });

  it('rejects symlinks that escape repo root', async () => {
    await writeFile('src/app.ts', 'const x = 1;');
    // Create a temp file outside the repo
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-policy-outside-'));
    const outsideFile = path.join(outsideDir, 'secret.ts');
    await fs.writeFile(outsideFile, 'secret data');

    const linkPath = path.join(tmpDir, 'src/escape.ts');
    await fs.symlink(outsideFile, linkPath);

    const config = makeConfig({ root: tmpDir, followSymlinks: true });
    const files = await buildFileList(tmpDir, config);

    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('src/escape.ts');
    expect(paths).toContain('src/app.ts');

    // Cleanup outside dir
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it('returns empty array for empty directory', async () => {
    const config = makeConfig({ root: tmpDir });
    const files = await buildFileList(tmpDir, config);
    expect(files).toEqual([]);
  });

  it('uses forward slashes in all paths', async () => {
    await writeFile('src/nested/deep/file.ts', 'const x = 1;');

    const config = makeConfig({ root: tmpDir });
    const files = await buildFileList(tmpDir, config);

    for (const file of files) {
      expect(file.path).not.toContain('\\');
    }
  });
});

// ---------------------------------------------------------------------------
// CODE_EXTENSIONS coverage
// ---------------------------------------------------------------------------

describe('CODE_EXTENSIONS', () => {
  /**
   * All programming language extensions from EXTENSION_TO_LANGUAGE that should
   * be in CODE_EXTENSIONS. Data format / markup extensions are intentionally
   * excluded: .json, .yaml, .yml, .toml, .xml, .md, .html, .htm, .css,
   * .scss, .sass, .less, .sql, .graphql, .gql, .dockerfile, .proto, .sh,
   * .bash, .zsh.
   */
  const PROGRAMMING_EXTENSIONS = [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.go', '.rs', '.java', '.kt', '.rb', '.swift',
    '.c', '.cpp', '.cc', '.h', '.hpp', '.cs', '.php', '.dart',
    '.scala', '.clj', '.ex', '.exs', '.erl', '.hs', '.lua', '.r',
    '.vue', '.svelte',
  ];

  /** Extensions in EXTENSION_TO_LANGUAGE that are intentionally NOT code. */
  const DATA_FORMAT_EXTENSIONS = [
    '.json', '.yaml', '.yml', '.toml', '.xml',
    '.md', '.html', '.htm', '.css', '.scss', '.sass', '.less',
    '.sql', '.graphql', '.gql', '.dockerfile', '.proto',
  ];

  /** Shell extensions are intentionally excluded from CODE_EXTENSIONS. */
  const SHELL_EXTENSIONS = ['.sh', '.bash', '.zsh'];

  it('contains all programming language extensions from EXTENSION_TO_LANGUAGE', () => {
    for (const ext of PROGRAMMING_EXTENSIONS) {
      expect(CODE_EXTENSIONS.has(ext), `CODE_EXTENSIONS should contain ${ext}`).toBe(true);
    }
  });

  it('does not contain data format extensions', () => {
    for (const ext of DATA_FORMAT_EXTENSIONS) {
      expect(CODE_EXTENSIONS.has(ext), `CODE_EXTENSIONS should NOT contain ${ext}`).toBe(false);
    }
  });

  it('.sh is NOT in CODE_EXTENSIONS (intentional gap for test detection)', () => {
    expect(CODE_EXTENSIONS.has('.sh')).toBe(false);
  });

  it('.bash and .zsh are NOT in CODE_EXTENSIONS', () => {
    expect(CODE_EXTENSIONS.has('.bash')).toBe(false);
    expect(CODE_EXTENSIONS.has('.zsh')).toBe(false);
  });

  it('all shell extensions are excluded from CODE_EXTENSIONS', () => {
    for (const ext of SHELL_EXTENSIONS) {
      expect(CODE_EXTENSIONS.has(ext), `CODE_EXTENSIONS should NOT contain ${ext}`).toBe(false);
    }
  });
});
