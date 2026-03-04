/**
 * Shared helpers, constants, and detection utilities used across
 * multiple markdown section formatters.
 */

import * as path from 'node:path';
import type {
  ReportData,
  SizingResult,
} from '../../core/types.js';

// ---------------------------------------------------------------------------
// Non-code language filter — used to find the real "top language" for classification
// ---------------------------------------------------------------------------

/** Languages that are not source code — filtered from Language Breakdown and classification. */
export const NON_CODE_LANGUAGES = new Set([
  'markdown', 'json', 'jsonl', 'jsonc', 'yaml', 'toml', 'xml',
  'plain text', 'text', 'plain',
  'license', 'gitignore', 'docker ignore',
  'svg', 'csv', 'ini',
  'properties file', 'batch', 'patch',
  'gemfile', 'rakefile', 'makefile',
  'restructuredtext', 'asciidoc',
]);

/** JS/TS language set for ESLint/Prettier relevance check */
export const JS_TS_LANGUAGES = new Set([
  'JavaScript', 'TypeScript', 'JSX', 'TSX', 'TypeScript Typings',
]);

/** Check if the project has a frontend framework AND actual frontend component files (.tsx/.jsx/.vue/.svelte). */
export function detectHasFrontendFramework(report: ReportData): boolean {
  if (report.sizing.meta.status !== 'computed') return false;

  // Check 1: Definitive frontend rendering libraries in deps.
  // react-dom, vue, svelte, @angular/core are ONLY used in browser/UI contexts.
  // Unlike bare "react" (which Hono uses for JSX typings), these are unambiguous.
  if (report.dependencies.meta.status === 'computed') {
    const renderingLibs = new Set(['react-dom', 'vue', 'svelte', '@angular/core', 'solid-js', 'preact']);
    const hasRenderingLib = report.dependencies.dependencies.some(
      (dep) => renderingLibs.has(dep.name.toLowerCase()),
    );
    if (hasRenderingLib) return true;
  }

  // Check 2: Explicit frontend component file extensions (.tsx/.jsx/.vue/.svelte).
  // Note: scc may merge .tsx into "TypeScript", so this check alone is insufficient.
  const hasFrontendFiles = report.sizing.languages.some(
    (l) => l.language === 'TSX' || l.language === 'JSX' ||
      l.extension === '.tsx' || l.extension === '.jsx' ||
      l.extension === '.vue' || l.extension === '.svelte',
  );
  if (!hasFrontendFiles) return false;

  // With frontend files present, check for framework entries
  if (report.techStack.meta.status === 'computed') {
    const frameworkNames = new Set(['react', 'vue', 'svelte', 'angular', 'next.js', 'nuxt', 'remix', 'gatsby', 'solid', 'preact']);
    for (const entry of report.techStack.stack) {
      if (frameworkNames.has(entry.name.toLowerCase())) return true;
    }
  }
  if (report.dependencies.meta.status === 'computed') {
    const frontendPkgs = new Set(['react', 'next', 'nuxt', 'remix', 'gatsby']);
    for (const dep of report.dependencies.dependencies) {
      if (frontendPkgs.has(dep.name.toLowerCase())) return true;
    }
  }
  return false;
}

/** Check if JS/TS is a significant part of the codebase (>= 5% of code lines) */
export function hasJsTsLanguages(sizing: SizingResult): boolean {
  if (sizing.meta.status !== 'computed') return false;
  const jsTsLines = sizing.languages
    .filter((l) => JS_TS_LANGUAGES.has(l.language))
    .reduce((sum, l) => sum + l.codeLines, 0);
  return jsTsLines > 0 && (sizing.totalCodeLines === 0 || jsTsLines / sizing.totalCodeLines >= 0.05);
}

/** Get the top code language name from sizing data. */
export function getTopLanguageName(report: ReportData): string {
  if (report.sizing.meta.status !== 'computed' || report.sizing.languages.length === 0) return '';
  const codeOnly = report.sizing.languages.filter(
    (l) => !NON_CODE_LANGUAGES.has(l.language.toLowerCase()),
  );
  const sorted = [...codeOnly].sort((a, b) => b.codeLines - a.codeLines);
  return sorted[0]?.language ?? '';
}

// ---------------------------------------------------------------------------
// Date / string helpers
// ---------------------------------------------------------------------------

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

export function capitalize(s: string): string {
  if (s.length === 0) return s;
  // Handle kebab-case: "repo-health" -> "RepoHealth"
  return s
    .split('-')
    .map((part) => (part.length > 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join('');
}
