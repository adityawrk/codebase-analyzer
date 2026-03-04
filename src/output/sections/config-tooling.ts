/**
 * Configuration & Tooling section formatter.
 * Combines techStack, repoHealth, and dependencies signals.
 */

import type { ReportData } from '../../core/types.js';
import { hasJsTsLanguages } from './helpers.js';

// ---------------------------------------------------------------------------
// Config item definitions
// ---------------------------------------------------------------------------

/**
 * Config item definition for the Configuration & Tooling table.
 * Each item maps a display name to a detection strategy using existing report data.
 */
interface ConfigItem {
  /** Display name in the Tool/Config column */
  label: string;
  /**
   * Returns the detected file path/source if found, or null if not found.
   * Receives the full report to query techStack, repoHealth, dependencies, etc.
   */
  detect: (report: ReportData) => string | null;
}

/** Look up a tech stack entry by name (case-insensitive). */
function findTechStack(report: ReportData, name: string): string | null {
  if (report.techStack.meta.status !== 'computed') return null;
  const entry = report.techStack.stack.find(
    (e) => e.name.toLowerCase() === name.toLowerCase(),
  );
  return entry ? entry.source : null;
}

/** Look up a repo health check by id. */
function findHealthCheck(report: ReportData, id: string): string | null {
  if (report.repoHealth.meta.status !== 'computed') return null;
  const check = report.repoHealth.checks.find((c) => c.id === id);
  return check?.present ? (check.path ?? 'detected') : null;
}

/**
 * Ordered list of config items to check.
 * Each entry defines how to detect a tool/config from existing report data.
 * Items are checked in order and always displayed (found or not found).
 */
const CONFIG_ITEMS: ConfigItem[] = [
  {
    label: 'Package Manager',
    detect: (r) => {
      // Check for any ecosystem manifest via dependencies
      if (r.dependencies.meta.status === 'computed' && r.dependencies.packageManager) {
        return r.dependencies.packageManager;
      }
      // Fall back to tech stack for ecosystem-level package managers
      for (const eco of ['npm', 'cargo', 'go', 'python', 'maven', 'gradle']) {
        const src = findTechStack(r, eco);
        if (src) return src;
      }
      return null;
    },
  },
  {
    label: 'TypeScript',
    detect: (r) => findTechStack(r, 'TypeScript'),
  },
  {
    label: 'ESLint',
    detect: (r) => findTechStack(r, 'ESLint'),
  },
  {
    label: 'Prettier',
    detect: (r) => findTechStack(r, 'Prettier'),
  },
  {
    label: 'Biome',
    detect: (r) => findTechStack(r, 'Biome'),
  },
  {
    label: 'Bundler (Vite)',
    detect: (r) => findTechStack(r, 'Vite'),
  },
  {
    label: 'Bundler (Webpack)',
    detect: (r) => findTechStack(r, 'Webpack'),
  },
  {
    label: 'Tailwind CSS',
    detect: (r) => findTechStack(r, 'Tailwind CSS'),
  },
  {
    label: 'Docker',
    detect: (r) => {
      const ts = findTechStack(r, 'Docker');
      if (ts) return ts;
      return findHealthCheck(r, 'dockerfile');
    },
  },
  {
    label: 'Docker Compose',
    detect: (r) => findTechStack(r, 'Docker Compose'),
  },
  {
    label: 'GitHub Actions',
    detect: (r) => {
      const ts = findTechStack(r, 'GitHub Actions');
      if (ts) return ts;
      // Fall back to repoHealth CI check
      const ciCheck = findHealthCheck(r, 'ci');
      return ciCheck;
    },
  },
  {
    label: 'GitLab CI',
    detect: (r) => findTechStack(r, 'GitLab CI'),
  },
  {
    label: '.editorconfig',
    detect: (r) => findHealthCheck(r, 'editorconfig'),
  },
];

// ---------------------------------------------------------------------------
// Main section formatter
// ---------------------------------------------------------------------------

export function formatConfigTooling(report: ReportData): string[] {
  // Build rows from config items, only including items that are relevant
  // (detected OR commonly expected for the ecosystem)
  const rows: Array<{ label: string; detected: boolean; file: string }> = [];

  for (const item of CONFIG_ITEMS) {
    const result = item.detect(report);
    rows.push({
      label: item.label,
      detected: result !== null,
      file: result ?? '',
    });
  }

  // Filter: only show items that are detected OR are commonly expected.
  // Remove bundler/CI/tool rows that aren't detected to avoid noise for
  // ecosystems where they don't apply. Always show: Package Manager,
  // TypeScript (if TS is in the stack), linters, Docker, CI.
  const alwaysShow = new Set([
    'Package Manager',
    'Docker',
    '.editorconfig',
  ]);

  // Only show ESLint/Prettier as expected items for JS/TS projects
  if (hasJsTsLanguages(report.sizing)) {
    alwaysShow.add('ESLint');
    alwaysShow.add('Prettier');
  }

  // Show TypeScript row only if TS files exist in the sizing data
  const hasTypeScript = report.sizing.meta.status === 'computed' &&
    report.sizing.languages.some((l) => l.language === 'TypeScript');
  if (hasTypeScript) {
    alwaysShow.add('TypeScript');
  }

  // Show at least one CI row — prefer the one that's detected
  const anyCI = rows.some(
    (r) => (r.label === 'GitHub Actions' || r.label === 'GitLab CI') && r.detected,
  );
  if (!anyCI) {
    // Show GitHub Actions as the default "not found" CI row
    alwaysShow.add('GitHub Actions');
  }

  const filteredRows = rows.filter(
    (r) => r.detected || alwaysShow.has(r.label),
  );

  // If nothing is detected at all, skip the section
  if (filteredRows.every((r) => !r.detected)) {
    return [];
  }

  const lines: string[] = [];
  lines.push('## Configuration & Tooling');
  lines.push('');
  lines.push('| Tool/Config | Status | File |');
  lines.push('|-------------|--------|------|');
  for (const row of filteredRows) {
    if (row.detected) {
      lines.push(`| ${row.label} | \u2705 Configured | ${row.file} |`);
    } else {
      lines.push(`| ${row.label} | \u274C Not Found | |`);
    }
  }
  lines.push('');

  return lines;
}
