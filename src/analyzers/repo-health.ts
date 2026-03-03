/**
 * repo-health.ts — Repository health check analyzer.
 *
 * Checks for the presence of standard repository artifacts (README, LICENSE,
 * CI config, etc.) by scanning the immutable RepositoryIndex. No filesystem
 * re-traversal — everything comes from index.files.
 */

import * as path from 'node:path';
import type { RepositoryIndex, RepoHealthResult, HealthCheck, AnalyzerMeta } from '../core/types.js';

// ---------------------------------------------------------------------------
// Check definitions
// ---------------------------------------------------------------------------

interface CheckDef {
  /** Stable machine identifier for scoring (e.g. 'readme', 'license', 'ci') */
  id: string;
  /** Human-readable name shown in the report */
  name: string;
  /** File basenames to search for (case-insensitive) */
  filenames: string[];
  /** If true, match anywhere in the repo. If false, root-only. */
  anyDepth: boolean;
  /** Optional callback to produce a note when file(s) are found */
  note?: (matches: string[]) => string | undefined;
}

const CI_PLATFORMS: Record<string, string> = {
  '.github/workflows': 'GitHub Actions',
  '.gitlab-ci.yml': 'GitLab CI',
  'jenkinsfile': 'Jenkins',
  '.circleci/config.yml': 'CircleCI',
  '.travis.yml': 'Travis CI',
};

function detectCIPlatforms(matches: string[]): string | undefined {
  const platforms = new Set<string>();
  for (const filePath of matches) {
    const normalized = filePath.toLowerCase().replace(/\\/g, '/');
    for (const [pattern, platform] of Object.entries(CI_PLATFORMS)) {
      if (normalized.startsWith(pattern) || normalized.includes('/' + pattern)) {
        platforms.add(platform);
      }
    }
  }
  const parts: string[] = [];
  if (platforms.size > 0) {
    parts.push(`CI platform${platforms.size > 1 ? 's' : ''}: ${[...platforms].join(', ')}`);
  }
  if (matches.length > 1) {
    parts.push(`${matches.length} workflow files detected`);
  }
  return parts.length > 0 ? parts.join('. ') : undefined;
}

const CHECKS: CheckDef[] = [
  {
    id: 'readme',
    name: 'README',
    filenames: ['README.md', 'README', 'README.txt', 'README.rst', 'README.markdown'],
    anyDepth: true,
  },
  {
    id: 'license',
    name: 'LICENSE',
    filenames: ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENSE-MIT', 'LICENSE-APACHE', 'UNLICENSE', 'COPYING'],
    anyDepth: true,
  },
  {
    id: 'ci',
    name: 'CI Configuration',
    filenames: [], // handled specially via matchCI
    anyDepth: true,
    note: detectCIPlatforms,
  },
  {
    id: 'contributing',
    name: 'CONTRIBUTING',
    filenames: ['CONTRIBUTING.md'],
    anyDepth: false,
  },
  {
    id: 'gitignore',
    name: '.gitignore',
    filenames: ['.gitignore'],
    anyDepth: false,
  },
  {
    id: 'editorconfig',
    name: '.editorconfig',
    filenames: ['.editorconfig'],
    anyDepth: false,
  },
  {
    id: 'dockerfile',
    name: 'Dockerfile',
    filenames: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'],
    anyDepth: true,
  },
  {
    id: 'securityPolicy',
    name: 'Security Policy',
    filenames: ['SECURITY.md'],
    anyDepth: false,
  },
  {
    id: 'codeOfConduct',
    name: 'Code of Conduct',
    filenames: ['CODE_OF_CONDUCT.md'],
    anyDepth: false,
  },
  {
    id: 'changelog',
    name: 'Changelog',
    filenames: ['CHANGELOG.md', 'CHANGES.md', 'HISTORY.md'],
    anyDepth: false,
  },
];

// ---------------------------------------------------------------------------
// CI pattern matching
// ---------------------------------------------------------------------------

/** CI file patterns — these use path matching, not just basename matching. */
const CI_PATTERNS: Array<(filePath: string) => boolean> = [
  // GitHub Actions: .github/workflows/*.yml or *.yaml
  (p) => {
    const normalized = p.replace(/\\/g, '/').toLowerCase();
    return (
      normalized.startsWith('.github/workflows/') &&
      (normalized.endsWith('.yml') || normalized.endsWith('.yaml'))
    );
  },
  // GitLab CI
  (p) => p.toLowerCase() === '.gitlab-ci.yml',
  // Jenkins
  (p) => path.basename(p).toLowerCase() === 'jenkinsfile',
  // CircleCI
  (p) => p.replace(/\\/g, '/').toLowerCase() === '.circleci/config.yml',
  // Travis CI
  (p) => p.toLowerCase() === '.travis.yml',
];

function isCIFile(filePath: string): boolean {
  return CI_PATTERNS.some((test) => test(filePath));
}

// ---------------------------------------------------------------------------
// File matching helpers
// ---------------------------------------------------------------------------

/**
 * Search index.files for entries matching a check definition.
 * Returns all matching file paths (relative).
 */
function findMatches(
  files: readonly { path: string }[],
  check: CheckDef,
): string[] {
  // Special case: CI Configuration uses pattern matchers, not basenames
  if (check.name === 'CI Configuration') {
    return files
      .filter((f) => isCIFile(f.path))
      .map((f) => f.path);
  }

  const lowerNames = new Set(check.filenames.map((n) => n.toLowerCase()));
  const matches: string[] = [];

  for (const file of files) {
    const basename = path.basename(file.path).toLowerCase();
    if (!lowerNames.has(basename)) continue;

    if (check.anyDepth) {
      // Match anywhere in the repo tree
      matches.push(file.path);
    } else {
      // Root-only: the file path should have no directory separators
      const normalized = file.path.replace(/\\/g, '/');
      if (!normalized.includes('/')) {
        matches.push(file.path);
      }
    }
  }

  // When matching at any depth, prefer root-level files (fewer path separators = shallower)
  if (check.anyDepth && matches.length > 1) {
    matches.sort((a, b) => {
      const depthA = a.replace(/\\/g, '/').split('/').length;
      const depthB = b.replace(/\\/g, '/').split('/').length;
      return depthA - depthB;
    });
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

export function analyzeRepoHealth(index: RepositoryIndex): RepoHealthResult {
  const start = performance.now();

  const checks: HealthCheck[] = [];

  for (const checkDef of CHECKS) {
    const matches = findMatches(index.files, checkDef);
    const present = matches.length > 0;

    const check: HealthCheck = {
      id: checkDef.id,
      name: checkDef.name,
      present,
    };

    if (present) {
      // Use the first match as the canonical path
      check.path = matches[0];

      // Generate optional note
      if (checkDef.note) {
        const note = checkDef.note(matches);
        if (note) {
          check.note = note;
        }
      }
    }

    checks.push(check);
  }

  const durationMs = performance.now() - start;

  const meta: AnalyzerMeta = {
    status: 'computed',
    durationMs,
  };

  return { meta, checks };
}
