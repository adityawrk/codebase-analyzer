import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { analyzeGit } from './git.js';
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

const NON_GIT_META: GitMeta = {
  isRepo: false,
  remotes: [],
  headCommit: null,
  defaultBranch: null,
  totalCommits: null,
  firstCommitDate: null,
  lastCommitDate: null,
};

function makeNonGitIndex(): RepositoryIndex {
  return {
    root: '/tmp/definitely-not-a-git-repo',
    files: [],
    filesByLanguage: new Map(),
    filesByExtension: new Map(),
    manifests: [],
    gitMeta: NON_GIT_META,
    config: makeConfig('/tmp/definitely-not-a-git-repo'),
  };
}

/**
 * Build a RepositoryIndex for the codebase_analysis project itself.
 */
async function buildTestIndex(): Promise<RepositoryIndex> {
  const root = path.resolve(import.meta.dirname, '../..');
  const config = makeConfig(root);
  return buildRepositoryIndex(root, config);
}

// ---------------------------------------------------------------------------
// Unit tests: non-git repo graceful degradation
// ---------------------------------------------------------------------------

describe('analyzeGit — non-git repo', () => {
  it('returns skipped status when not a git repo', async () => {
    const index = makeNonGitIndex();
    const result = await analyzeGit(index);

    expect(result.meta.status).toBe('skipped');
    expect(result.meta.reason).toContain('Not a git repository');
    expect(result.totalCommits).toBe(0);
    expect(result.contributors).toBe(0);
    expect(result.firstCommitDate).toBeNull();
    expect(result.lastCommitDate).toBeNull();
    expect(result.activeDays).toBe(0);
    expect(result.topContributors).toHaveLength(0);
    expect(result.busFactor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: run against the codebase_analysis repo itself
// ---------------------------------------------------------------------------

describe.skipIf(SKIP_NON_VITEST)('analyzeGit — integration', () => {
  it('returns computed status for a git repo', async () => {
    const index = await buildTestIndex();
    const result = await analyzeGit(index);

    expect(result.meta.status).toBe('computed');
    expect(result.meta.durationMs).toBeGreaterThan(0);
  });

  it('totalCommits > 0', async () => {
    const index = await buildTestIndex();
    const result = await analyzeGit(index);

    expect(result.totalCommits).toBeGreaterThan(0);
  });

  it('has at least 1 contributor', async () => {
    const index = await buildTestIndex();
    const result = await analyzeGit(index);

    expect(result.contributors).toBeGreaterThanOrEqual(1);
  });

  it('conventionalCommitPercent is between 0 and 100', async () => {
    const index = await buildTestIndex();
    const result = await analyzeGit(index);

    expect(result.conventionalCommitPercent).toBeGreaterThanOrEqual(0);
    expect(result.conventionalCommitPercent).toBeLessThanOrEqual(100);
  });

  it('busFactor >= 1', async () => {
    const index = await buildTestIndex();
    const result = await analyzeGit(index);

    expect(result.busFactor).toBeGreaterThanOrEqual(1);
  });

  it('activeDays >= 1', async () => {
    const index = await buildTestIndex();
    const result = await analyzeGit(index);

    expect(result.activeDays).toBeGreaterThanOrEqual(1);
  });

  it('topContributors is sorted descending by commits', async () => {
    const index = await buildTestIndex();
    const result = await analyzeGit(index);

    expect(result.topContributors.length).toBeGreaterThanOrEqual(1);

    for (let i = 1; i < result.topContributors.length; i++) {
      expect(result.topContributors[i]!.commits).toBeLessThanOrEqual(
        result.topContributors[i - 1]!.commits,
      );
    }
  });

  it('topContributors entries have name, email, and commits', async () => {
    const index = await buildTestIndex();
    const result = await analyzeGit(index);

    for (const contributor of result.topContributors) {
      expect(typeof contributor.name).toBe('string');
      expect(contributor.name.length).toBeGreaterThan(0);
      expect(typeof contributor.email).toBe('string');
      expect(typeof contributor.commits).toBe('number');
      expect(contributor.commits).toBeGreaterThan(0);
    }
  });

  it('topContributors has at most 10 entries', async () => {
    const index = await buildTestIndex();
    const result = await analyzeGit(index);

    expect(result.topContributors.length).toBeLessThanOrEqual(10);
  });

  it('commitFrequency values are >= 0', async () => {
    const index = await buildTestIndex();
    const result = await analyzeGit(index);

    expect(result.commitFrequency.commitsPerWeek).toBeGreaterThanOrEqual(0);
    expect(result.commitFrequency.commitsPerMonth).toBeGreaterThanOrEqual(0);
  });

  it('firstCommitDate and lastCommitDate are valid ISO strings', async () => {
    const index = await buildTestIndex();
    const result = await analyzeGit(index);

    expect(result.firstCommitDate).not.toBeNull();
    expect(result.lastCommitDate).not.toBeNull();

    // Should parse as valid dates
    const first = new Date(result.firstCommitDate!);
    const last = new Date(result.lastCommitDate!);
    expect(first.getTime()).not.toBeNaN();
    expect(last.getTime()).not.toBeNaN();

    // first should be <= last
    expect(first.getTime()).toBeLessThanOrEqual(last.getTime());
  });

  it('contributors count matches or exceeds topContributors length', async () => {
    const index = await buildTestIndex();
    const result = await analyzeGit(index);

    expect(result.contributors).toBeGreaterThanOrEqual(
      result.topContributors.length,
    );
  });
});
