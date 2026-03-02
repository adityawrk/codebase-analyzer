import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { analyzeRepoHealth } from './repo-health.js';
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
// Unit tests with mock data
// ---------------------------------------------------------------------------

describe('analyzeRepoHealth', () => {
  it('detects README when present at root', async () => {
    const index = makeMockIndex([makeFile('README.md')]);
    const result = await analyzeRepoHealth(index);

    const readme = result.checks.find((c) => c.name === 'README');
    expect(readme).toBeDefined();
    expect(readme!.present).toBe(true);
    expect(readme!.path).toBe('README.md');
  });

  it('detects README.rst variant', async () => {
    const index = makeMockIndex([makeFile('README.rst')]);
    const result = await analyzeRepoHealth(index);

    const readme = result.checks.find((c) => c.name === 'README');
    expect(readme!.present).toBe(true);
    expect(readme!.path).toBe('README.rst');
  });

  it('does not detect README in subdirectory as root README', async () => {
    const index = makeMockIndex([makeFile('docs/README.md')]);
    const result = await analyzeRepoHealth(index);

    const readme = result.checks.find((c) => c.name === 'README');
    expect(readme!.present).toBe(false);
  });

  it('detects LICENSE with various names', async () => {
    const index = makeMockIndex([makeFile('LICENCE.md')]);
    const result = await analyzeRepoHealth(index);

    const license = result.checks.find((c) => c.name === 'LICENSE');
    expect(license!.present).toBe(true);
    expect(license!.path).toBe('LICENCE.md');
  });

  it('detects GitHub Actions CI workflows', async () => {
    const index = makeMockIndex([
      makeFile('.github/workflows/ci.yml'),
      makeFile('.github/workflows/release.yaml'),
    ]);
    const result = await analyzeRepoHealth(index);

    const ci = result.checks.find((c) => c.name === 'CI Configuration');
    expect(ci!.present).toBe(true);
    expect(ci!.path).toBe('.github/workflows/ci.yml');
    expect(ci!.note).toContain('GitHub Actions');
    expect(ci!.note).toContain('2 workflow files');
  });

  it('detects GitLab CI', async () => {
    const index = makeMockIndex([makeFile('.gitlab-ci.yml')]);
    const result = await analyzeRepoHealth(index);

    const ci = result.checks.find((c) => c.name === 'CI Configuration');
    expect(ci!.present).toBe(true);
    expect(ci!.note).toContain('GitLab CI');
  });

  it('detects Travis CI', async () => {
    const index = makeMockIndex([makeFile('.travis.yml')]);
    const result = await analyzeRepoHealth(index);

    const ci = result.checks.find((c) => c.name === 'CI Configuration');
    expect(ci!.present).toBe(true);
    expect(ci!.note).toContain('Travis CI');
  });

  it('detects CircleCI', async () => {
    const index = makeMockIndex([makeFile('.circleci/config.yml')]);
    const result = await analyzeRepoHealth(index);

    const ci = result.checks.find((c) => c.name === 'CI Configuration');
    expect(ci!.present).toBe(true);
    expect(ci!.note).toContain('CircleCI');
  });

  it('detects Jenkinsfile', async () => {
    const index = makeMockIndex([makeFile('Jenkinsfile')]);
    const result = await analyzeRepoHealth(index);

    const ci = result.checks.find((c) => c.name === 'CI Configuration');
    expect(ci!.present).toBe(true);
  });

  it('detects multiple CI platforms', async () => {
    const index = makeMockIndex([
      makeFile('.github/workflows/ci.yml'),
      makeFile('.gitlab-ci.yml'),
    ]);
    const result = await analyzeRepoHealth(index);

    const ci = result.checks.find((c) => c.name === 'CI Configuration');
    expect(ci!.present).toBe(true);
    expect(ci!.note).toContain('GitHub Actions');
    expect(ci!.note).toContain('GitLab CI');
    expect(ci!.note).toContain('platforms');
  });

  it('reports missing files as present: false', async () => {
    const index = makeMockIndex([makeFile('src/index.ts')]);
    const result = await analyzeRepoHealth(index);

    for (const check of result.checks) {
      expect(check.present).toBe(false);
      expect(check.path).toBeUndefined();
    }
  });

  it('detects Dockerfile anywhere in repo', async () => {
    const index = makeMockIndex([makeFile('infra/deploy/Dockerfile')]);
    const result = await analyzeRepoHealth(index);

    const docker = result.checks.find((c) => c.name === 'Dockerfile');
    expect(docker!.present).toBe(true);
    expect(docker!.path).toBe('infra/deploy/Dockerfile');
  });

  it('detects docker-compose.yml anywhere in repo', async () => {
    const index = makeMockIndex([makeFile('docker-compose.yml')]);
    const result = await analyzeRepoHealth(index);

    const docker = result.checks.find((c) => c.name === 'Dockerfile');
    expect(docker!.present).toBe(true);
    expect(docker!.path).toBe('docker-compose.yml');
  });

  it('detects all standard health files', async () => {
    const index = makeMockIndex([
      makeFile('README.md'),
      makeFile('LICENSE'),
      makeFile('.github/workflows/ci.yml'),
      makeFile('CONTRIBUTING.md'),
      makeFile('.gitignore'),
      makeFile('.editorconfig'),
      makeFile('Dockerfile'),
      makeFile('SECURITY.md'),
      makeFile('CODE_OF_CONDUCT.md'),
      makeFile('CHANGELOG.md'),
    ]);
    const result = await analyzeRepoHealth(index);

    for (const check of result.checks) {
      expect(check.present).toBe(true);
    }
  });

  it('returns exactly 10 checks', async () => {
    const index = makeMockIndex([]);
    const result = await analyzeRepoHealth(index);

    expect(result.checks).toHaveLength(10);
    const names = result.checks.map((c) => c.name);
    expect(names).toContain('README');
    expect(names).toContain('LICENSE');
    expect(names).toContain('CI Configuration');
    expect(names).toContain('CONTRIBUTING');
    expect(names).toContain('.gitignore');
    expect(names).toContain('.editorconfig');
    expect(names).toContain('Dockerfile');
    expect(names).toContain('Security Policy');
    expect(names).toContain('Code of Conduct');
    expect(names).toContain('Changelog');
  });

  it('returns computed status and timing', async () => {
    const index = makeMockIndex([]);
    const result = await analyzeRepoHealth(index);

    expect(result.meta.status).toBe('computed');
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('handles case-insensitive filename matching', async () => {
    const index = makeMockIndex([makeFile('readme.md')]);
    const result = await analyzeRepoHealth(index);

    const readme = result.checks.find((c) => c.name === 'README');
    expect(readme!.present).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration test against the actual codebase_analysis project
// ---------------------------------------------------------------------------

describe.skipIf(SKIP_NON_VITEST)('analyzeRepoHealth — integration', () => {
  it('detects health files in the codebase_analysis project', async () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const index = await buildRepositoryIndex(root, makeConfig(root));
    const result = await analyzeRepoHealth(index);

    expect(result.meta.status).toBe('computed');
    expect(result.checks.length).toBeGreaterThan(0);

    // This project should have at least a .gitignore
    const gitignore = result.checks.find((c) => c.name === '.gitignore');
    expect(gitignore).toBeDefined();

    // Log what was found for debugging
    const present = result.checks.filter((c) => c.present);
    const missing = result.checks.filter((c) => !c.present);
    expect(present.length + missing.length).toBe(result.checks.length);
  });
});
