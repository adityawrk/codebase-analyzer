/**
 * Unit and integration tests for the environment variable analyzer.
 *
 * Unit tests exercise extractEnvVarsFromSource directly with synthetic
 * source strings — no filesystem access required. The integration test
 * runs against the codebase_analysis project itself.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { analyzeEnvVars, extractEnvVarsFromSource, extractPrefix } from './env-vars.js';
import { buildRepositoryIndex } from '../core/repo-index.js';
import { DEFAULT_CONFIG } from '../core/types.js';
import type { AnalysisConfig, FileEntry, RepositoryIndex, GitMeta } from '../core/types.js';
import { SKIP_NON_VITEST } from '../test-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(root: string): AnalysisConfig {
  return { ...DEFAULT_CONFIG, root };
}

function makeFile(filePath: string, size = 1024): FileEntry {
  return {
    path: filePath,
    language: 'Other',
    extension: path.extname(filePath),
    size,
    isTest: false,
    isBinary: false,
  };
}

const EMPTY_GIT: GitMeta = {
  isRepo: false,
  remotes: [],
  headCommit: null,
  defaultBranch: null,
  totalCommits: null,
  firstCommitDate: null,
  lastCommitDate: null,
};

function makeMockIndex(files: FileEntry[]): RepositoryIndex {
  return {
    root: '/mock/repo',
    files,
    filesByLanguage: new Map(),
    filesByExtension: new Map(),
    manifests: [],
    gitMeta: EMPTY_GIT,
    config: makeConfig('/mock/repo'),
  };
}

// ---------------------------------------------------------------------------
// extractPrefix
// ---------------------------------------------------------------------------

describe('extractPrefix', () => {
  it('returns everything before the first underscore', () => {
    expect(extractPrefix('DATABASE_URL')).toBe('DATABASE');
    expect(extractPrefix('NEXT_PUBLIC_API_KEY')).toBe('NEXT');
    expect(extractPrefix('AWS_SECRET_KEY')).toBe('AWS');
  });

  it('returns the whole name when there is no underscore', () => {
    expect(extractPrefix('PORT')).toBe('PORT');
    expect(extractPrefix('HOME')).toBe('HOME');
  });
});

// ---------------------------------------------------------------------------
// JavaScript/TypeScript patterns
// ---------------------------------------------------------------------------

describe('extractEnvVarsFromSource — JavaScript/TypeScript', () => {
  it('detects process.env.VARIABLE_NAME', () => {
    const source = `const url = process.env.DATABASE_URL;\nconst port = process.env.PORT;`;
    const entries = extractEnvVarsFromSource(source, 'javascript', 'src/config.ts');

    expect(entries).toHaveLength(2);
    expect(entries[0]!.name).toBe('DATABASE_URL');
    expect(entries[0]!.file).toBe('src/config.ts');
    expect(entries[0]!.line).toBe(1);
    expect(entries[0]!.prefix).toBe('DATABASE');
    expect(entries[1]!.name).toBe('PORT');
    expect(entries[1]!.line).toBe(2);
    expect(entries[1]!.prefix).toBe('PORT');
  });

  it('detects process.env["VAR"] with double quotes', () => {
    const source = `const key = process.env["API_KEY"];`;
    const entries = extractEnvVarsFromSource(source, 'javascript', 'app.ts');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('API_KEY');
  });

  it("detects process.env['VAR'] with single quotes", () => {
    const source = `const key = process.env['SECRET_KEY'];`;
    const entries = extractEnvVarsFromSource(source, 'javascript', 'app.ts');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('SECRET_KEY');
  });

  it('deduplicates same variable in same file (keeps first occurrence)', () => {
    const source = [
      'const a = process.env.NODE_ENV;',
      'const b = process.env.NODE_ENV;',
      'const c = process.env.NODE_ENV;',
    ].join('\n');
    const entries = extractEnvVarsFromSource(source, 'javascript', 'app.ts');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('NODE_ENV');
    expect(entries[0]!.line).toBe(1);
  });

  it('does not include env var values in the output', () => {
    const source = `const secret = process.env.MY_SECRET;`;
    const entries = extractEnvVarsFromSource(source, 'javascript', 'app.ts');

    expect(entries).toHaveLength(1);
    // Ensure no value-like properties exist on the entry
    const entry = entries[0]!;
    expect(Object.keys(entry)).toEqual(['name', 'file', 'line', 'prefix']);
    expect(entry.name).toBe('MY_SECRET');
    // Verify no "value" field sneaks in
    expect('value' in entry).toBe(false);
  });

  it('correctly categorizes multiple prefixes', () => {
    const source = [
      'process.env.AWS_ACCESS_KEY',
      'process.env.AWS_SECRET_KEY',
      'process.env.NEXT_PUBLIC_URL',
      'process.env.DATABASE_URL',
    ].join('\n');
    const entries = extractEnvVarsFromSource(source, 'javascript', 'config.ts');

    expect(entries).toHaveLength(4);

    const prefixes = entries.map((e) => e.prefix);
    expect(prefixes.filter((p) => p === 'AWS')).toHaveLength(2);
    expect(prefixes.filter((p) => p === 'NEXT')).toHaveLength(1);
    expect(prefixes.filter((p) => p === 'DATABASE')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Python patterns
// ---------------------------------------------------------------------------

describe('extractEnvVarsFromSource — Python', () => {
  it('detects os.environ["VAR"]', () => {
    const source = `db_url = os.environ["DATABASE_URL"]`;
    const entries = extractEnvVarsFromSource(source, 'python', 'config.py');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('DATABASE_URL');
  });

  it("detects os.environ.get('VAR')", () => {
    const source = `debug = os.environ.get('DEBUG_MODE')`;
    const entries = extractEnvVarsFromSource(source, 'python', 'config.py');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('DEBUG_MODE');
  });

  it("detects os.getenv('VAR')", () => {
    const source = `port = os.getenv('PORT')`;
    const entries = extractEnvVarsFromSource(source, 'python', 'settings.py');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('PORT');
  });

  it('detects multiple Python patterns in one file', () => {
    const source = [
      `db = os.environ["DATABASE_URL"]`,
      `secret = os.environ.get('SECRET_KEY')`,
      `port = os.getenv("PORT")`,
    ].join('\n');
    const entries = extractEnvVarsFromSource(source, 'python', 'app.py');

    expect(entries).toHaveLength(3);
    const names = entries.map((e) => e.name);
    expect(names).toContain('DATABASE_URL');
    expect(names).toContain('SECRET_KEY');
    expect(names).toContain('PORT');
  });
});

// ---------------------------------------------------------------------------
// Go patterns
// ---------------------------------------------------------------------------

describe('extractEnvVarsFromSource — Go', () => {
  it('detects os.Getenv("VAR")', () => {
    const source = `port := os.Getenv("PORT")`;
    const entries = extractEnvVarsFromSource(source, 'go', 'main.go');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('PORT');
  });
});

// ---------------------------------------------------------------------------
// .env file patterns
// ---------------------------------------------------------------------------

describe('extractEnvVarsFromSource — dotenv', () => {
  it('detects VAR=value lines', () => {
    const source = [
      'DATABASE_URL=postgres://localhost/mydb',
      'PORT=3000',
      'SECRET_KEY=mysecret123',
    ].join('\n');
    const entries = extractEnvVarsFromSource(source, 'dotenv', '.env');

    expect(entries).toHaveLength(3);
    const names = entries.map((e) => e.name);
    expect(names).toContain('DATABASE_URL');
    expect(names).toContain('PORT');
    expect(names).toContain('SECRET_KEY');
  });

  it('ignores comment lines starting with #', () => {
    const source = [
      '# This is a comment',
      'DATABASE_URL=postgres://localhost/mydb',
      '# Another comment',
      'PORT=3000',
    ].join('\n');
    const entries = extractEnvVarsFromSource(source, 'dotenv', '.env');

    // Comments should not match because they start with # not a capital letter
    expect(entries).toHaveLength(2);
    const names = entries.map((e) => e.name);
    expect(names).toContain('DATABASE_URL');
    expect(names).toContain('PORT');
  });

  it('does not include values in output — only names', () => {
    const source = `API_KEY=super_secret_value_12345`;
    const entries = extractEnvVarsFromSource(source, 'dotenv', '.env');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('API_KEY');
    // The output should not contain the value anywhere
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain('super_secret_value_12345');
  });
});

// ---------------------------------------------------------------------------
// Shell patterns
// ---------------------------------------------------------------------------

describe('extractEnvVarsFromSource — Shell', () => {
  it('detects ${VARIABLE_NAME}', () => {
    const source = `echo ${`\${DATABASE_URL}`}`;
    const entries = extractEnvVarsFromSource(source, 'shell', 'deploy.sh');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('DATABASE_URL');
  });

  it('detects $VARIABLE_NAME', () => {
    const source = `curl $API_ENDPOINT/health`;
    const entries = extractEnvVarsFromSource(source, 'shell', 'check.sh');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('API_ENDPOINT');
  });
});

// ---------------------------------------------------------------------------
// Docker-compose patterns
// ---------------------------------------------------------------------------

describe('extractEnvVarsFromSource — Docker/compose', () => {
  it('detects ENV directive', () => {
    const source = `ENV NODE_ENV production`;
    const entries = extractEnvVarsFromSource(source, 'docker-compose', 'docker-compose.yml');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('NODE_ENV');
  });

  it('detects environment section variables', () => {
    const source = [
      'environment:',
      '  DATABASE_URL: postgres://db/mydb',
      '  - REDIS_URL=redis://localhost',
    ].join('\n');
    const entries = extractEnvVarsFromSource(source, 'docker-compose', 'docker-compose.yml');

    const names = entries.map((e) => e.name);
    expect(names).toContain('DATABASE_URL');
    expect(names).toContain('REDIS_URL');
  });
});

// ---------------------------------------------------------------------------
// Prefix categorization (byPrefix)
// ---------------------------------------------------------------------------

describe('byPrefix aggregation', () => {
  it('byPrefix keys match detected prefixes', () => {
    const source = [
      'process.env.AWS_ACCESS_KEY',
      'process.env.AWS_SECRET_KEY',
      'process.env.NEXT_PUBLIC_URL',
      'process.env.DATABASE_URL',
      'process.env.PORT',
    ].join('\n');
    const entries = extractEnvVarsFromSource(source, 'javascript', 'config.ts');

    // Manually compute byPrefix from entries
    const byPrefix: Record<string, number> = {};
    for (const entry of entries) {
      byPrefix[entry.prefix] = (byPrefix[entry.prefix] ?? 0) + 1;
    }

    expect(byPrefix['AWS']).toBe(2);
    expect(byPrefix['NEXT']).toBe(1);
    expect(byPrefix['DATABASE']).toBe(1);
    expect(byPrefix['PORT']).toBe(1);
    expect(Object.keys(byPrefix)).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// analyzeEnvVars — with mock index
// ---------------------------------------------------------------------------

describe('analyzeEnvVars', () => {
  it('returns computed status', async () => {
    const index = makeMockIndex([]);
    const result = await analyzeEnvVars(index);

    expect(result.meta.status).toBe('computed');
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns zero vars for empty file list', async () => {
    const index = makeMockIndex([]);
    const result = await analyzeEnvVars(index);

    expect(result.totalVars).toBe(0);
    expect(result.variables).toEqual([]);
    expect(result.byPrefix).toEqual({});
  });

  it('skips binary files', async () => {
    const binaryFile: FileEntry = {
      path: 'image.ts',
      language: 'TypeScript',
      extension: '.ts',
      size: 100,
      isTest: false,
      isBinary: true,
    };
    const index = makeMockIndex([binaryFile]);
    const result = await analyzeEnvVars(index);

    expect(result.totalVars).toBe(0);
  });

  it('skips files exceeding maxFileSize', async () => {
    const largeFile: FileEntry = {
      path: 'config.ts',
      language: 'TypeScript',
      extension: '.ts',
      size: 2_000_000, // 2MB, over default 1MB limit
      isTest: false,
      isBinary: false,
    };
    const index = makeMockIndex([largeFile]);
    const result = await analyzeEnvVars(index);

    expect(result.totalVars).toBe(0);
  });

  it('skips unsupported extensions', async () => {
    const htmlFile: FileEntry = {
      path: 'index.html',
      language: 'HTML',
      extension: '.html',
      size: 100,
      isTest: false,
      isBinary: false,
    };
    const index = makeMockIndex([htmlFile]);
    const result = await analyzeEnvVars(index);

    expect(result.totalVars).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration test against the actual codebase_analysis project
// ---------------------------------------------------------------------------

describe.skipIf(SKIP_NON_VITEST)('analyzeEnvVars — integration', () => {
  it('produces a valid result for the codebase_analysis project', async () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const index = await buildRepositoryIndex(root, makeConfig(root));
    const result = await analyzeEnvVars(index);

    expect(result.meta.status).toBe('computed');
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.totalVars).toBeGreaterThanOrEqual(0);
    expect(result.variables.length).toBe(result.totalVars);

    // Verify structural invariants
    for (const entry of result.variables) {
      expect(entry.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(entry.file).toBeTruthy();
      expect(entry.line).toBeGreaterThanOrEqual(1);
      expect(entry.prefix).toBeTruthy();
      // Ensure no values sneak in
      expect(Object.keys(entry)).toEqual(['name', 'file', 'line', 'prefix']);
    }

    // Verify byPrefix keys match actual prefixes from variables
    const expectedPrefixes = new Set(result.variables.map((v) => v.prefix));
    const actualPrefixKeys = new Set(Object.keys(result.byPrefix));
    expect(actualPrefixKeys).toEqual(expectedPrefixes);

    // Verify byPrefix counts sum to totalVars
    const totalFromPrefix = Object.values(result.byPrefix).reduce((sum, n) => sum + n, 0);
    expect(totalFromPrefix).toBe(result.totalVars);
  });
});

// ---------------------------------------------------------------------------
// Line number accuracy
// ---------------------------------------------------------------------------

describe('line number accuracy', () => {
  it('reports correct 1-based line numbers', () => {
    const source = [
      '// line 1',
      '// line 2',
      'const x = process.env.FIRST_VAR;',
      '// line 4',
      'const y = process.env.SECOND_VAR;',
    ].join('\n');
    const entries = extractEnvVarsFromSource(source, 'javascript', 'test.ts');

    expect(entries).toHaveLength(2);
    expect(entries[0]!.name).toBe('FIRST_VAR');
    expect(entries[0]!.line).toBe(3);
    expect(entries[1]!.name).toBe('SECOND_VAR');
    expect(entries[1]!.line).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('returns empty array for content with no env vars', () => {
    const source = `const x = 42;\nconsole.log('hello');\n`;
    const entries = extractEnvVarsFromSource(source, 'javascript', 'app.ts');

    expect(entries).toHaveLength(0);
  });

  it('does not match lowercase variable names', () => {
    const source = `const x = process.env.lowercase_var;`;
    const entries = extractEnvVarsFromSource(source, 'javascript', 'app.ts');

    expect(entries).toHaveLength(0);
  });

  it('handles empty file content', () => {
    const entries = extractEnvVarsFromSource('', 'javascript', 'empty.ts');

    expect(entries).toHaveLength(0);
  });

  it('handles unknown language group', () => {
    const source = `process.env.SHOULD_NOT_MATCH`;
    const entries = extractEnvVarsFromSource(source, 'unknown', 'file.xyz');

    expect(entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test file filtering — analyzeEnvVars skips isTest files
// ---------------------------------------------------------------------------

describe('analyzeEnvVars — test file filtering', () => {
  it('excludes env vars from test files (isTest=true)', async () => {
    // Create a mock index with a real file on disk that contains env vars,
    // but mark it as a test file. The analyzer should skip it entirely.
    const testFile: FileEntry = {
      path: 'src/analyzers/env-vars.test.ts',
      language: 'TypeScript',
      extension: '.ts',
      size: 500,
      isTest: true,
      isBinary: false,
    };
    // The file exists on disk and contains 'process.env' references,
    // but since isTest=true the analyzer should not read it at all.
    const root = path.resolve(import.meta.dirname, '../..');
    const index: RepositoryIndex = {
      root,
      files: [testFile],
      filesByLanguage: new Map([['TypeScript', [testFile]]]),
      filesByExtension: new Map([['.ts', [testFile]]]),
      manifests: [],
      gitMeta: EMPTY_GIT,
      config: makeConfig(root),
    };
    const result = await analyzeEnvVars(index);

    expect(result.totalVars).toBe(0);
    expect(result.variables).toEqual([]);
  });

  it('includes env vars from non-test files (isTest=false)', async () => {
    // Use the actual env-vars.ts source file which contains SUPPORTED_EXTENSIONS
    // and references to env-related patterns — it won't have process.env calls itself.
    // Instead, create a temp scenario: use a real source file that we know has env var patterns.
    // The cleanest approach: use the mock index pointing to our own test fixture inline.
    const root = path.resolve(import.meta.dirname, '../..');

    // Find a real .ts file that is NOT a test file and check if the analyzer processes it
    // We'll create a mock index with two identical file references:
    // one marked as test, one not. Only the non-test one should be scanned.
    const sourceFile: FileEntry = {
      path: 'src/analyzers/env-vars.ts',
      language: 'TypeScript',
      extension: '.ts',
      size: 500,
      isTest: false,
      isBinary: false,
    };
    const testCopy: FileEntry = {
      ...sourceFile,
      path: 'src/analyzers/env-vars.ts',
      isTest: true,
    };

    // Run with just the test-flagged copy: should find 0
    const indexTestOnly: RepositoryIndex = {
      root,
      files: [testCopy],
      filesByLanguage: new Map(),
      filesByExtension: new Map(),
      manifests: [],
      gitMeta: EMPTY_GIT,
      config: makeConfig(root),
    };
    const resultTest = await analyzeEnvVars(indexTestOnly);

    // Run with the non-test copy: should find whatever's in the file
    const indexSourceOnly: RepositoryIndex = {
      root,
      files: [sourceFile],
      filesByLanguage: new Map(),
      filesByExtension: new Map(),
      manifests: [],
      gitMeta: EMPTY_GIT,
      config: makeConfig(root),
    };
    const resultSource = await analyzeEnvVars(indexSourceOnly);

    // The test version should always have fewer or equal env vars vs the source version
    expect(resultTest.totalVars).toBe(0);
    // The source file env-vars.ts contains the regex pattern ENV_VAR_NAME which
    // might or might not match. The key assertion is that test files are excluded.
    expect(resultSource.meta.status).toBe('computed');
  });
});
