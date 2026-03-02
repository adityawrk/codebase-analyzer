import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { analyzeTechStack } from './tech-stack.js';
import { buildRepositoryIndex } from '../core/repo-index.js';
import { DEFAULT_CONFIG } from '../core/types.js';
import type {
  AnalysisConfig,
  FileEntry,
  GitMeta,
  ManifestEntry,
  RepositoryIndex,
  TechStackEntry,
} from '../core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(root: string): AnalysisConfig {
  return { ...DEFAULT_CONFIG, root };
}

function makeFile(filePath: string, language = 'Other', size = 1024): FileEntry {
  return {
    path: filePath,
    language,
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

function makeMockIndex(
  files: FileEntry[],
  manifests: ManifestEntry[] = [],
  filesByLanguage?: Map<string, FileEntry[]>,
): RepositoryIndex {
  // Build filesByLanguage from files if not provided
  const langMap = filesByLanguage ?? new Map<string, FileEntry[]>();
  if (!filesByLanguage) {
    for (const file of files) {
      const existing = langMap.get(file.language);
      if (existing) {
        existing.push(file);
      } else {
        langMap.set(file.language, [file]);
      }
    }
  }

  return {
    root: '/mock/repo',
    files,
    filesByLanguage: langMap,
    filesByExtension: new Map(),
    manifests,
    gitMeta: EMPTY_GIT,
    config: makeConfig('/mock/repo'),
  };
}

// ---------------------------------------------------------------------------
// Unit tests with mock data
// ---------------------------------------------------------------------------

describe('analyzeTechStack — unit', () => {
  it('returns computed status for empty index', async () => {
    const index = makeMockIndex([]);
    const result = await analyzeTechStack(index);

    expect(result.meta.status).toBe('computed');
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.stack).toEqual([]);
  });

  it('detects languages from filesByLanguage', async () => {
    const tsFiles = [makeFile('src/index.ts', 'TypeScript')];
    const langMap = new Map<string, FileEntry[]>([['TypeScript', tsFiles]]);
    const index = makeMockIndex(tsFiles, [], langMap);

    const result = await analyzeTechStack(index);

    expect(result.meta.status).toBe('computed');
    const ts = result.stack.find((e) => e.name === 'TypeScript');
    expect(ts).toBeDefined();
    expect(ts!.category).toBe('language-tool');
    expect(ts!.source).toBe('file extensions');
  });

  it('detects Docker from Dockerfile presence', async () => {
    const files = [makeFile('Dockerfile')];
    const index = makeMockIndex(files);

    const result = await analyzeTechStack(index);

    const docker = result.stack.find((e) => e.name === 'Docker');
    expect(docker).toBeDefined();
    expect(docker!.category).toBe('deployment');
  });

  it('detects GitHub Actions from workflow files', async () => {
    const files = [
      makeFile('.github/workflows/ci.yml'),
      makeFile('.github/workflows/deploy.yaml'),
    ];
    const index = makeMockIndex(files);

    const result = await analyzeTechStack(index);

    const ghActions = result.stack.find((e) => e.name === 'GitHub Actions');
    expect(ghActions).toBeDefined();
    expect(ghActions!.category).toBe('deployment');
  });

  it('detects Docker Compose from docker-compose.yml', async () => {
    const files = [makeFile('docker-compose.yml')];
    const index = makeMockIndex(files);

    const result = await analyzeTechStack(index);

    const compose = result.stack.find((e) => e.name === 'Docker Compose');
    expect(compose).toBeDefined();
    expect(compose!.category).toBe('deployment');
  });

  it('detects ESLint from config file', async () => {
    const files = [makeFile('.eslintrc.json')];
    const index = makeMockIndex(files);

    const result = await analyzeTechStack(index);

    const eslint = result.stack.find((e) => e.name === 'ESLint');
    expect(eslint).toBeDefined();
    expect(eslint!.category).toBe('linter');
  });

  it('detects ESLint from flat config', async () => {
    const files = [makeFile('eslint.config.mjs')];
    const index = makeMockIndex(files);

    const result = await analyzeTechStack(index);

    const eslint = result.stack.find((e) => e.name === 'ESLint');
    expect(eslint).toBeDefined();
  });

  it('detects Prettier from config file', async () => {
    const files = [makeFile('.prettierrc')];
    const index = makeMockIndex(files);

    const result = await analyzeTechStack(index);

    const prettier = result.stack.find((e) => e.name === 'Prettier');
    expect(prettier).toBeDefined();
    expect(prettier!.category).toBe('formatter');
  });

  it('detects Biome from biome.json', async () => {
    const files = [makeFile('biome.json')];
    const index = makeMockIndex(files);

    const result = await analyzeTechStack(index);

    const biome = result.stack.find((e) => e.name === 'Biome');
    expect(biome).toBeDefined();
    expect(biome!.category).toBe('linter');
  });

  it('detects Tailwind CSS from config file', async () => {
    const files = [makeFile('tailwind.config.ts')];
    const index = makeMockIndex(files);

    const result = await analyzeTechStack(index);

    const tw = result.stack.find((e) => e.name === 'Tailwind CSS');
    expect(tw).toBeDefined();
    expect(tw!.category).toBe('framework');
  });

  it('produces no duplicate entries', async () => {
    // Dockerfile and Docker Compose should both appear, but Docker should not be duplicated
    const files = [
      makeFile('Dockerfile'),
      makeFile('infra/Dockerfile'),
    ];
    const index = makeMockIndex(files);

    const result = await analyzeTechStack(index);

    const names = result.stack.map((e) => e.name);
    const uniqueNames = new Set(names);
    expect(names.length).toBe(uniqueNames.size);
  });

  it('each entry has name, category, and source', async () => {
    const files = [
      makeFile('Dockerfile'),
      makeFile('.github/workflows/ci.yml'),
      makeFile('src/index.ts', 'TypeScript'),
    ];
    const langMap = new Map<string, FileEntry[]>([
      ['TypeScript', [files[2]!]],
    ]);
    const index = makeMockIndex(files, [], langMap);

    const result = await analyzeTechStack(index);

    for (const entry of result.stack) {
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.category).toBe('string');
      expect(entry.category.length).toBeGreaterThan(0);
      expect(typeof entry.source).toBe('string');
      expect(entry.source.length).toBeGreaterThan(0);
    }
  });

  it('entries are sorted by category then name', async () => {
    const files = [
      makeFile('Dockerfile'),
      makeFile('.prettierrc'),
      makeFile('.eslintrc.json'),
      makeFile('src/index.ts', 'TypeScript'),
    ];
    const langMap = new Map<string, FileEntry[]>([
      ['TypeScript', [files[3]!]],
    ]);
    const index = makeMockIndex(files, [], langMap);

    const result = await analyzeTechStack(index);

    const categoryOrder = [
      'language-tool',
      'framework',
      'build-tool',
      'linter',
      'formatter',
      'test-runner',
      'database',
      'service',
      'deployment',
      'other',
    ];

    // Verify category ordering
    for (let i = 1; i < result.stack.length; i++) {
      const prevCatIdx = categoryOrder.indexOf(result.stack[i - 1]!.category);
      const currCatIdx = categoryOrder.indexOf(result.stack[i]!.category);

      if (prevCatIdx === currCatIdx) {
        // Same category: alphabetical
        expect(
          result.stack[i]!.name.localeCompare(result.stack[i - 1]!.name),
        ).toBeGreaterThanOrEqual(0);
      } else {
        // Different categories: category order
        expect(currCatIdx).toBeGreaterThanOrEqual(prevCatIdx);
      }
    }
  });

  it('detects GitLab CI from .gitlab-ci.yml', async () => {
    const files = [makeFile('.gitlab-ci.yml')];
    const index = makeMockIndex(files);

    const result = await analyzeTechStack(index);

    const gitlab = result.stack.find((e) => e.name === 'GitLab CI');
    expect(gitlab).toBeDefined();
    expect(gitlab!.category).toBe('deployment');
  });
});

// ---------------------------------------------------------------------------
// Integration test against the actual codebase_analysis project
// ---------------------------------------------------------------------------

describe('analyzeTechStack — integration', () => {
  async function buildTestIndex(): Promise<RepositoryIndex> {
    const root = path.resolve(import.meta.dirname, '../..');
    const config = makeConfig(root);
    return buildRepositoryIndex(root, config);
  }

  it('returns computed status for the codebase_analysis project', async () => {
    const index = await buildTestIndex();
    const result = await analyzeTechStack(index);

    expect(result.meta.status).toBe('computed');
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('detects TypeScript as a language tool', async () => {
    const index = await buildTestIndex();
    const result = await analyzeTechStack(index);

    const ts = result.stack.find((e) => e.name === 'TypeScript');
    expect(ts).toBeDefined();
    expect(ts!.category).toBe('language-tool');
  });

  it('detects vitest as test-runner', async () => {
    const index = await buildTestIndex();
    const result = await analyzeTechStack(index);

    const vitest = result.stack.find((e) => e.name === 'Vitest');
    expect(vitest).toBeDefined();
    expect(vitest!.category).toBe('test-runner');
  });

  it('detects Commander from npm dependencies', async () => {
    const index = await buildTestIndex();
    const result = await analyzeTechStack(index);

    const commander = result.stack.find((e) => e.name === 'Commander');
    expect(commander).toBeDefined();
    expect(commander!.source).toContain('package.json');
  });

  it('has no duplicate entries', async () => {
    const index = await buildTestIndex();
    const result = await analyzeTechStack(index);

    const names = result.stack.map((e) => e.name);
    const uniqueNames = new Set(names);
    expect(names.length).toBe(uniqueNames.size);
  });

  it('every entry has name, category, and source', async () => {
    const index = await buildTestIndex();
    const result = await analyzeTechStack(index);

    expect(result.stack.length).toBeGreaterThan(0);

    for (const entry of result.stack) {
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.category).toBe('string');
      expect(typeof entry.source).toBe('string');
      expect(entry.source.length).toBeGreaterThan(0);
    }
  });

  it('detects multiple technologies from package.json', async () => {
    const index = await buildTestIndex();
    const result = await analyzeTechStack(index);

    // This project has commander, vitest, typescript, yaml at minimum
    const fromPkg = result.stack.filter((e) => e.source.includes('package.json'));
    expect(fromPkg.length).toBeGreaterThanOrEqual(3);
  });
});
