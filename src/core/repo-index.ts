/**
 * RepositoryIndex builder.
 * Single-pass file inventory consumed by all analyzers.
 */

import * as path from 'node:path';
import { buildFileList } from './file-policy.js';
import { execTool } from './exec.js';
import type {
  AnalysisConfig,
  FileEntry,
  GitMeta,
  ManifestEntry,
  ManifestType,
  RepositoryIndex,
} from './types.js';

const MANIFEST_MAP: Record<string, ManifestType> = {
  'package.json': 'npm',
  'Cargo.toml': 'cargo',
  'go.mod': 'go',
  'requirements.txt': 'python-requirements',
  'pyproject.toml': 'python-pyproject',
  'pom.xml': 'maven',
  'build.gradle': 'gradle',
  'build.gradle.kts': 'gradle',
};

async function readGitMeta(root: string, timeout: number): Promise<GitMeta> {
  const noGit: GitMeta = {
    isRepo: false,
    remotes: [],
    headCommit: null,
    defaultBranch: null,
    totalCommits: null,
    firstCommitDate: null,
    lastCommitDate: null,
  };

  // Check if this is a git repo
  const revParse = await execTool('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: root,
    timeout,
  });
  if (revParse.exitCode !== 0) return noGit;

  // Run git commands in parallel
  const [headResult, remotesResult, branchResult, countResult, firstResult, lastResult] =
    await Promise.all([
      execTool('git', ['rev-parse', 'HEAD'], { cwd: root, timeout }),
      execTool('git', ['remote'], { cwd: root, timeout }),
      execTool('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, timeout }),
      execTool('git', ['rev-list', '--count', 'HEAD'], { cwd: root, timeout }),
      execTool('git', ['log', '--reverse', '--format=%aI', '-1'], { cwd: root, timeout }),
      execTool('git', ['log', '--format=%aI', '-1'], { cwd: root, timeout }),
    ]);

  return {
    isRepo: true,
    headCommit: headResult.exitCode === 0 ? headResult.stdout.trim() : null,
    remotes: remotesResult.exitCode === 0
      ? remotesResult.stdout.trim().split('\n').filter(Boolean)
      : [],
    defaultBranch: branchResult.exitCode === 0 ? branchResult.stdout.trim() : null,
    totalCommits: countResult.exitCode === 0 ? parseInt(countResult.stdout.trim(), 10) : null,
    firstCommitDate: firstResult.exitCode === 0 ? firstResult.stdout.trim() || null : null,
    lastCommitDate: lastResult.exitCode === 0 ? lastResult.stdout.trim() || null : null,
  };
}

function detectManifests(files: readonly FileEntry[]): ManifestEntry[] {
  const manifests: ManifestEntry[] = [];
  for (const file of files) {
    const basename = path.basename(file.path);
    const manifestType = MANIFEST_MAP[basename];
    if (manifestType) {
      manifests.push({ type: manifestType, path: file.path });
    }
  }
  return manifests;
}

function groupByLanguage(files: readonly FileEntry[]): Map<string, FileEntry[]> {
  const map = new Map<string, FileEntry[]>();
  for (const file of files) {
    if (file.isBinary) continue;
    const existing = map.get(file.language);
    if (existing) {
      existing.push(file);
    } else {
      map.set(file.language, [file]);
    }
  }
  return map;
}

function groupByExtension(files: readonly FileEntry[]): Map<string, FileEntry[]> {
  const map = new Map<string, FileEntry[]>();
  for (const file of files) {
    if (file.isBinary) continue;
    const existing = map.get(file.extension);
    if (existing) {
      existing.push(file);
    } else {
      map.set(file.extension, [file]);
    }
  }
  return map;
}

export async function buildRepositoryIndex(
  root: string,
  config: AnalysisConfig,
): Promise<RepositoryIndex> {
  const absoluteRoot = path.resolve(root);

  // Build file list and git meta in parallel
  const [files, gitMeta] = await Promise.all([
    buildFileList(absoluteRoot, config),
    readGitMeta(absoluteRoot, config.timeout),
  ]);

  const manifests = detectManifests(files);
  const filesByLanguage = groupByLanguage(files);
  const filesByExtension = groupByExtension(files);

  return {
    root: absoluteRoot,
    files,
    filesByLanguage,
    filesByExtension,
    manifests,
    gitMeta,
    config,
  };
}
