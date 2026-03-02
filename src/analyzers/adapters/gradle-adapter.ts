/**
 * Gradle ecosystem adapter — parses build.gradle / build.gradle.kts manifests
 * into DependencyEntry[].
 *
 * Uses regex-based parsing to extract dependencies from Gradle DSL syntax.
 * Handles both Groovy DSL (build.gradle) and Kotlin DSL (build.gradle.kts).
 *
 * Recognized configurations:
 * - implementation, api (→ direct)
 * - testImplementation, androidTestImplementation (→ dev)
 * - kapt, ksp, annotationProcessor (→ direct)
 * - compileOnly, runtimeOnly (→ direct)
 * - debugImplementation, releaseImplementation (→ direct)
 *
 * Dependency formats:
 * - String notation: 'group:name:version'
 * - String notation without version: 'group:name'
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DependencyEntry } from '../../core/types.js';

/** Map Gradle configuration names to our dependency type. */
const CONFIG_TYPE_MAP: Record<string, DependencyEntry['type']> = {
  implementation: 'direct',
  api: 'direct',
  compileOnly: 'direct',
  runtimeOnly: 'direct',
  kapt: 'direct',
  ksp: 'direct',
  annotationProcessor: 'direct',
  debugImplementation: 'direct',
  releaseImplementation: 'direct',
  testImplementation: 'dev',
  testCompileOnly: 'dev',
  testRuntimeOnly: 'dev',
  androidTestImplementation: 'dev',
};

/**
 * Regex to match Gradle dependency declarations.
 *
 * Matches patterns like:
 *   implementation 'com.google.code.gson:gson:2.10.1'
 *   implementation "com.google.code.gson:gson:2.10.1"
 *   implementation("com.google.code.gson:gson:2.10.1")
 *   testImplementation 'junit:junit:4.13.2'
 *
 * Captures:
 *   [1] = configuration name (e.g. "implementation")
 *   [2] = group:name:version string
 */
const DEPENDENCY_RE =
  /^\s*(implementation|api|compileOnly|runtimeOnly|kapt|ksp|annotationProcessor|debugImplementation|releaseImplementation|testImplementation|testCompileOnly|testRuntimeOnly|androidTestImplementation)\s*[\s(]+['"]([^'"]+)['"]\s*\)?/;

/**
 * Parse a Gradle build file and return its dependency entries.
 *
 * @param root          Absolute path to the repository root.
 * @param manifestPath  Relative path from root to the build.gradle[.kts] file.
 * @returns Array of DependencyEntry with ecosystem = 'gradle'. Empty on any error.
 */
export async function parseGradleManifest(
  root: string,
  manifestPath: string,
): Promise<DependencyEntry[]> {
  const absPath = path.join(root, manifestPath);

  let content: string;
  try {
    content = await fs.readFile(absPath, 'utf-8');
  } catch {
    return [];
  }

  const entries: DependencyEntry[] = [];

  for (const line of content.split('\n')) {
    const match = DEPENDENCY_RE.exec(line);
    if (!match) continue;

    const configName = match[1]!;
    const coords = match[2]!;

    // Parse group:name:version or group:name
    const parts = coords.split(':');
    if (parts.length < 2) continue;

    const group = parts[0]!;
    const name = parts[1]!;
    const version = parts[2] ?? '';

    const depType = CONFIG_TYPE_MAP[configName] ?? 'direct';

    entries.push({
      name: `${group}:${name}`,
      version,
      type: depType,
      ecosystem: 'gradle',
    });
  }

  return entries;
}
