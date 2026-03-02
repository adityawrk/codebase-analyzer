/**
 * Dependency analyzer — enumerates project dependencies across ecosystems.
 *
 * Dispatches to per-ecosystem adapters based on manifest types found in the
 * RepositoryIndex. Detects the active package manager from lockfiles.
 * Never throws — returns error meta on failure.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  RepositoryIndex,
  DependencyResult,
  DependencyEntry,
  ManifestType,
} from '../core/types.js';
import { parseNpmManifest } from './adapters/npm-adapter.js';
import { parseCargoManifest } from './adapters/cargo-adapter.js';
import { parseGoMod } from './adapters/go-adapter.js';
import { parsePythonRequirements } from './adapters/pypi-adapter.js';

// ---------------------------------------------------------------------------
// Lockfile → package manager mapping
// ---------------------------------------------------------------------------

/** Ordered by specificity: more specific lockfiles first. */
const LOCKFILE_MAP: Array<{ basename: string; manager: string }> = [
  { basename: 'bun.lockb', manager: 'bun' },
  { basename: 'bun.lock', manager: 'bun' },
  { basename: 'pnpm-lock.yaml', manager: 'pnpm' },
  { basename: 'yarn.lock', manager: 'yarn' },
  { basename: 'package-lock.json', manager: 'npm' },
  { basename: 'Cargo.lock', manager: 'cargo' },
  { basename: 'go.sum', manager: 'go' },
  { basename: 'poetry.lock', manager: 'poetry' },
  { basename: 'Pipfile.lock', manager: 'pipenv' },
];

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

/**
 * Detect the package manager by checking the repo root for known lockfiles.
 *
 * Lockfiles are excluded from the RepositoryIndex by file-policy (they are
 * not source code), so we check the filesystem directly. Only the repo root
 * is probed — nested lockfiles (monorepo workspaces) are not considered.
 *
 * Returns the first match (most specific wins) or null if none found.
 */
async function detectPackageManager(root: string): Promise<string | null> {
  for (const entry of LOCKFILE_MAP) {
    const lockfilePath = path.join(root, entry.basename);
    try {
      await fs.access(lockfilePath);
      return entry.manager;
    } catch {
      // File does not exist — try next
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Placeholder adapter for ecosystems not yet implemented
// ---------------------------------------------------------------------------

function placeholderEntries(_ecosystem: string): DependencyEntry[] {
  // Future adapters (maven, gradle) will replace these placeholders.
  // Return empty for now — the manifest is acknowledged but not parsed.
  return [];
}

// ---------------------------------------------------------------------------
// Adapter dispatch
// ---------------------------------------------------------------------------

/**
 * Route a manifest to its ecosystem adapter and return the parsed dependencies.
 */
async function parseManifest(
  root: string,
  manifestType: ManifestType,
  manifestPath: string,
): Promise<DependencyEntry[]> {
  switch (manifestType) {
    case 'npm':
      return parseNpmManifest(root, manifestPath);
    case 'cargo':
      return parseCargoManifest(root, manifestPath);
    case 'go':
      return parseGoMod(root, manifestPath);
    case 'python-requirements':
    case 'python-pyproject':
      return parsePythonRequirements(root, manifestPath);
    case 'maven':
      return placeholderEntries('maven');
    case 'gradle':
      return placeholderEntries('gradle');
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze dependencies across all detected manifests.
 *
 * Iterates over `index.manifests`, dispatches to the appropriate adapter,
 * merges results, and detects the active package manager from lockfiles.
 *
 * Never throws — returns error meta on failure.
 */
export async function analyzeDependencies(
  index: RepositoryIndex,
): Promise<DependencyResult> {
  const start = performance.now();

  try {
    // Parse all manifests in parallel
    const parsePromises = index.manifests.map((manifest) =>
      parseManifest(index.root, manifest.type, manifest.path),
    );
    const results = await Promise.all(parsePromises);

    // Flatten all dependency entries
    const allDeps: DependencyEntry[] = results.flat();

    // Deduplicate: if the same package appears in multiple manifests (e.g. monorepo),
    // keep the first occurrence. Key on name + ecosystem.
    const seen = new Set<string>();
    const dependencies: DependencyEntry[] = [];
    for (const dep of allDeps) {
      const key = `${dep.ecosystem}:${dep.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        dependencies.push(dep);
      }
    }

    // Count by type
    const directDependencies = dependencies.filter((d) => d.type === 'direct').length;
    const devDependencies = dependencies.filter((d) => d.type === 'dev').length;

    // Collect unique ecosystems
    const ecosystems = [...new Set(dependencies.map((d) => d.ecosystem))].sort();

    // Detect package manager
    const packageManager = await detectPackageManager(index.root);

    const elapsed = Math.round(performance.now() - start);

    return {
      meta: { status: 'computed', durationMs: elapsed },
      totalDependencies: dependencies.length,
      directDependencies,
      devDependencies,
      ecosystems,
      packageManager,
      dependencies,
    };
  } catch (err: unknown) {
    const elapsed = Math.round(performance.now() - start);
    return {
      meta: {
        status: 'error',
        reason: err instanceof Error ? err.message : String(err),
        durationMs: elapsed,
      },
      totalDependencies: 0,
      directDependencies: 0,
      devDependencies: 0,
      ecosystems: [],
      packageManager: null,
      dependencies: [],
    };
  }
}
