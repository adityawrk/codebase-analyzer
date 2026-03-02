/**
 * npm ecosystem adapter — parses package.json manifests into DependencyEntry[].
 *
 * Handles all four npm dependency types: dependencies, devDependencies,
 * peerDependencies, optionalDependencies. Malformed package.json files
 * are handled gracefully (empty array returned).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DependencyEntry } from '../../core/types.js';

/** Shape of the fields we care about in package.json. */
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/**
 * Parse an npm package.json manifest and return its dependency entries.
 *
 * @param root     Absolute path to the repository root.
 * @param manifestPath  Relative path from root to the package.json file.
 * @returns Array of DependencyEntry with ecosystem = 'npm'. Empty on any error.
 */
export async function parseNpmManifest(
  root: string,
  manifestPath: string,
): Promise<DependencyEntry[]> {
  const absPath = path.join(root, manifestPath);

  let raw: string;
  try {
    raw = await fs.readFile(absPath, 'utf-8');
  } catch {
    return [];
  }

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(raw) as PackageJson;
  } catch {
    return [];
  }

  const entries: DependencyEntry[] = [];

  const sections: Array<{
    field: Record<string, string> | undefined;
    type: DependencyEntry['type'];
  }> = [
    { field: pkg.dependencies, type: 'direct' },
    { field: pkg.devDependencies, type: 'dev' },
    { field: pkg.peerDependencies, type: 'peer' },
    { field: pkg.optionalDependencies, type: 'optional' },
  ];

  for (const section of sections) {
    if (!section.field || typeof section.field !== 'object') continue;

    for (const [name, version] of Object.entries(section.field)) {
      if (typeof name !== 'string' || typeof version !== 'string') continue;

      entries.push({
        name,
        version,
        type: section.type,
        ecosystem: 'npm',
      });
    }
  }

  return entries;
}
