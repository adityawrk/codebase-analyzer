/**
 * Markdown report formatter.
 * Produces structured markdown from ReportData.
 *
 * This is the orchestrator — it imports section formatters from ./sections/
 * and concatenates their output into the final report string.
 */

import type { ReportData } from '../core/types.js';

import { formatHeader } from './sections/header.js';
import { formatSummary } from './sections/summary.js';
import { formatLanguages } from './sections/languages.js';
import { formatCodeTypeBreakdown } from './sections/code-type.js';
import { formatStructure } from './sections/structure.js';
import { formatTests } from './sections/testing.js';
import { formatHealth } from './sections/health.js';
import { formatComplexity } from './sections/complexity.js';
import { formatGodFiles } from './sections/god-files.js';
import { formatGit } from './sections/git.js';
import { formatDependencies } from './sections/dependencies.js';
import { formatLargestFiles } from './sections/largest-files.js';
import { formatSecurity } from './sections/security.js';
import { formatTechStack } from './sections/tech-stack.js';
import { formatConfigTooling } from './sections/config-tooling.js';
import { formatEnvVars } from './sections/env-vars.js';
import { formatDuplication } from './sections/duplication.js';
import { formatArchitecture } from './sections/architecture.js';
import { formatFooter } from './sections/footer.js';

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function formatMarkdown(report: ReportData): string {
  const lines: string[] = [
    ...formatHeader(report),
    ...formatSummary(report),
    ...formatLanguages(report),
    ...formatCodeTypeBreakdown(report),
    ...formatStructure(report),
    ...formatTests(report),
    ...formatHealth(report),
    ...formatComplexity(report),
    ...formatGodFiles(report),
    ...formatGit(report),
    ...formatDependencies(report),
    ...formatLargestFiles(report),
    ...formatSecurity(report),
    ...formatTechStack(report),
    ...formatConfigTooling(report),
    ...formatEnvVars(report),
    ...formatDuplication(report),
    ...formatArchitecture(report),
    ...formatFooter(report),
  ];

  return lines.join('\n') + '\n';
}
